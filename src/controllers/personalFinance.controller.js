const PersonalFinance = require('../models/personalFinance.model');
const predictionService = require('../services/prediction.service');
const simulationService = require('../services/simulation.service');
const analysisService = require('../services/financeAnalysis.service');
   
exports.createFinance = async (req, res) => {
    try {
        const data = req.body;

        const newFinance = new PersonalFinance({
            ...data,
            userId: req.user.id
        });

        const saved = await newFinance.save();

        res.status(201).json({
            message: 'Registro creado correctamente',
            data: saved
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error al crear registro',
            error: error.message
        });
    }
};


exports.getAllFinances = async (req, res) => {
    try {
        const finances = await PersonalFinance.find({
            userId: req.user.id
        }).sort({ fecha: -1 });

        res.status(200).json(finances);

    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener registros',
            error: error.message
        });
    }
};


exports.getFinanceById = async (req, res) => {
    try {
        const finance = await PersonalFinance.findOne({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!finance) {
            return res.status(404).json({ message: 'Registro no encontrado' });
        }

        res.status(200).json(finance);

    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener registro',
            error: error.message
        });
    }
};


exports.updateFinance = async (req, res) => {
    try {
        const updated = await PersonalFinance.findOneAndUpdate(
            {
                _id: req.params.id,
                userId: req.user.id
            },
            req.body,
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Registro no encontrado' });
        }

        res.status(200).json({
            message: 'Registro actualizado',
            data: updated
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error al actualizar',
            error: error.message
        });
    }
};

exports.deleteFinance = async (req, res) => {
    try {
        const deleted = await PersonalFinance.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id
        });

        if (!deleted) {
            return res.status(404).json({ message: 'Registro no encontrado' });
        }

        res.status(200).json({
            message: 'Registro eliminado'
        });

    } catch (error) {
        res.status(500).json({
            message: 'Error al eliminar',
            error: error.message
        });
    }
};

exports.getAnalysis = async (req, res) => {
    try {
        const data = await PersonalFinance.find({
            userId: req.user.id
        });

        const analysis = analysisService.analyze(data);

        res.status(200).json(analysis);

    } catch (error) {
        res.status(500).json({
            message: 'Error en análisis',
            error: error.message
        });
    }
};

exports.getPrediction = async (req, res) => {
    try {
        const data = await PersonalFinance.find({
            userId: req.user.id
        });

        const prediction = predictionService.predict(data);

        res.status(200).json(prediction);

    } catch (error) {
        res.status(500).json({
            message: 'Error en predicción',
            error: error.message
        });
    }
};

exports.getSimulation = async (req, res) => {
    try {
        const data = await PersonalFinance.find({
            userId: req.user.id
        });

        const simulation = simulationService.simulate(data);

        res.status(200).json(simulation);

    } catch (error) {
        res.status(500).json({
            message: 'Error en simulación',
            error: error.message
        });
    }
};