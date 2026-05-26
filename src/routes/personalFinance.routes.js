'use strict';

/**
 * @file personalFinance.routes.js
 * @description Rutas de finanzas personales.
 *
 * Rate limiting:
 *   - Endpoints AI (analysis, prediction, simulation): burst + rate limiters.
 *   - CRUD básico: sin rate limit adicional (el authMiddleware ya protege).
 */

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const router     = express.Router();

const financeController               = require('../controllers/personalFinance.controller');
const auth                            = require('../middlewares/auth.middleware');
const { validate, schemas }           = require('../middlewares/validate.middleware');
const { validateObjectId }            = require('../middlewares/validateObjectId.middleware');

// ─── Rate limiters ─────────────────────────────────────────────────────────────

/** Rate limiter para endpoints AI costosos: 10 req/min por usuario */
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user?.userId || req.ip, // Se usa userId del token, no el id de la query
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Límite de peticiones alcanzado. Intenta de nuevo en un minuto.' }
});

/** Burst protection: máx 5 req en 10 segundos */
const burstLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 5,
    keyGenerator: (req) => req.user?.userId || req.ip, // Se usa userId del token para rate limiting
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
});

// ─── Middleware global de auth ─────────────────────────────────────────────────

router.use(auth.protect);

// ─── Analytics & AI (antes de /:id para evitar conflictos de path) ─────────────

router.get('/analysis',   burstLimiter, aiLimiter, financeController.getAnalysis);
router.get('/prediction', burstLimiter, aiLimiter, financeController.getPrediction);
router.get('/simulation', burstLimiter, aiLimiter, financeController.getSimulation);

// ─── Soft Delete / Restauración (antes de /:id para evitar conflictos de path) ──

router.get('/trash', financeController.getDeletedTransactions);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get('/',  financeController.getAllFinances);

// Validación de schema Zod para creación de transacciones
router.post('/', validate(schemas.personalFinance.create), financeController.createFinance);

router.get('/:id',    validateObjectId(), financeController.getFinanceById);

// Validación de schema Zod para actualización de transacciones
router.put('/:id',    validateObjectId(), validate(schemas.personalFinance.update), financeController.updateFinance);
router.delete('/:id', validateObjectId(), financeController.deleteFinance);

// ─── Soft Delete / Restauración ────────────────────────────────────────────────

/** PUT /:id/restore - Restaurar una transacción eliminada */
router.put('/:id/restore', validateObjectId(), financeController.restoreTransaction);

/** DELETE /:id/permanent - Eliminar permanentemente una transacción */
router.delete('/:id/permanent', validateObjectId(), financeController.permanentlyDeleteTransaction);

/**
 * Montar en app.js como:
 *   app.use('/api/personal-finance', require('./routes/personalFinance.routes'));
 */
module.exports = router;