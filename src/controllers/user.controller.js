/**
 * @file user.controller.js
 * @description Controllers de usuario — perfil, contraseña, admin CRUD.
 *
 * Endpoints:
 *   GET    /api/users/me                  — Perfil del usuario autenticado
 *   PATCH  /api/users/me                  — Actualizar perfil propio
 *   PATCH  /api/users/me/password         — Cambiar contraseña
 *   DELETE /api/users/me                  — Eliminar cuenta propia (soft)
 *
 *   [Admin]
 *   GET    /api/users                     — Listar usuarios paginado
 *   GET    /api/users/:id                 — Ver usuario por ID
 *   PATCH  /api/users/:id                 — Editar usuario
 *   PATCH  /api/users/:id/status          — Activar / desactivar
 *   DELETE /api/users/:id                 — Soft delete
 *
 * Todos los handlers delegan lógica a UserService.
 */

'use strict';

const UserService  = require('../services/user.service');
const ApiResponse  = require('../utils/response.utils');
const Pagination   = require('../utils/pagination.utils');

// ─── Perfil propio ────────────────────────────────────────────────────────────

/**
 * GET /api/users/me
 * Retorna el perfil del usuario autenticado.
 * req.user viene de AuthMiddleware.protect.
 */
async function getMe(req, res, next) {
    try {
        const user = await UserService.getById(req.user.userId);
        ApiResponse.success(res, user);
    } catch (err) {
        next(err);
    }
}

/**
 * PATCH /api/users/me
 * Actualiza nombre y/o email del usuario autenticado.
 * Body: { name?, email? }
 * NO permite cambiar roles, password ni campos de seguridad desde aquí.
 */
async function updateMe(req, res, next) {
    try {
        const user = await UserService.updateProfile(req.user.userId, req.body);
        ApiResponse.success(res, user, { message: 'Perfil actualizado' });
    } catch (err) {
        next(err);
    }
}

/**
 * PATCH /api/users/me/password
 * Cambia la contraseña del usuario autenticado.
 * Body: { currentPassword, newPassword, passwordConfirm }
 * Al cambiar contraseña, todos los tokens anteriores quedan invalidados
 * (via passwordChangedAt que verifica AuthMiddleware.protect).
 */
async function changePassword(req, res, next) {
    try {
        const { currentPassword, newPassword } = req.body;
        await UserService.changePassword(req.user.userId, currentPassword, newPassword);
        ApiResponse.success(res, null, { message: 'Contraseña actualizada. Inicia sesión nuevamente.' });
    } catch (err) {
        next(err);
    }
}

/**
 * DELETE /api/users/me
 * Soft-delete de la cuenta propia. No elimina el registro de DB.
 */
async function deleteMe(req, res, next) {
    try {
        await UserService.softDelete(req.user.userId);
        ApiResponse.noContent(res);
    } catch (err) {
        next(err);
    }
}

// ─── Admin ────────────────────────────────────────────────────────────────────

/**
 * GET /api/users
 * Lista todos los usuarios con paginación y filtros opcionales.
 * Query params: page, limit, sort, search, isActive, role
 * Solo accesible por admin/superadmin.
 */
async function listUsers(req, res, next) {
    try {
        const pagination = Pagination.parse(req.query);
        const filters    = {
            search:   req.query.search,
            isActive: req.query.isActive,
            role:     req.query.role,
        };

        const { items, total } = await UserService.list(filters, pagination);
        const meta = Pagination.meta(total, pagination.page, pagination.limit);
        ApiResponse.paginated(res, items, meta);
    } catch (err) {
        next(err);
    }
}

/**
 * GET /api/users/:id
 * Retorna un usuario por ID.
 */
async function getUserById(req, res, next) {
    try {
        const user = await UserService.getById(req.params.id);
        ApiResponse.success(res, user);
    } catch (err) {
        next(err);
    }
}

/**
 * PATCH /api/users/:id
 * Admin actualiza datos de un usuario.
 * Body: { name?, email?, isActive?, roles? }
 */
async function updateUser(req, res, next) {
    try {
        const user = await UserService.updateByAdmin(req.params.id, req.body);
        ApiResponse.success(res, user, { message: 'Usuario actualizado' });
    } catch (err) {
        next(err);
    }
}

/**
 * PATCH /api/users/:id/status
 * Activa o desactiva una cuenta.
 * Body: { isActive: boolean }
 */
async function setUserStatus(req, res, next) {
    try {
        const { isActive } = req.body;
        const user = await UserService.setStatus(req.params.id, isActive);
        const msg  = isActive ? 'Cuenta activada' : 'Cuenta desactivada';
        ApiResponse.success(res, user, { message: msg });
    } catch (err) {
        next(err);
    }
}

/**
 * DELETE /api/users/:id
 * Admin hace soft-delete de un usuario.
 */
async function deleteUser(req, res, next) {
    try {
        await UserService.softDelete(req.params.id);
        ApiResponse.noContent(res);
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getMe,
    updateMe,
    changePassword,
    deleteMe,
    listUsers,
    getUserById,
    updateUser,
    setUserStatus,
    deleteUser,
};