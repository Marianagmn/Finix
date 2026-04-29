'use strict';

/**
 * @file personalFinance.service.js
 * @description Capa de negocio para finanzas personales.
 *
 * Arquitectura: controller → service → model (consistente con businessFinance y auth).
 * El controller actúa como coordinador delgado, delegando toda la lógica de negocio
 * a esta capa de servicio.
 */

const mongoose       = require('mongoose');
const PersonalFinance = require('../models/personalFinance.model');
const Account        = require('../models/Account');
const Category       = require('../models/Category');
const { AppError }   = require('../middlewares/error.middleware');
const Pagination     = require('../utils/pagination.utils');
const { normalizeAmounts, PERSONAL_FINANCE_MONEY_FIELDS } = require('../utils/money.utils');
const { ESTADOS_PERSONALES } = require('../constants/transaction.constants');

const financeAnalysisService  = require('./financeAnalysis.service');
const predictionService       = require('./prediction.service');
const simulationService       = require('./simulation.service');
const AnalyticsAggregationService = require('./analytics.aggregation.service');

// Umbral sobre el cual se usa aggregation pipeline en vez de memoria
const AGGREGATION_THRESHOLD = 500;

// Campos permitidos en create / update (mass assignment protection)
const ALLOWED_FIELDS = [
    'tipo', 'monto', 'moneda', 'tasaCambio', 'categoria',
    'cuentaOrigenId', 'cuentaDestinoId', 'metodoPago',
    'descripcion', 'fecha', 'estado', 'esAhorro',
    'tags', 'location', 'notaTransaccion',
    'esTransferenciaInterna', 'transferenciaId', 'source',
];

class PersonalFinanceService {

    // ── Helpers privados ──────────────────────────────────────────────────────

    static _pick(obj, fields) {
        return Object.fromEntries(
            Object.entries(obj).filter(([k]) => fields.includes(k) && obj[k] !== undefined)
        );
    }

