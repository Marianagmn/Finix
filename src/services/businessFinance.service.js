/**
 * @file businessFinance.service.js
 * @description Lógica de negocio para transacciones empresariales.
 *
 * Orquesta operaciones sobre el modelo BusinessFinance:
 *  - CRUD con filtros fiscales y de negocio
 *  - Flujo de aprobaciones
 *  - Contabilización (posting al ledger)
 *  - Reversión de transacciones
 *  - Aplicación de pagos (A/R y A/P)
 *  - Cálculo de impuestos
 */

'use strict';

const mongoose       = require('mongoose');
const BusinessFinance = require('../models/businessFinance.model');
const { AppError }   = require('../middlewares/error.middleware');
const Pagination     = require('../utils/pagination.utils');
const { normalizeAmounts: normalizeAmountsFromUtils, BUSINESS_FINANCE_MONEY_FIELDS } = require('../utils/money.utils');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normaliza montos desde centavos a moneda real
 * El modelo almacena en centavos (set: v => v * 100) pero lean() no aplica getters
 * @param {Array} items - Items desde lean()
 * @returns {Array} Items con montos normalizados
 */
// FIX [I-01]: Usar import estático en lugar de require dinámico dentro de función
const normalizeAmounts = (items) => normalizeAmountsFromUtils(items, BUSINESS_FINANCE_MONEY_FIELDS);

// Campos que se permiten actualizar en un borrador
const UPDATABLE_FIELDS = [
    'tipo', 'monto', 'moneda', 'tasaCambio', 'categoria', 'cuentaOrigenId',
    'cuentaDestinoId', 'metodoPago', 'descripcion', 'fecha', 'tags',
    'terceroId', 'centroCostoId', 'departamentoId', 'proyectoId',
    'tarifaIVA', 'tarifaRetefuente', 'tarifaReteICA', 'tarifaReteIVA',
    'notaTransaccion', 'documentosSoporte', 'esAhorro', 'esRecurrente',
    'recurrencia', 'asientoContable', 'numeroDocumento', 'tipoDocumento',
];

class BusinessFinanceService {

    // ─── CRUD ─────────────────────────────────────────────────────────────────

    /**
     * Crea una nueva transacción como borrador.
     * Los impuestos se calculan automáticamente si hay tarifas definidas.
     *
     * @param {object} data     - Campos del modelo.
     * @param {string} userId   - ID del usuario creador.
     * @returns {Promise<object>}
     */
    static async create(data, userId) {
        const txn = new BusinessFinance({
            ...data,
            createdBy: userId,
            updatedBy: userId,
            estado:    'borrador',
        });

        // Calcular impuestos si la transacción tiene tarifas definidas
        if (txn.tarifaIVA > 0 || txn.tarifaRetefuente > 0 ||
            txn.tarifaReteICA > 0 || txn.tarifaReteIVA > 0) {
            txn.calcularImpuestos(txn.monto);
        }

        await txn.save();
        return txn.toObject();
    }

    /**
     * Lista transacciones con filtros, paginación y ordenamiento.
     *
     * @param {string} businessId
     * @param {object} filters    - { tipo, estado, fechaDesde, fechaHasta,
     *                               terceroId, centroCostoId, proyectoId,
     *                               ejercicioFiscal, periodoContable }
     * @param {object} pagination - { skip, limit, page }
     * @param {object} sort       - { fecha: -1 }
     * @returns {Promise<{ items: object[], total: number }>}
     */
    static async list(businessId, filters = {}, pagination = {}, sort = { fecha: -1 }) {
        const { skip = 0, limit = 20 } = pagination;

        const query = { businessId, esTransferenciaInterna: false };

        if (filters.tipo)             query.tipo     = filters.tipo;
        if (filters.estado)           query.estado   = filters.estado;
        if (filters.terceroId)        query.terceroId = filters.terceroId;
        if (filters.centroCostoId)    query.centroCostoId = filters.centroCostoId;
        if (filters.proyectoId)       query.proyectoId    = filters.proyectoId;
        if (filters.ejercicioFiscal)  query.ejercicioFiscal  = Number(filters.ejercicioFiscal);
        if (filters.periodoContable)  query.periodoContable  = Number(filters.periodoContable);

        if (filters.fechaDesde || filters.fechaHasta) {
            query.fecha = {};
            if (filters.fechaDesde) query.fecha.$gte = new Date(filters.fechaDesde);
            if (filters.fechaHasta) query.fecha.$lte = new Date(filters.fechaHasta);
        }

        const [items, total] = await Promise.all([
            BusinessFinance.find(query)
                .skip(skip)
                .limit(limit)
                .sort(sort)
                .populate('categoria', 'nombre')
                .populate('terceroId', 'nombre identificacion')
                .populate('centroCostoId', 'nombre codigo')
                .lean(),
            BusinessFinance.countDocuments(query),
        ]);

        // FIX: Normalizar montos de centavos a moneda real
        return { items: normalizeAmounts(items), total };
    }

