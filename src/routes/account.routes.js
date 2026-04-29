'use strict';

/**
 * @file account.routes.js
 * @description CRUD de cuentas financieras.
 *
 */

const express     = require('express');
const rateLimit   = require('express-rate-limit');
const router      = express.Router();

const AuthMiddleware               = require('../middlewares/auth.middleware');
const AccountService               = require('../services/account.service');
const ApiResponse                  = require('../utils/response.utils');
const { validateObjectId }         = require('../middlewares/validateObjectId.middleware');

// Rate limiter para escrituras
const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user?.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'Límite de operaciones alcanzado.' }
});

router.use(AuthMiddleware.protect);

// ─── GET /api/accounts ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
    try {
        const accounts = await AccountService.list(req.user.userId);
        ApiResponse.success(res, accounts);
    } catch (err) { next(err); }
});

// ─── POST /api/accounts ───────────────────────────────────────────────────────
router.post('/', writeLimiter, async (req, res, next) => {
    try {
        const account = await AccountService.create(req.body, req.user.userId);
        ApiResponse.created(res, account, 'Cuenta creada exitosamente');
    } catch (err) { next(err); }
});

// ─── GET /api/accounts/:id ────────────────────────────────────────────────────
router.get('/:id', validateObjectId(), async (req, res, next) => {
    try {
        const account = await AccountService.getById(req.params.id, req.user.userId);
        ApiResponse.success(res, account);
    } catch (err) { next(err); }
});

// ─── PUT /api/accounts/:id ────────────────────────────────────────────────────
router.put('/:id', validateObjectId(), writeLimiter, async (req, res, next) => {
    try {
        const account = await AccountService.update(req.params.id, req.user.userId, req.body);
        ApiResponse.success(res, account, { message: 'Cuenta actualizada' });
    } catch (err) { next(err); }
});

// ─── DELETE /api/accounts/:id ─────────────────────────────────────────────────
router.delete('/:id', validateObjectId(), writeLimiter, async (req, res, next) => {
    try {
        await AccountService.softDelete(req.params.id, req.user.userId);
        ApiResponse.noContent(res);
    } catch (err) { next(err); }
});

module.exports = router;
