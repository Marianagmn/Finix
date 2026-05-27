/**
 * @file user.service.js
 * @description Lógica de negocio para gestión de usuarios.
 *
 * Sigue el mismo patrón que auth.service.js:
 *  controller → service → model
 *
 * El controller solo parsea request y formatea response.
 * El model solo hace queries y validaciones de persistencia.
 * El service orquesta la lógica entre ambos.
 */

'use strict';

const User          = require('../models/User');
const PasswordUtils = require('../utils/password.utils');
const Pagination    = require('../utils/pagination.utils');
const { AppError }  = require('../middlewares/error.middleware');

// Campos que un usuario puede editar en su propio perfil
const ALLOWED_PROFILE_FIELDS = ['name', 'email', 'businessId'];

// Campos que un admin puede editar (más amplio)
const ALLOWED_ADMIN_FIELDS   = ['name', 'email', 'roles', 'isActive', 'isEmailVerified'];

class UserService {

    /**
     * Obtiene un usuario por ID.
     * @param {string} userId
     * @returns {Promise<object>} toJSON() del documento.
     */
    static async getById(userId) {
        const user = await User.findById(userId).select('+businessId');
        if (!user) throw AppError.notFound('Usuario no encontrado');
        return user.toJSON();
    }

    /**
     * Lista usuarios con filtros opcionales y paginación.
     *
     * @param {object} filters   - { search, isActive, role }
     * @param {object} pagination - { skip, limit }
     * @returns {Promise<{ items: object[], total: number }>}
     */
    static async list(filters = {}, { skip = 0, limit = 20 } = {}) {
        const query = {};

        if (filters.search) {
            // Búsqueda por nombre o email (case-insensitive)
            query.$or = [
                { name:  { $regex: filters.search, $options: 'i' } },
                { email: { $regex: filters.search, $options: 'i' } },
            ];
        }

        if (filters.isActive !== undefined) {
            query.isActive = filters.isActive === 'true' || filters.isActive === true;
        }

        if (filters.role) {
            query.roles = filters.role;
        }

        const [items, total] = await Promise.all([
            User.find(query).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
            User.countDocuments(query),
        ]);

        // lean() retorna POJOs sin métodos de Mongoose como .toJSON()
        // Se aplica la misma allowlist que el transform de toJSON del schema
        const serialize = (u) => ({
            id:              u._id,
            name:            u.name,
            email:           u.email,
            roles:           u.roles,
            provider:        u.provider,
            isActive:        u.isActive,
            isEmailVerified: u.isEmailVerified,
            lastLoginAt:     u.lastLoginAt,
            createdAt:       u.createdAt,
        });

        return { items: items.map(serialize), total };
    }

    /**
     * Actualiza campos del perfil propio.
     * Solo permite ALLOWED_PROFILE_FIELDS — previene mass assignment.
     *
     * @param {string} userId
     * @param {object} body   - req.body (ya validado por Zod)
     * @returns {Promise<object>}
     */
    static async updateProfile(userId, body) {
        // Filtrar solo campos permitidos — cualquier otro se ignora silenciosamente
        const updates = Object.fromEntries(
            Object.entries(body).filter(([key]) => ALLOWED_PROFILE_FIELDS.includes(key))
        );

        if (Object.keys(updates).length === 0) {
            throw AppError.badRequest('No hay campos válidos para actualizar');
        }

        // Si cambia email, verificar que no esté tomado
        if (updates.email) {
            const exists = await User.findOne({ email: updates.email });
            if (exists && exists._id.toString() !== userId) {
                throw new AppError('El email ya está en uso', 409, 'EMAIL_TAKEN');
            }
            // Al cambiar email, requiere re-verificación
            updates.isEmailVerified = false;
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('+businessId');

        if (!user) throw AppError.notFound('Usuario no encontrado');
        return user.toJSON();
    }

    /**
     * Cambia la contraseña del usuario.
     * Verifica la contraseña actual antes de permitir el cambio.
     * Después del cambio, todos los tokens anteriores quedan invalidados
     * (passwordChangedAt es actualizado en el pre-save hook).
     *
     * @param {string} userId
     * @param {string} currentPassword  - Contraseña actual en texto plano.
     * @param {string} newPassword      - Nueva contraseña en texto plano.
     */
    static async changePassword(userId, currentPassword, newPassword) {
        if (!currentPassword || !newPassword) {
            throw AppError.badRequest('Se requiere contraseña actual y nueva');
        }

        // Cargar con password para poder comparar
        const user = await User.findById(userId).select('+password');
        if (!user) throw AppError.notFound('Usuario no encontrado');

        // Verificar contraseña actual
        const match = await user.comparePassword(currentPassword);
        if (!match) {
            throw AppError.unauthorized('La contraseña actual es incorrecta');
        }

        // Prevenir reutilización inmediata
        const samePassword = await PasswordUtils.compare(newPassword, user.password);
        if (samePassword) {
            throw AppError.badRequest('La nueva contraseña no puede ser igual a la actual');
        }

        // Asignar texto plano — el pre-save hook hashea y actualiza passwordChangedAt
        user.password = newPassword;
        await user.save();
    }

    /**
     * Admin actualiza datos de un usuario.
     * Permite campos más amplios que updateProfile.
     *
     * @param {string} userId
     * @param {object} body
     * @returns {Promise<object>}
     */
    static async updateByAdmin(userId, body) {
        const updates = Object.fromEntries(
            Object.entries(body).filter(([key]) => ALLOWED_ADMIN_FIELDS.includes(key))
        );

        if (Object.keys(updates).length === 0) {
            throw AppError.badRequest('No hay campos válidos para actualizar');
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('+businessId');

        if (!user) throw AppError.notFound('Usuario no encontrado');
        return user.toJSON();
    }

    /**
     * Activa o desactiva una cuenta.
     *
     * @param {string}  userId
     * @param {boolean} isActive
     */
    static async setStatus(userId, isActive) {
        const user = await User.findByIdAndUpdate(
            userId,
            { $set: { isActive: Boolean(isActive) } },
            { new: true }
        ).select('+businessId');
        if (!user) throw AppError.notFound('Usuario no encontrado');
        return user.toJSON();
    }

    /**
     * Soft-delete de un usuario.
     * Usa el static atómico del modelo.
     *
     * @param {string} userId
     */
    static async softDelete(userId) {
        const user = await User.softDeleteById(userId);
        if (!user) throw AppError.notFound('Usuario no encontrado');
    }
}

module.exports = UserService;