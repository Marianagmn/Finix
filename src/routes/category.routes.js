'use strict';

/**
 * @file category.routes.js
 * @description CRUD de categorías de transacciones.
 *
 */

const express     = require('express');
const rateLimit   = require('express-rate-limit');
const router      = express.Router();

const AuthMiddleware       = require('../middlewares/auth.middleware');
const CategoryService      = require('../services/category.service');
const ApiResponse          = require('../utils/response.utils');
const { validateObjectId } = require('../middlewares/validateObjectId.middleware');

const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user?.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'Límite de operaciones alcanzado.' }
});

router.use(AuthMiddleware.protect);

// ─── GET /api/categories ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
    try {
        const categories = await CategoryService.list(req.user.userId, req.query.tipo);
        ApiResponse.success(res, categories);
    } catch (err) { next(err); }
});

// ─── POST /api/categories ─────────────────────────────────────────────────────
router.post('/', writeLimiter, async (req, res, next) => {
    try {
        const category = await CategoryService.create(req.body, req.user.userId);
        ApiResponse.created(res, category, 'Categoría creada exitosamente');
    } catch (err) { next(err); }
});

// ─── GET /api/categories/:id ──────────────────────────────────────────────────
router.get('/:id', validateObjectId(), async (req, res, next) => {
    try {
        const category = await CategoryService.getById(req.params.id, req.user.userId);
        ApiResponse.success(res, category);
    } catch (err) { next(err); }
});

// ─── PUT /api/categories/:id ──────────────────────────────────────────────────
router.put('/:id', validateObjectId(), writeLimiter, async (req, res, next) => {
    try {
        const category = await CategoryService.update(req.params.id, req.user.userId, req.body);
        ApiResponse.success(res, category, { message: 'Categoría actualizada' });
    } catch (err) { next(err); }
});

// ─── DELETE /api/categories/:id ───────────────────────────────────────────────
router.delete('/:id', validateObjectId(), writeLimiter, async (req, res, next) => {
    try {
        await CategoryService.softDelete(req.params.id, req.user.userId);
        ApiResponse.noContent(res);
    } catch (err) { next(err); }
});

module.exports = router;
