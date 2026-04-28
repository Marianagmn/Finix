/**
 * @file account.routes.js
 * @description CRUD de cuentas financieras (efectivo, banco, crédito, etc.)
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const AuthMiddleware = require('../middlewares/auth.middleware');
const Account = require('../models/Account');
const ApiResponse = require('../utils/response.utils');

const router = express.Router();

// Rate limiter para operaciones de escritura (crear, actualizar, eliminar)
const writeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10, // 10 operaciones por minuto
    keyGenerator: (req) => req.user?.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        code: 'TOO_MANY_REQUESTS',
        message: 'Límite de operaciones alcanzado. Intente de nuevo en un minuto.'
    }
});

// Todas las rutas requieren autenticación
router.use(AuthMiddleware.protect);

/**
 * Valida ObjectId
 */
const validateObjectId = (req, res, next) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({
            success: false,
            code: 'INVALID_ID',
            message: 'ID de cuenta inválido'
        });
    }
    next();
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts
 * Lista todas las cuentas del usuario
 */
router.get('/', async (req, res, next) => {
    try {
        const accounts = await Account.find({ userId: req.user.userId })
            .select('-isDeleted -deletedAt -__v')
            .sort({ createdAt: -1 });

        ApiResponse.success(res, accounts);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/accounts
 * Crea una nueva cuenta
 */
router.post('/', writeLimiter, async (req, res, next) => {
    try {
        const { nombre, tipo, moneda, balance } = req.body;

        const account = await Account.create({
            userId: req.user.userId,
            nombre,
            tipo,
            moneda: moneda || 'COP',
            balance: balance || 0
        });

        ApiResponse.created(res, account.toObject(), 'Cuenta creada exitosamente');
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/accounts/:id
 * Obtiene una cuenta por ID
 */
router.get('/:id', validateObjectId, async (req, res, next) => {
    try {
        const account = await Account.findOne({
            _id: req.params.id,
            userId: req.user.userId
        }).select('-isDeleted -deletedAt -__v');

        if (!account) {
            return ApiResponse.error(res, 'Cuenta no encontrada', { statusCode: 404, code: 'NOT_FOUND' });
        }

        ApiResponse.success(res, account.toObject());
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/accounts/:id
 * Actualiza una cuenta
 */
router.put('/:id', validateObjectId, writeLimiter, async (req, res, next) => {
    try {
        const { nombre, tipo, moneda, balance, isActive } = req.body;

        const account = await Account.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { nombre, tipo, moneda, balance, isActive },
            { new: true, runValidators: true }
        ).select('-isDeleted -deletedAt -__v');

        if (!account) {
            return ApiResponse.error(res, 'Cuenta no encontrada', { statusCode: 404, code: 'NOT_FOUND' });
        }

        ApiResponse.success(res, account.toObject(), { message: 'Cuenta actualizada' });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/accounts/:id
 * Soft-delete de una cuenta
 */
router.delete('/:id', validateObjectId, writeLimiter, async (req, res, next) => {
    try {
        const account = await Account.findOne({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (!account) {
            return ApiResponse.error(res, 'Cuenta no encontrada', { statusCode: 404, code: 'NOT_FOUND' });
        }

        await account.softDelete();
        ApiResponse.noContent(res);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