    /**
     * Obtiene una transacción por ID verificando que pertenece al business.
     *
     * @param {string} id
     * @param {string} businessId
     * @returns {Promise<Document>} Documento Mongoose (no lean) para poder llamar métodos.
     */
    static async getOne(id, businessId) {
        const txn = await BusinessFinance.findOne({ _id: id, businessId })
            .populate('categoria', 'nombre')
            .populate('terceroId', 'nombre identificacion tipoIdentificacion')
            .populate('centroCostoId', 'nombre codigo')
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        if (!txn) throw AppError.notFound('Transacción no encontrada');
        return txn;
    }

    /**
     * Actualiza una transacción. Solo se permiten borradores.
     * Recalcula impuestos si cambia el monto o las tarifas.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {object} data
     * @param {string} userId
     * @returns {Promise<object>}
     */
    static async update(id, businessId, data, userId) {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado !== 'borrador') {
            throw AppError.badRequest(
                'Solo se pueden editar transacciones en estado borrador. ' +
                'Para modificar una contabilizada, genere un reverso.'
            );
        }

        // Mass assignment protection
        const safeData = Object.fromEntries(
            Object.entries(data).filter(([key]) => UPDATABLE_FIELDS.includes(key))
        );

        Object.assign(txn, safeData);
        txn.updatedBy = userId;

        // Recalcular impuestos si cambió algo fiscal
        const fiscalChanged = ['monto', 'tarifaIVA', 'tarifaRetefuente', 'tarifaReteICA', 'tarifaReteIVA']
            .some(f => safeData[f] !== undefined);

        if (fiscalChanged) {
            txn.calcularImpuestos(txn.monto);
        }

