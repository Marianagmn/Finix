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
 *  PATCH  /:id                      Actualizar borrador
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
const AuthMiddleware = require('./auth.middleware');
const ctrl           = require('./businessFinance.controller');

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(AuthMiddleware.protect);

// ─── Consultas especiales (antes de /:id para evitar conflictos de path) ──────

// GET /api/business-finance/approvals/pending
router.get('/approvals/pending', ctrl.getPendingApprovals);

// GET /api/business-finance/overdue/cobrar
// GET /api/business-finance/overdue/pagar
router.get('/overdue/:tipo', ctrl.getOverdue);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.post('/',    ctrl.create);
router.get('/',     ctrl.list);
router.get('/:id',  ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

// ─── Flujo de aprobación ──────────────────────────────────────────────────────

// Cualquier usuario autenticado puede enviar sus borradores a aprobación
router.post('/:id/submit', ctrl.submitForApproval);

// Aprobar y rechazar requieren rol de aprobador
router.post(
    '/:id/approve',
    AuthMiddleware.requireRole('admin', 'superadmin', 'aprobador'),
    ctrl.approve
);

router.post(
    '/:id/reject',
    AuthMiddleware.requireRole('admin', 'superadmin', 'aprobador'),
    ctrl.reject
);

// ─── Contabilización ──────────────────────────────────────────────────────────

// Solo contadores y admins pueden postear al ledger
router.post(
    '/:id/post',
    AuthMiddleware.requireRole('admin', 'superadmin', 'contador'),
    ctrl.post
);

// El reverso también requiere rol contable
router.post(
    '/:id/reverse',
    AuthMiddleware.requireRole('admin', 'superadmin', 'contador'),
    ctrl.reverse
);

// ─── Pagos ────────────────────────────────────────────────────────────────────

router.post('/:id/payments', ctrl.applyPayment);

// ─── Impuestos ────────────────────────────────────────────────────────────────

router.post('/:id/taxes/recalculate', ctrl.recalculateTaxes);

module.exports = router;