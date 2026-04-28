'use strict';

/**
 * @file personalFinance.controller.js
 * @description Controller delgado para finanzas personales.
 *
 * FIX [C-06/R-01]: Toda la lógica de negocio movida a PersonalFinanceService.
 * FIX [I-05]:      Reemplazado handleError() local por next(err) para usar el
 *                  error handler global y mantener trazabilidad de requestId.
 * FIX [C-08/I-01]: Removido 'new Pagination.OffsetPagination()' — la API
 *                  correcta es PersonalFinanceService.list() que usa Pagination.offset().
 *
 * El controller solo:
 *   1. Parsea req (body, params, query, user)
 *   2. Llama al service
 *   3. Formatea la respuesta con ApiResponse
 */

const PersonalFinanceService = require('../services/personalFinance.service');
const ApiResponse            = require('../utils/response.utils');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ANALYTICS_LIMIT = parseInt(process.env.ANALYTICS_RECORD_LIMIT, 10) || 10_000;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/finances
 * Crea una nueva transacción personal.
 */
exports.createFinance = async (req, res, next) => {
    try {
        const finance = await PersonalFinanceService.create(req.body, req.user.userId);
        ApiResponse.created(res, finance, 'Registro creado exitosamente');
    } catch (err) {
        next(err); // FIX [I-05]: next(err) en lugar de handleError local
    }
};

/**
 * GET /api/finances
 * Lista transacciones del usuario con filtros y paginación.
 */
exports.getAllFinances = async (req, res, next) => {
    try {
        const { items, total, pager } = await PersonalFinanceService.list(
            req.user.userId,
            req.query
        );
        ApiResponse.paginated(res, items, pager.buildMeta(total));
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/finances/:id
 * Obtiene una transacción por ID.
 */
exports.getFinanceById = async (req, res, next) => {
    try {
        const finance = await PersonalFinanceService.getById(req.params.id, req.user.userId);
        ApiResponse.success(res, finance);
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/finances/:id
 * Actualiza una transacción existente.
 */
exports.updateFinance = async (req, res, next) => {
    try {
        const finance = await PersonalFinanceService.update(
            req.params.id,
            req.user.userId,
            req.body
        );
        ApiResponse.success(res, finance, { message: 'Registro actualizado exitosamente' });
    } catch (err) {
        next(err);
    }
};

/**
 * DELETE /api/finances/:id
 * Soft-delete de una transacción.
 */
exports.deleteFinance = async (req, res, next) => {
    try {
        await PersonalFinanceService.softDelete(req.params.id, req.user.userId);
        ApiResponse.noContent(res);
    } catch (err) {
        next(err);
    }
};

// ─── Analytics / AI ───────────────────────────────────────────────────────────

/**
 * GET /api/finances/analysis
 * Análisis financiero: ingresos, gastos, categorías, promedios.
 * FIX [M-01]: usa aggregation para >500 registros (via service).
 */
exports.getAnalysis = async (req, res, next) => {
    try {
        const { fechaDesde, fechaHasta } = req.query;
        const result = await PersonalFinanceService.getAnalysis(
            req.user.userId,
            fechaDesde,
            fechaHasta
        );

        if (!result.success) {
            return ApiResponse.error(res, result.message, { statusCode: 422, code: 'ANALYSIS_ERROR' });
        }
        ApiResponse.success(res, result.data);
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/finances/prediction
 * Predicción del próximo gasto usando regresión lineal + modelo ensemble.
 */
exports.getPrediction = async (req, res, next) => {
    try {
        const result = await PersonalFinanceService.getPrediction(req.user.userId);

        if (!result.success) {
            return ApiResponse.error(res, result.message, { statusCode: 422, code: 'PREDICTION_ERROR' });
        }
        ApiResponse.success(res, result.data);
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/finances/simulation
 * Simulación financiera con escenarios, score y recomendaciones IA.
 */
exports.getSimulation = async (req, res, next) => {
    try {
        const result = await PersonalFinanceService.getSimulation(req.user.userId);

        if (!result.success) {
            return ApiResponse.error(res, result.message, { statusCode: 422, code: 'SIMULATION_ERROR' });
        }
        ApiResponse.success(res, result.data);
    } catch (err) {
        next(err);
    }
};