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

/**
 * Maneja errores estandarizados para todas las respuestas
 * @param {Response} res - Express response object
 * @param {Error} error - Error capturado
 * @returns {Response} JSON response con formato estándar
 */
const handleError = (res, error) => {
    if (error.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: error.message });
    }
    if (error.name === 'CastError') {
        return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    return res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: error.message
    });
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
    
    return query.lean().limit(limit);
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
            const category = await Category.findOne({ _id: data.categoria, userId: req.user.id });
            if (!category) {
                return res.status(403).json({ success: false, message: 'Categoría no autorizada' });
            }
        }

        if (data.cuentaOrigenId) {
            const account = await Account.findOne({ _id: data.cuentaOrigenId, userId: req.user.id });
            if (!account) {
                return res.status(403).json({ success: false, message: 'Cuenta origen no autorizada' });
            }
        }

        if (data.cuentaDestinoId) {
            const account = await Account.findOne({ _id: data.cuentaDestinoId, userId: req.user.id });
            if (!account) {
                return res.status(403).json({ success: false, message: 'Cuenta destino no autorizada' });
            }
        }

        if (data.fecha) {
            const fecha = new Date(data.fecha);
            const hoy = new Date();
            const unAnioAtras = new Date();
            unAnioAtras.setFullYear(unAnioAtras.getFullYear() - 1);
            
            if (fecha > hoy || fecha < unAnioAtras) {
                return res.status(400).json({ success: false, message: 'Fecha fuera de rango válido (máx 1 año atrás)' });
            }
        }

        const newFinance = new PersonalFinance({
            ...data,
            userId: req.user.id,
            createdBy: req.user.id
        });

        const saved = await newFinance.save();

        res.status(201).json({
            success: true,
            message: 'Registro creado correctamente',
            data: saved.toObject()
        });

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
        const { page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

        const [finances, total] = await Promise.all([
            PersonalFinance.find({ userId: req.user.id })
                .sort({ fecha: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .select('tipo monto moneda categoria fecha estado descripcion esAhorro tags')
                .lean(),

            PersonalFinance.countDocuments({ userId: req.user.id })
        ]);

        res.status(200).json({
            success: true,
            data: finances,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });

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
            userId: req.user.id
        }).select('tipo monto moneda categoria fecha estado descripcion esAhorro tags');

        if (!finance) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        res.status(200).json({
            success: true,
            data: finance.toObject()
        });

    } catch (error) {
        handleError(res, error);
    }
};

/**
 * Actualiza un registro financiero existente
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
                userId: req.user.id
            },
            {
                ...updateData,
                updatedBy: req.user.id
            },
            {
                new: true,
                runValidators: true
            }
        ).select('tipo monto moneda categoria fecha estado descripcion esAhorro tags');

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        res.status(200).json({
            success: true,
            message: 'Registro actualizado',
            data: updated.toObject()
        });

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
            userId: req.user.id
        });

        if (!finance) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        await finance.softDelete();

        // 204 No Content - estándar REST para DELETE exitoso
        res.status(204).send();

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
        
        const limitCheck = await checkAnalyticsLimit(req.user.id);
        if (limitCheck.exceeded) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados registros para análisis. Máximo 10,000.' 
            });
        }

        const data = await getCompletedTransactions(req.user.id);

        const analysis = analysisService.analyze(data);

        res.status(200).json({
            success: true,
            data: analysis
        });

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
        const limitCheck = await checkAnalyticsLimit(req.user.id);
        if (limitCheck.exceeded) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados registros para predicción. Máximo 10,000.' 
            });
        }

        const data = await getCompletedTransactions(req.user.id);

        const prediction = predictionService.predict(data);

        res.status(200).json({
            success: true,
            data: prediction
        });

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
        const limitCheck = await checkAnalyticsLimit(req.user.id);
        if (limitCheck.exceeded) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados registros para simulación. Máximo 10,000.' 
            });
        }

        const data = await getCompletedTransactions(req.user.id);

        const simulation = simulationService.simulate(data);

        res.status(200).json({
            success: true,
            data: simulation
        });

    } catch (error) {
        handleError(res, error);
    }
};