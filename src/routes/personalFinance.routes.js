'use strict';

/**
 * @file personalFinance.routes.js
 * @description Rutas de finanzas personales.
 *
 * FIX [C-07/R-06]: Conectados los schemas Zod de validate.middleware en POST/PUT.
 * FIX [R-14]:      Reemplazado validateObjectId inline por middleware compartido.
 * FIX [R-17]:      logAccess consolidado como middleware local hasta extraer a logger.utils.
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
    keyGenerator: (req) => req.user?.userId || req.ip, // FIX [I-04]: userId no id
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Límite de peticiones alcanzado. Intenta de nuevo en un minuto.' }
});

/** Burst protection: máx 5 req en 10 segundos */
const burstLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 5,
    keyGenerator: (req) => req.user?.userId || req.ip, // FIX [I-04]
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

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get('/',  financeController.getAllFinances);

// FIX [C-07/R-06]: validate(schemas.personalFinance.create) conectado
router.post('/', validate(schemas.personalFinance.create), financeController.createFinance);

router.get('/:id',    validateObjectId(), financeController.getFinanceById);

// FIX [C-07/R-06]: validate(schemas.personalFinance.update) conectado
router.put('/:id',    validateObjectId(), validate(schemas.personalFinance.update), financeController.updateFinance);
router.delete('/:id', validateObjectId(), financeController.deleteFinance);

/**
 * Montar en app.js como:
 *   app.use('/api/v1/finances', require('./routes/personalFinance.routes'));
 */
module.exports = router;