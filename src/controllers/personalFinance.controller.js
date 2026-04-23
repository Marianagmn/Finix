const PersonalFinance = require('../models/personalFinance.model');
const Account = require('../models/Account');
const Category = require('../models/Category');
const predictionService = require('../services/prediction.service');
const simulationService = require('../services/simulation.service');
const analysisService = require('../services/financeAnalysis.service');

// Fix #3 & #10: Helper for standardized error responses
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

// Fix #7: Reusable function for completed transactions query
const getCompletedTransactions = async (userId, options = {}) => {
    const { limit = 10000, select = null } = options;
    
    const query = PersonalFinance.find({
        userId,
        estado: 'completado',
        esTransferenciaInterna: false  // Fix #4: Exclude internal transfers
    });
    
    if (select) query.select(select);
    
    return query.lean().limit(limit);
};

// Fix #8: Rate limiting check for analytics
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

exports.createFinance = async (req, res) => {
    try {
        // Fix #2: Remove internal/control fields from whitelist
        const allowedFields = [
            'tipo', 'monto', 'moneda', 'tasaCambio', 'categoria',
            'cuentaOrigenId', 'cuentaDestinoId', 'metodoPago',
            'descripcion', 'fecha', 'estado', 'esAhorro',
            'tags', 'location', 'notaTransaccion'
        ];

        const data = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                data[field] = req.body[field];
            }
        });

        // Fix #1: Validate ownership of referenced resources
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

        // Fix #6: Validate date range
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
            userId: req.user.id
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

exports.getAllFinances = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        // Sanitize and cap pagination params (prevent DOS)
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

exports.updateFinance = async (req, res) => {
    try {
        const allowedFields = [
            'tipo', 'monto', 'moneda', 'tasaCambio', 'categoria',
            'cuentaOrigenId', 'cuentaDestinoId', 'metodoPago',
            'descripcion', 'fecha', 'estado', 'esAhorro',
            'tags', 'location', 'notaTransaccion'
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
            updateData,
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

        res.status(200).json({
            success: true,
            message: 'Registro eliminado'
        });

    } catch (error) {
        handleError(res, error);
    }
};

exports.getAnalysis = async (req, res) => {
    try {
        // Fix #8: Check rate limit
        const limitCheck = await checkAnalyticsLimit(req.user.id);
        if (limitCheck.exceeded) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados registros para análisis. Máximo 10,000.' 
            });
        }

        // Fix #7: Use reusable query function
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

exports.getPrediction = async (req, res) => {
    try {
        // Fix #8: Check rate limit
        const limitCheck = await checkAnalyticsLimit(req.user.id);
        if (limitCheck.exceeded) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados registros para predicción. Máximo 10,000.' 
            });
        }

        // Fix #7: Use reusable query function
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

exports.getSimulation = async (req, res) => {
    try {
        // Fix #8: Check rate limit
        const limitCheck = await checkAnalyticsLimit(req.user.id);
        if (limitCheck.exceeded) {
            return res.status(429).json({ 
                success: false, 
                message: 'Demasiados registros para simulación. Máximo 10,000.' 
            });
        }

        // Fix #7: Use reusable query function
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