        await txn.save();
        return txn.toObject();
    }

    /**
     * Soft-delete — los registros financieros nunca se eliminan físicamente.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} userId
     */
    static async softDelete(id, businessId, userId) {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado === 'contabilizado') {
            throw AppError.badRequest(
                'No se puede eliminar una transacción contabilizada. Use un reverso.'
            );
        }

        await txn.softDelete(userId);
    }

    // ─── Flujo de aprobación ──────────────────────────────────────────────────

    /**
     * Envía una transacción al flujo de aprobación.
     * Cambia estado de borrador → pendiente_aprobacion.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} userId
     * @returns {Promise<object>}
     */
    static async submitForApproval(id, businessId, userId) {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado !== 'borrador') {
            throw AppError.badRequest('Solo borradores pueden enviarse a aprobación');
        }

        if (txn.nivelAprobacionRequerido === 0) {
            // No requiere aprobación — pasar directamente a aprobado
            txn.estado = 'aprobado';
        } else {
            txn.estado = 'pendiente_aprobacion';
        }

        txn.updatedBy = userId;
        await txn.save();
        return txn.toObject();
    }

    /**
     * Aprueba el nivel actual de la cadena de aprobación.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} aprobadorId
     * @param {string} comentario
     * @returns {Promise<object>}
     */
    static async approve(id, businessId, aprobadorId, comentario = '') {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado !== 'pendiente_aprobacion') {
            throw AppError.badRequest('La transacción no está pendiente de aprobación');
        }

        await txn.aprobar(aprobadorId, comentario);
        return txn.toObject();
    }

    /**
     * Rechaza la transacción en el nivel actual.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} aprobadorId
     * @param {string} motivo
     * @returns {Promise<object>}
     */
    static async reject(id, businessId, aprobadorId, motivo = '') {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado !== 'pendiente_aprobacion') {
            throw AppError.badRequest('La transacción no está pendiente de aprobación');
        }

        await txn.rechazar(aprobadorId, motivo);
        return txn.toObject();
    }

    // ─── Contabilización ──────────────────────────────────────────────────────

    /**
     * Contabiliza (postea al ledger) una transacción aprobada.
     * Una vez contabilizada no puede modificarse — solo revertirse.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} userId
     * @returns {Promise<object>}
     */
    static async post(id, businessId, userId) {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        txn.updatedBy = userId;
        await txn.contabilizar();
        return txn.toObject();
    }

    // ─── Reverso ──────────────────────────────────────────────────────────────

    /**
     * Genera y guarda un reverso de una transacción contabilizada.
     * El reverso invierte los débitos/créditos del asiento contable.
     * La transacción original queda marcada como 'anulado'.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} userId
     * @param {string} motivo
     * @returns {Promise<object>} Documento del reverso guardado.
     */
    static async reverse(id, businessId, userId, motivo = '') {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado !== 'contabilizado') {
            throw AppError.badRequest('Solo se pueden revertir transacciones contabilizadas');
        }

        if (txn.esReverso) {
            throw AppError.badRequest('No se puede revertir un reverso');
        }

        const reverso = txn.generarReverso(userId, motivo);
        reverso.updatedBy = userId;

        // FIX [M-02]: Envolver en session MongoDB para atomicidad completa.
        // Si el proceso muere entre los dos saves, la DB NO queda inconsistente.
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await reverso.save({ session });
                txn.estado          = 'anulado';
                txn.motivoAnulacion = motivo;
                txn.updatedBy       = userId;
                await txn.save({ session });
            });
        } finally {
            await session.endSession();
        }

        return reverso.toObject();
    }

    // ─── Pagos (A/R y A/P) ────────────────────────────────────────────────────

    /**
     * Aplica un pago parcial o total contra una factura abierta.
     *
     * @param {string} id         - ID de la factura (A/R o A/P).
     * @param {string} businessId
     * @param {string} pagoId     - ID de la transacción de pago.
     * @param {number} monto      - Monto en decimal (ej: 150000.00).
     * @param {string} userId
     * @returns {Promise<object>}
     */
    static async applyPayment(id, businessId, pagoId, monto, userId) {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (!txn.esCuentaPorCobrar && !txn.esCuentaPorPagar) {
            throw AppError.badRequest('Esta transacción no es una cuenta por cobrar/pagar');
        }

        if (txn.estaPagado) {
            throw AppError.badRequest('Esta transacción ya está totalmente pagada');
        }

        txn.updatedBy = userId;
        await txn.aplicarPago(pagoId, monto);
        return txn.toObject();
    }

    // ─── Impuestos ────────────────────────────────────────────────────────────

    /**
     * Recalcula los impuestos de una transacción borrador.
     * Útil cuando el usuario cambia tarifas sin cambiar el monto.
     *
     * @param {string} id
     * @param {string} businessId
     * @param {string} userId
     * @returns {Promise<object>}
     */
    static async recalculateTaxes(id, businessId, userId) {
        const txn = await BusinessFinanceService.getOne(id, businessId);

        if (txn.estado !== 'borrador') {
            throw AppError.badRequest('Solo se recalculan impuestos en borradores');
        }

        txn.calcularImpuestos(txn.monto);
        txn.updatedBy = userId;
        await txn.save();
        return txn.toObject();
    }

    // ─── Consultas especializadas ─────────────────────────────────────────────

    /**
     * Retorna las transacciones pendientes de aprobación para un usuario.
     *
     * @param {string} businessId
     * @param {string} aprobadorId
     * @param {object} pagination
     * @returns {Promise<{ items: object[], total: number }>}
     */
    static async getPendingApprovals(businessId, aprobadorId, pagination = {}) {
        const { skip = 0, limit = 20 } = pagination;

        const query = {
            businessId,
            estado: 'pendiente_aprobacion',
            'cadenaAprobacion': {
                $elemMatch: {
                    aprobadorId,
                    estado: 'pendiente',
                },
            },
        };

        const [items, total] = await Promise.all([
            BusinessFinance.find(query).skip(skip).limit(limit).sort({ fecha: -1 }).lean(),
            BusinessFinance.countDocuments(query),
        ]);

        // FIX: Normalizar montos de centavos a moneda real
        return { items: normalizeAmounts(items), total };
    }

    /**
     * Retorna cuentas por cobrar o pagar vencidas.
     *
     * @param {string}  businessId
     * @param {'cobrar'|'pagar'} tipo
     * @param {object}  pagination
     * @returns {Promise<{ items: object[], total: number }>}
     */
    static async getOverdue(businessId, tipo, pagination = {}) {
        const { skip = 0, limit = 20 } = pagination;

        const field = tipo === 'cobrar' ? 'esCuentaPorCobrar' : 'esCuentaPorPagar';
        const query = {
            businessId,
            [field]: true,
            'vencimiento.fechaVencimiento': { $lt: new Date() },
            saldoPendiente: { $gt: 0 },
        };

        const [items, total] = await Promise.all([
            BusinessFinance.find(query)
                .skip(skip)
                .limit(limit)
                .sort({ 'vencimiento.fechaVencimiento': 1 })
                .populate('terceroId', 'nombre identificacion')
                .lean(),
            BusinessFinance.countDocuments(query),
        ]);

        // FIX: Normalizar montos de centavos a moneda real
        return { items: normalizeAmounts(items), total };
    }
}

module.exports = BusinessFinanceService;