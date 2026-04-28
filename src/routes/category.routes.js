/**
 * @file category.routes.js
 * @description CRUD de categorías de transacciones
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const AuthMiddleware = require('../middlewares/auth.middleware');
const Category = require('../models/Category');
const ApiResponse = require('../utils/response.utils');

const router = express.Router();

// Rate limiter para operaciones de escritura
const writeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10,
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
            message: 'ID de categoría inválido'
        });
    }
    next();
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/categories
 * Lista todas las categorías del usuario
 */
router.get('/', async (req, res, next) => {
    try {
        const { tipo } = req.query;
        const filter = { userId: req.user.userId };
        
        if (tipo) filter.tipo = tipo;

        const categories = await Category.find(filter)
            .select('-isDeleted -deletedAt -__v')
            .sort({ nombre: 1 });

        ApiResponse.success(res, categories);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/categories
 * Crea una nueva categoría
 */
router.post('/', writeLimiter, async (req, res, next) => {
    try {
        const { nombre, tipo, color, icono } = req.body;

        const category = await Category.create({
            userId: req.user.userId,
            nombre: nombre.toLowerCase().trim(),
            tipo,
            color,
            icono
        });

        ApiResponse.created(res, category.toObject(), 'Categoría creada exitosamente');
    } catch (err) {
        if (err.code === 11000) {
            return ApiResponse.error(res, 'Ya existe una categoría con ese nombre', { 
                statusCode: 409, 
                code: 'DUPLICATE_CATEGORY' 
            });
        }
        next(err);
    }
});

/**
 * GET /api/categories/:id
 * Obtiene una categoría por ID
 */
router.get('/:id', validateObjectId, async (req, res, next) => {
    try {
        const category = await Category.findOne({
            _id: req.params.id,
            userId: req.user.userId
        }).select('-isDeleted -deletedAt -__v');

        if (!category) {
            return ApiResponse.error(res, 'Categoría no encontrada', { statusCode: 404, code: 'NOT_FOUND' });
        }

        ApiResponse.success(res, category.toObject());
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/categories/:id
 * Actualiza una categoría
 */
router.put('/:id', validateObjectId, writeLimiter, async (req, res, next) => {
    try {
        const { nombre, tipo, color, icono } = req.body;

        const updateData = {};
        if (nombre) updateData.nombre = nombre.toLowerCase().trim();
        if (tipo) updateData.tipo = tipo;
        if (color) updateData.color = color;
        if (icono) updateData.icono = icono;

        const category = await Category.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            updateData,
            { new: true, runValidators: true }
        ).select('-isDeleted -deletedAt -__v');

        if (!category) {
            return ApiResponse.error(res, 'Categoría no encontrada', { statusCode: 404, code: 'NOT_FOUND' });
        }

        ApiResponse.success(res, category.toObject(), { message: 'Categoría actualizada' });
    } catch (err) {
        if (err.code === 11000) {
            return ApiResponse.error(res, 'Ya existe una categoría con ese nombre', { 
                statusCode: 409, 
                code: 'DUPLICATE_CATEGORY' 
            });
        }
        next(err);
    }
});

/**
 * DELETE /api/categories/:id
 * Soft-delete de una categoría
 */
router.delete('/:id', validateObjectId, writeLimiter, async (req, res, next) => {
    try {
        const category = await Category.findOne({
            _id: req.params.id,
            userId: req.user.userId
        });

        if (!category) {
            return ApiResponse.error(res, 'Categoría no encontrada', { statusCode: 404, code: 'NOT_FOUND' });
        }

        await category.softDelete();
        ApiResponse.noContent(res);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
