/**
 * @file businessFinance.routes.js
 * @description Rutas del módulo de finanzas empresariales.
 *
 * Montar en app.js:
 *   app.use('/api/business-finance', require('./businessFinance.routes'));
 *
 * Todas las rutas requieren autenticación (AuthMiddleware.protect).
 * Las rutas de aprobación y contabilización requieren roles específicos.
 *
 * ─── Mapa de endpoints ────────────────────────────────────────────────────────
 *
 *  CRUD base
 *  POST   /                         Crear transacción (borrador)
 *  GET    /                         Listar con filtros y paginación
 *  GET    /:id                      Obtener una transacción
 *  PUT    /:id                      Actualizar borrador
 *  DELETE /:id                      Soft-delete
 *
 *  Flujo de aprobación
 *  POST   /:id/submit               Enviar a aprobación
 *  POST   /:id/approve              Aprobar nivel actual
 *  POST   /:id/reject               Rechazar
 *
 *  Contabilización
 *  POST   /:id/post                 Contabilizar (postear al ledger)
 *  POST   /:id/reverse              Generar reverso contable
 *
 *  Pagos (A/R y A/P)
 *  POST   /:id/payments             Aplicar pago parcial o total
 *
 *  Impuestos
 *  POST   /:id/taxes/recalculate    Recalcular impuestos del borrador
 *
 *  Consultas especiales
 *  GET    /approvals/pending        Mis transacciones por aprobar
 *  GET    /overdue/:tipo            Vencidas (tipo: cobrar | pagar)
 */

'use strict';

const express        = require('express');
const mongoose       = require('mongoose');
const rateLimit      = require('express-rate-limit');
const AuthMiddleware = require('../middlewares/auth.middleware');
const ctrl           = require('../controllers/businessFinance.controller');

const router = express.Router();

/**
 * Logger simple para endpoints sensibles
 * TODO: Reemplazar con Winston/Pino en producción
 */
const logAccess = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.user?.id || 'anon'} - ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    });
    next();
};

/**
 * Rate limiter para consultas costosas (approvals, overdue)
 * 10 req/min por usuario
 */
const queryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user?.userId || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Límite de peticiones alcanzado. Intenta de nuevo en un minuto.'
    }
});

/**
 * Burst protection: máx 5 req en 10 segundos
 */
const burstLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 5,
    keyGenerator: (req) => req.user?.userId || req.ip, // Se usa userId del token para rate limiting
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

/**
 * Valida múltiples ObjectIds en params
 * @param  {...string} params - Nombres de parámetros a validar
 * @returns {Function} Express middleware
 */
const validateObjectId = (...params) => (req, res, next) => {
    for (const param of params) {
        if (!mongoose.Types.ObjectId.isValid(req.params[param])) {
            return res.status(400).json({
                success: false,
                message: `ID inválido: ${param}`
            });
        }
    }
    next();
};

// Todas las rutas requieren autenticación
router.use(AuthMiddleware.protect);

// ─── Consultas especiales (antes de /:id para evitar conflictos de path) ──────

// GET /api/business-finance/approvals/pending
router.get('/approvals/pending', logAccess, queryLimiter, ctrl.getPendingApprovals);

// GET /api/business-finance/overdue/cobrar
// GET /api/business-finance/overdue/pagar
router.get('/overdue/:tipo', logAccess, queryLimiter, ctrl.getOverdue);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.post('/',    ctrl.create);
router.get('/',     ctrl.list);
router.get('/:id',  validateObjectId('id'), ctrl.getOne);
router.put('/:id', validateObjectId('id'), ctrl.update);
router.delete('/:id', validateObjectId('id'), ctrl.remove);

// ─── Flujo de aprobación ──────────────────────────────────────────────────────

// Cualquier usuario autenticado puede enviar sus borradores a aprobación
router.post('/:id/submit', validateObjectId('id'), ctrl.submitForApproval);

// Aprobar y rechazar requieren rol de aprobador
router.post(
    '/:id/approve',
    validateObjectId('id'),
    AuthMiddleware.requireRole('admin', 'superadmin', 'aprobador'),
    burstLimiter,
    ctrl.approve
);

router.post(
    '/:id/reject',
    validateObjectId('id'),
    AuthMiddleware.requireRole('admin', 'superadmin', 'aprobador'),
    burstLimiter,
    ctrl.reject
);

// ─── Contabilización ──────────────────────────────────────────────────────────

// Solo contadores y admins pueden postear al ledger
router.post(
    '/:id/post',
    validateObjectId('id'),
    AuthMiddleware.requireRole('admin', 'superadmin', 'contador'),
    burstLimiter,
    ctrl.post
);

// El reverso también requiere rol contable
router.post(
    '/:id/reverse',
    validateObjectId('id'),
    AuthMiddleware.requireRole('admin', 'superadmin', 'contador'),
    burstLimiter,
    ctrl.reverse
);

// ─── Pagos ────────────────────────────────────────────────────────────────────

router.post('/:id/payments', validateObjectId('id'), ctrl.applyPayment);

// ─── Impuestos ────────────────────────────────────────────────────────────────

router.post('/:id/taxes/recalculate', validateObjectId('id'), ctrl.recalculateTaxes);

module.exports = router;