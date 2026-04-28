/**
 * @file user.routes.js
 * @description Rutas del módulo de usuarios.
 *
 * Montar en app.js:
 *   app.use('/api/users', require('./user.routes'));
 *
 * ─── Mapa de endpoints ────────────────────────────────────────────────────────
 *
 *  Perfil propio
 *  GET    /me                Usuario autenticado
 *  PATCH  /me                Actualizar perfil
 *  PATCH  /me/password       Cambiar contraseña
 *  DELETE /me                Eliminar cuenta propia
 *
 *  Admin
 *  GET    /                  Listar usuarios (admin)
 *  GET    /:id               Ver usuario (admin)
 *  PATCH  /:id               Editar usuario (admin)
 *  PATCH  /:id/status        Activar / desactivar (admin)
 *  DELETE /:id               Soft-delete (admin)
 */

'use strict';

const express        = require('express');
const AuthMiddleware = require('../middlewares/auth.middleware');
const ctrl           = require('../controllers/user.controller');

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(AuthMiddleware.protect);

// ─── Perfil propio (/me antes de /:id para evitar conflicto de path) ──────────

router.get('/me',            ctrl.getMe);
router.patch('/me',          ctrl.updateMe);
router.patch('/me/password', ctrl.changePassword);
router.delete('/me',         ctrl.deleteMe);

// ─── Admin ────────────────────────────────────────────────────────────────────

router.get(
    '/',
    AuthMiddleware.requireRole('admin', 'superadmin'),
    ctrl.listUsers
);

router.get(
    '/:id',
    AuthMiddleware.requireRole('admin', 'superadmin'),
    ctrl.getUserById
);

router.patch(
    '/:id',
    AuthMiddleware.requireRole('admin', 'superadmin'),
    ctrl.updateUser
);

router.patch(
    '/:id/status',
    AuthMiddleware.requireRole('admin', 'superadmin'),
    ctrl.setUserStatus
);

router.delete(
    '/:id',
    AuthMiddleware.requireRole('superadmin'),   // Solo superadmin elimina usuarios
    ctrl.deleteUser
);

module.exports = router;