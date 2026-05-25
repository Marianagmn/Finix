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
const AccountService = require('./account.service');

const financeAnalysisService  = require('./financeAnalysis.service');
const predictionService       = require('./prediction.service');
const simulationService       = require('./simulation.service');
const AnalyticsAggregationService = require('./analytics.aggregation.service');
const redisService            = require('./redis.service');

// FIX [M-07]: TTL de caché para servicios de IA (5 minutos)
const AI_CACHE_TTL = 300; // 5 minutos en segundos

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
     * FIX [M-09]: Invalida caché de IA después de crear.
     * FIX: Actualiza balances de cuentas según el tipo de transacción.
     */
    static async create(body, userId) {
        const data = PersonalFinanceService._pick(body, ALLOWED_FIELDS);
        await PersonalFinanceService._validateOwnership(data, userId);

        const finance = new PersonalFinance({ ...data, userId });
        const saved   = await finance.save();

        // Actualizar balances de cuentas según el tipo de transacción
        await PersonalFinanceService._updateAccountBalances(saved, userId, 'create');

        // Invalidar caché de IA para este usuario
        await PersonalFinanceService._invalidateAICache(userId);

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
     * FIX [M-09]: Invalida caché de IA después de actualizar.
     * FIX: Actualiza balances de cuentas según el tipo de transacción.
     */
    static async update(id, userId, body) {
        const data = PersonalFinanceService._pick(body, ALLOWED_FIELDS);
        await PersonalFinanceService._validateOwnership(data, userId);

        const finance = await PersonalFinance.findOne({ _id: id, userId });
        if (!finance) throw AppError.notFound('Registro financiero no encontrado');

        // Guardar valores originales para revertir cambios en balances
        const original = finance.toObject();

        Object.assign(finance, data);
        const updated = await finance.save();

        // Actualizar balances de cuentas (revertir original, aplicar nuevo)
        await PersonalFinanceService._updateAccountBalances(original, userId, 'delete');
        await PersonalFinanceService._updateAccountBalances(updated, userId, 'create');

        // Invalidar caché de IA para este usuario
        await PersonalFinanceService._invalidateAICache(userId);

        return updated.toObject();
    }

    /**
     * Soft-delete de una transacción.
     * FIX [M-09]: Invalida caché de IA después de eliminar.
     * FIX: Revierte el efecto en los balances de cuentas.
     */
    static async softDelete(id, userId) {
        const finance = await PersonalFinance.findOne({ _id: id, userId });
        if (!finance) throw AppError.notFound('Registro financiero no encontrado');
        
        // Revertir el efecto en los balances antes de eliminar
        await PersonalFinanceService._updateAccountBalances(finance, userId, 'delete');
        
        await finance.softDelete(userId);

        // Invalidar caché de IA para este usuario
        await PersonalFinanceService._invalidateAICache(userId);
    }

    /**
     * Invalida el caché de IA para un usuario.
     * FIX [M-09]: Llamado después de cualquier modificación de datos.
     * @private
     */
    static async _invalidateAICache(userId) {
        try {
            await Promise.all([
                redisService.invalidateCache(`analysis:${userId}:*`),
                redisService.invalidateCache(`prediction:${userId}`),
                redisService.invalidateCache(`simulation:${userId}`),
            ]);
        } catch (err) {
            // No fallar si Redis no está disponible
            console.warn('[Cache] Error al invalidar caché:', err.message);
        }
    }

    /**
     * Actualiza los balances de cuentas según el tipo de transacción.
     * @private
     * @param {Object} transaction - Transacción personal
     * @param {string} userId - ID del usuario
     * @param {string} operation - 'create' para aplicar efecto, 'delete' para revertir
     */
    static async _updateAccountBalances(transaction, userId, operation) {
        const multiplier = operation === 'create' ? 1 : -1;
        const monto = transaction.monto * multiplier;

        try {
            if (transaction.tipo === 'ingreso' && transaction.cuentaDestinoId) {
                // Ingreso: agregar al balance de la cuenta destino
                await AccountService.updateBalance(transaction.cuentaDestinoId, userId, monto);
            } else if (transaction.tipo === 'gasto' && transaction.cuentaOrigenId) {
                // Gasto: restar del balance de la cuenta origen
                await AccountService.updateBalance(transaction.cuentaOrigenId, userId, -monto);
            } else if (transaction.tipo === 'transferencia') {
                // Transferencia: restar de origen, agregar a destino
                if (transaction.cuentaOrigenId) {
                    await AccountService.updateBalance(transaction.cuentaOrigenId, userId, -monto);
                }
                if (transaction.cuentaDestinoId) {
                    await AccountService.updateBalance(transaction.cuentaDestinoId, userId, monto);
                }
            }
        } catch (err) {
            // No fallar la transacción si la actualización de balance falla
            console.warn('[Balance] Error al actualizar balance:', err.message);
        }
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
     * FIX [M-07]: caché de 5 minutos para resultados de IA.
     */
    static async getAnalysis(userId, fechaDesde = null, fechaHasta = null) {
        const cacheKey = `analysis:${userId}:${fechaDesde || 'all'}:${fechaHasta || 'all'}`;

        // Intentar recuperar del caché
        const cached = await redisService.getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        const data = await PersonalFinanceService._getCompletedTransactions(userId, fechaDesde, fechaHasta);

        let result;
        if (data === null) {
            // Dataset grande → aggregation pipeline (más eficiente)
            result = await AnalyticsAggregationService.analyzeWithAggregation(
                userId,
                fechaDesde ? new Date(fechaDesde) : null,
                fechaHasta ? new Date(fechaHasta) : null,
            );
        } else {
            result = financeAnalysisService.analyze(data);
        }

        // Guardar en caché si es exitoso
        if (result.success) {
            await redisService.setCache(cacheKey, result, AI_CACHE_TTL);
        }

        return result;
    }

    /**
     * Predicción del próximo gasto usando regresión lineal + ensemble.
     * FIX [M-07]: caché de 5 minutos para resultados de IA.
     */
    static async getPrediction(userId) {
        const cacheKey = `prediction:${userId}`;

        // Intentar recuperar del caché
        const cached = await redisService.getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        const result = await predictionService.predict(userId);

        // Guardar en caché si es exitoso
        if (result.success) {
            await redisService.setCache(cacheKey, result, AI_CACHE_TTL);
        }

        return result;
    }

    /**
     * Simulación financiera con escenarios y recomendaciones IA.
     * FIX [M-07]: caché de 5 minutos para resultados de IA.
     */
    static async getSimulation(userId) {
        const cacheKey = `simulation:${userId}`;

        // Intentar recuperar del caché
        const cached = await redisService.getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        const data = await PersonalFinanceService._getCompletedTransactions(userId);

        if (data === null) {
            return {
                success: false,
                message: 'Dataset demasiado grande para simulación en memoria. Use el endpoint de análisis agregado.'
            };
        }

        const result = simulationService.simulate(data);

        // Guardar en caché si es exitoso
        if (result.success) {
            await redisService.setCache(cacheKey, result, AI_CACHE_TTL);
        }

        return result;
    }
}

module.exports = PersonalFinanceService;
