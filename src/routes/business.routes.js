/**
 * @file business.routes.js
 * @description Rutas del módulo de gestión de empresas/negocios.
 *
 * Montar en app.js:
 *   app.use('/api/business', require('./business.routes'));
 *
 * Todas las rutas requieren autenticación (AuthMiddleware.protect).
 *
 * ─── Mapa de endpoints ────────────────────────────────────────────────────────
 *
 *  CRUD base
 *  POST   /                         Crear negocio
 *  GET    /                         Listar negocios con filtros y paginación
 *  GET    /active                   Listar negocios activos (para selectores)
 *  GET    /:id                      Obtener un negocio
 *  GET    /nit/:nit                 Buscar por NIT
 *  PUT    /:id                      Actualizar negocio
 *  DELETE /:id                      Soft-delete
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const AuthMiddleware = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/business.controller');

const router = express.Router();

/**
 * Valida ObjectId en params
 */
const validateObjectId = (param) => (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params[param])) {
    return res.status(400).json({
      success: false,
      message: `ID inválido: ${param}`
    });
  }
  next();
};

// Rate limiter para operaciones de escritura
const writeLimiter = rateLimit({
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

// Todas las rutas requieren autenticación
router.use(AuthMiddleware.protect);

// ─── Consultas especiales (antes de /:id para evitar conflictos de path) ──────

// GET /api/business/active - Lista negocios activos para selectores
router.get('/active', ctrl.listActive);

// GET /api/business/nit/:nit - Buscar por NIT
router.get('/nit/:nit', ctrl.findByNit);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.post('/', writeLimiter, ctrl.create);
router.get('/', ctrl.list);
router.get('/:id', validateObjectId('id'), ctrl.getOne);
router.put('/:id', validateObjectId('id'), writeLimiter, ctrl.update);
router.delete('/:id', validateObjectId('id'), writeLimiter, ctrl.remove);

module.exports = router;