    /**
     * Verifica que las referencias (categoria, cuentas) pertenecen al usuario.
     * Previene que un usuario use recursos de otro.
     */
    static async _validateOwnership(data, userId) {
        if (data.categoria) {
            const cat = await Category.findOne({ _id: data.categoria, userId }).lean();
            if (!cat) throw AppError.forbidden('Categoría no encontrada o no autorizada');
        }
        if (data.cuentaOrigenId) {
            const acc = await Account.findOne({ _id: data.cuentaOrigenId, userId }).lean();
            if (!acc) throw AppError.forbidden('Cuenta origen no encontrada o no autorizada');
        }
        if (data.cuentaDestinoId) {
            const acc = await Account.findOne({ _id: data.cuentaDestinoId, userId }).lean();
            if (!acc) throw AppError.forbidden('Cuenta destino no encontrada o no autorizada');
        }
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    /**
     * Crea una nueva transacción personal.
     */
    static async create(body, userId) {
        const data = PersonalFinanceService._pick(body, ALLOWED_FIELDS);
        await PersonalFinanceService._validateOwnership(data, userId);

        const finance = new PersonalFinance({ ...data, userId });
        const saved   = await finance.save();
        return saved.toObject();
    }

    /**
     * Lista transacciones del usuario con filtros y paginación.
     */
    static async list(userId, query = {}) {
        const pager = Pagination.offset(query, {
            defaultLimit: 20,
            maxLimit:     100,
            allowedSortFields: ['fecha', 'monto', 'createdAt', 'estado', 'tipo'],
            defaultSort: '-fecha',
        });

        const filter = { userId };
        if (query.tipo)          filter.tipo   = query.tipo;
        if (query.estado)        filter.estado = query.estado;
        if (query.esAhorro)      filter.esAhorro = query.esAhorro === 'true';
        if (query.fechaDesde || query.fechaHasta) {
            filter.fecha = {};
            if (query.fechaDesde) filter.fecha.$gte = new Date(query.fechaDesde);
            if (query.fechaHasta) filter.fecha.$lte = new Date(query.fechaHasta);
        }

        const [rawItems, total] = await Promise.all([
            PersonalFinance.find(filter)
                .skip(pager.skip)
                .limit(pager.limit)
                .sort(pager.sort)
                .populate('categoria', 'nombre tipo color')
                .lean(),
            PersonalFinance.countDocuments(filter),
        ]);

        // lean() no aplica getters → normalizar manualmente
        const items = normalizeAmounts(rawItems, PERSONAL_FINANCE_MONEY_FIELDS);
        return { items, total, pager };
    }

    /**
     * Obtiene una transacción por ID verificando ownership.
     */
    static async getById(id, userId) {
        const finance = await PersonalFinance.findOne({ _id: id, userId })
            .populate('categoria', 'nombre tipo color icono')
            .lean();

        if (!finance) throw AppError.notFound('Registro financiero no encontrado');
        return normalizeAmounts([finance], PERSONAL_FINANCE_MONEY_FIELDS)[0];
    }

    /**
     * Actualiza una transacción existente.
     */
    static async update(id, userId, body) {
        const data = PersonalFinanceService._pick(body, ALLOWED_FIELDS);
        await PersonalFinanceService._validateOwnership(data, userId);

        const finance = await PersonalFinance.findOne({ _id: id, userId });
        if (!finance) throw AppError.notFound('Registro financiero no encontrado');

        Object.assign(finance, data);
        const updated = await finance.save();
        return updated.toObject();
    }

    /**
     * Soft-delete de una transacción.
     */
    static async softDelete(id, userId) {
        const finance = await PersonalFinance.findOne({ _id: id, userId });
        if (!finance) throw AppError.notFound('Registro financiero no encontrado');
        await finance.softDelete(userId);
    }

    // ── Analytics / AI ────────────────────────────────────────────────────────

    /**
     * Recupera transacciones completadas para los servicios de IA.
     * FIX [I-03]: populate('categoria', 'nombre') para que el análisis use
     * nombres de categoría legibles, no ObjectIds hexadecimales.
     * FIX [M-01]: usa aggregation pipeline para >AGGREGATION_THRESHOLD docs.
     */
    static async _getCompletedTransactions(userId, fechaDesde, fechaHasta) {
        const count = await PersonalFinance.countDocuments({
            userId,
            estado: ESTADOS_PERSONALES.COMPLETADO,
            esTransferenciaInterna: false,
        });

        // M-01: Para datasets grandes, usar aggregation en DB
        if (count > AGGREGATION_THRESHOLD) {
            return null; // signal to use AnalyticsAggregationService
        }

        const filter = {
            userId,
            estado: ESTADOS_PERSONALES.COMPLETADO,
            esTransferenciaInterna: false,
        };
        if (fechaDesde) filter.fecha = { $gte: fechaDesde };
        if (fechaHasta) filter.fecha = { ...(filter.fecha || {}), $lte: fechaHasta };

        // FIX [I-03]: populate categoria para nombres legibles en análisis
        const raw = await PersonalFinance.find(filter)
            .populate('categoria', 'nombre')
            .lean();

        // Normalizar montos de centavos a decimales
        return normalizeAmounts(raw, PERSONAL_FINANCE_MONEY_FIELDS);
    }

    /**
     * Análisis financiero: resumen de ingresos, gastos, categorías.
     * FIX [M-01]: usa aggregation para >500 registros.
     */
    static async getAnalysis(userId, fechaDesde = null, fechaHasta = null) {
        const data = await PersonalFinanceService._getCompletedTransactions(userId, fechaDesde, fechaHasta);

        if (data === null) {
            // Dataset grande → aggregation pipeline (más eficiente)
            return AnalyticsAggregationService.analyzeWithAggregation(
                userId,
                fechaDesde ? new Date(fechaDesde) : null,
                fechaHasta ? new Date(fechaHasta) : null,
            );
        }

        return financeAnalysisService.analyze(data);
    }

    /**
     * Predicción del próximo gasto usando regresión lineal + ensemble.
     */
    static async getPrediction(userId) {
        return predictionService.predict(userId);
    }

    /**
     * Simulación financiera con escenarios y recomendaciones IA.
     */
    static async getSimulation(userId) {
        const data = await PersonalFinanceService._getCompletedTransactions(userId);

        if (data === null) {
            return {
                success: false,
                message: 'Dataset demasiado grande para simulación en memoria. Use el endpoint de análisis agregado.'
            };
        }

        return simulationService.simulate(data);
    }
}

module.exports = PersonalFinanceService;
