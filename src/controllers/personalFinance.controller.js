/**
 * Personal Finance Controller
 * Maneja todas las operaciones CRUD y análisis de finanzas personales
 * @module controllers/personalFinance.controller
 */

const PersonalFinance = require('../models/personalFinance.model');
const Account = require('../models/Account');
const Category = require('../models/Category');
const predictionService = require('../services/prediction.service');
const simulationService = require('../services/simulation.service');
const analysisService = require('../services/financeAnalysis.service');
const ApiResponse = require('../utils/response.utils');
const Pagination = require('../utils/pagination.utils');

/**
 * Maneja errores estandarizados para todas las respuestas
 * @param {Response} res - Express response object
 * @param {Error} error - Error capturado
 * @returns {Response} JSON response con formato estándar
 */
const handleError = (res, error) => {
    if (error.name === 'ValidationError') {
        return ApiResponse.error(res, error.message, { statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    if (error.name === 'CastError') {
        return ApiResponse.error(res, 'ID inválido', { statusCode: 400, code: 'INVALID_ID' });
    }
    return ApiResponse.error(res, 'Error interno del servidor', {
        statusCode: 500,
        code: 'INTERNAL_ERROR'
    });
};

/**
 * Normaliza montos desde centavos a moneda real
 * El modelo almacena en centavos (set: v => v * 100) pero lean() no aplica getters
 * @param {Array} transactions - Transacciones desde lean()
 * @returns {Array} Transacciones con montos normalizados
 */
const normalizeTransactionAmounts = (transactions) => {
    return transactions.map(t => ({
        ...t,
        monto: t.monto / 100  // Convertir centavos a moneda real
    }));
};

/**
 * Obtiene transacciones financieras completadas del usuario
 * @param {string} userId - ID del usuario
 * @param {object} options - Opciones de consulta (limit, select)
 * @returns {Promise<object[]>} Transacciones financieras completadas
 */
const getCompletedTransactions = async (userId, options = {}) => {
    const { limit = 10000, select = null } = options;
    
    const query = PersonalFinance.find({
        userId,
        estado: 'completado',
        esTransferenciaInterna: false  
    });
    
    if (select) query.select(select);
    
    const data = await query.lean().limit(limit);
    
    // FIX CRÍTICO: Normalizar montos de centavos a moneda real
    return normalizeTransactionAmounts(data);
};

/**
 * Verifica si el usuario ha excedido el límite de análisis financiero
 * @param {string} userId - ID del usuario
 * @returns {Promise<object>} Resultado de la verificación (exceeded, count)
 */
const checkAnalyticsLimit = async (userId) => {
    const count = await PersonalFinance.countDocuments({ 
        userId, 
        estado: 'completado',
        esTransferenciaInterna: false
    });
    
    if (count > 10000) {
        return { exceeded: true, count };
    }
    return { exceeded: false, count };
};

/**
 * Crea un nuevo registro financiero
 * Valida: propiedad de recursos referenciados, rango de fechas (máx 1 año atrás)
 * POST /finances -> 201 Created
 * @param {Request} req - Express request con body y user.id
 * @param {Response} res - Express response
 */
exports.createFinance = async (req, res) => {
    try {
        const allowedFields = [
            'tipo', 'monto', 'moneda', 'tasaCambio', 'categoria',
            'cuentaOrigenId', 'cuentaDestinoId', 'metodoPago',
            'descripcion', 'fecha', 'estado', 'esAhorro',
            'tags', 'location', 'notaTransaccion',
            'esTransferenciaInterna', 'transferenciaId', 'source'
        ];

        const data = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                data[field] = req.body[field];
            }
        });

        if (data.categoria) {
            const category = await Category.findOne({ _id: data.categoria, userId: req.user.userId });
            if (!category) {
                return ApiResponse.error(res, 'Categoría no autorizada', { statusCode: 403, code: 'FORBIDDEN' });
            }
        }

        if (data.cuentaOrigenId) {
            const account = await Account.findOne({ _id: data.cuentaOrigenId, userId: req.user.userId });
            if (!account) {
                return ApiResponse.error(res, 'Cuenta origen no autorizada', { statusCode: 403, code: 'FORBIDDEN' });
            }
        }

        if (data.cuentaDestinoId) {
            const account = await Account.findOne({ _id: data.cuentaDestinoId, userId: req.user.userId });
            if (!account) {
                return ApiResponse.error(res, 'Cuenta destino no autorizada', { statusCode: 403, code: 'FORBIDDEN' });
            }
        }

        if (data.fecha) {
            const fecha = new Date(data.fecha);
            const hoy = new Date();
            const unAnioAtras = new Date();
            unAnioAtras.setFullYear(unAnioAtras.getFullYear() - 1);
            
            if (fecha > hoy || fecha < unAnioAtras) {
                return ApiResponse.error(res, 'Fecha fuera de rango válido (máx 1 año atrás)', { statusCode: 400, code: 'INVALID_DATE' });
            }
        }

        const newFinance = new PersonalFinance({
            ...data,
            userId: req.user.userId,
            createdBy: req.user.userId
        });

        const saved = await newFinance.save();

        return ApiResponse.created(res, saved.toObject(), 'Registro creado correctamente');

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Obtiene todos los registros financieros del usuario con paginación
 * Soporta query params: page, limit (máx 100)
 * GET /finances -> 200 OK
 * @param {Request} req - Express request con query params
 * @param {Response} res - Express response
 */
exports.getAllFinances = async (req, res) => {
    try {
        const pager = new Pagination.OffsetPagination(req.query, {
            defaultLimit: 20,
            maxLimit: 100,
            allowedSortFields: ['fecha', 'monto', 'createdAt', 'estado'],
            defaultSort: '-fecha'
        });

        const query = PersonalFinance.find({ userId: req.user.userId })
            .select('tipo monto moneda categoria fecha estado descripcion esAhorro tags');

        const [finances, total] = await Promise.all([
            pager.applyTo(query).lean(),
            PersonalFinance.countDocuments({ userId: req.user.userId })
        ]);

        return ApiResponse.paginated(res, finances, pager.buildMeta(total));

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Obtiene un registro financiero por ID
 * Valida: propiedad del recurso (userId match)
 * GET /finances/:id -> 200 OK | 404 Not Found
 * @param {Request} req - Express request con params.id
 * @param {Response} res - Express response
 */
exports.getFinanceById = async (req, res) => {
    try {
        const finance = await PersonalFinance.findOne({
            _id: req.params.id,
            userId: req.user.userId
        }).select('tipo monto moneda categoria fecha estado descripcion esAhorro tags');

        if (!finance) {
            return ApiResponse.error(res, 'Registro no encontrado', { statusCode: 404, code: 'NOT_FOUND' });
        }

        return ApiResponse.success(res, finance.toObject());

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Actualiza un registro financiero existente (PUT completo)
 * Solo permite campos whitelist, valida propiedad
 * PUT /finances/:id -> 200 OK | 404 Not Found
 * @param {Request} req - Express request con params.id y body
 * @param {Response} res - Express response
 */
exports.updateFinance = async (req, res) => {
    try {
        const allowedFields = [
            'tipo', 'monto', 'moneda', 'tasaCambio', 'categoria',
            'cuentaOrigenId', 'cuentaDestinoId', 'metodoPago',
            'descripcion', 'fecha', 'estado', 'esAhorro',
            'tags', 'location', 'notaTransaccion',
            'esTransferenciaInterna', 'transferenciaId', 'source'
        ];

        const updateData = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        });

        const updated = await PersonalFinance.findOneAndUpdate(
            {
                _id: req.params.id,
                userId: req.user.userId
            },
            {
                ...updateData,
                updatedBy: req.user.userId
            },
            {
                new: true,
                runValidators: true
            }
        ).select('tipo monto moneda categoria fecha estado descripcion esAhorro tags');

        if (!updated) {
            return ApiResponse.error(res, 'Registro no encontrado', { statusCode: 404, code: 'NOT_FOUND' });
        }

        return ApiResponse.success(res, updated.toObject(), { message: 'Registro actualizado' });

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Elimina (soft delete) un registro financiero
 * DELETE /finances/:id -> 204 No Content | 404 Not Found
 * @param {Request} req - Express request con params.id
 * @param {Response} res - Express response
 */
exports.deleteFinance = async (req, res) => {
    try {
        const finance = await PersonalFinance.findOne({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (!finance) {
            return ApiResponse.error(res, 'Registro no encontrado', { statusCode: 404, code: 'NOT_FOUND' });
        }

        await finance.softDelete();

        return ApiResponse.noContent(res);

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Obtiene análisis financiero del usuario
 * Rate limit: máx 10,000 registros procesados
 * GET /finances/analysis -> 200 OK | 429 Too Many Requests
 * @param {Request} req - Express request con user.id
 * @param {Response} res - Express response
 */
exports.getAnalysis = async (req, res) => {
    try {
        
        const limitCheck = await checkAnalyticsLimit(req.user.userId);
        if (limitCheck.exceeded) {
            return ApiResponse.error(res, 'Demasiados registros para análisis. Máximo 10,000.', { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
        }

        const data = await getCompletedTransactions(req.user.userId);

        const analysis = analysisService.analyze(data);

        if (!analysis.success) {
            return ApiResponse.error(res, analysis.message, { statusCode: 400, code: 'ANALYSIS_ERROR' });
        }

        return ApiResponse.success(res, analysis.data);

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Obtiene predicción de gastos basada en historial
 * Rate limit: máx 10,000 registros + 10 req/min por usuario
 * GET /finances/prediction -> 200 OK | 429 Too Many Requests
 * @param {Request} req - Express request con user.id
 * @param {Response} res - Express response
 */
exports.getPrediction = async (req, res) => {
    try {
        const limitCheck = await checkAnalyticsLimit(req.user.userId);
        if (limitCheck.exceeded) {
            return ApiResponse.error(res, 'Demasiados registros para predicción. Máximo 10,000.', { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
        }

        const data = await getCompletedTransactions(req.user.userId);

        const prediction = predictionService.predict(data);

        if (!prediction.success) {
            return ApiResponse.error(res, prediction.message, { statusCode: 400, code: 'PREDICTION_ERROR' });
        }

        return ApiResponse.success(res, prediction.data, { message: prediction.message });

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Ejecuta simulación financiera con escenarios
 * Rate limit: máx 10,000 registros + 10 req/min por usuario
 * GET /finances/simulation -> 200 OK | 429 Too Many Requests
 * @param {Request} req - Express request con user.id
 * @param {Response} res - Express response
 */
exports.getSimulation = async (req, res) => {
    try {
        const limitCheck = await checkAnalyticsLimit(req.user.userId);
        if (limitCheck.exceeded) {
            return ApiResponse.error(res, 'Demasiados registros para simulación. Máximo 10,000.', { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
        }

        const data = await getCompletedTransactions(req.user.userId);

        const simulation = simulationService.simulate(data);

        if (!simulation.success) {
            return ApiResponse.error(res, simulation.message, { statusCode: 400, code: 'SIMULATION_ERROR' });
        }

        return ApiResponse.success(res, simulation.data, { message: simulation.message });

    } catch (error) {
        handleError(res, error);
    }
};