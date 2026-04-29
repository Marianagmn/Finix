/**
 * @file auth.service.js
 * @description Capa de servicio para autenticación — toda la lógica de negocio vive aquí.
 *
 *   - AuthService orquesta toda la lógica de autenticación.
 *   - auth.controller.js solo parsea request → llama service → formatea response.
 *   - user.js solo define schema, validaciones y helpers de persistencia.
 *   - AuthService es testeable con unit tests puros (sin HTTP, sin Express).
 */

'use strict';

const User           = require('../models/User');
const JwtUtils       = require('../utils/jwt.utils');
const { AppError }   = require('../middlewares/error.middleware');

class AuthService {

    /**
     * Registra un nuevo usuario.
     *
     * La contraseña llega en texto plano; el pre-save hook del modelo la hashea.
     *
     * @param {{ name?: string, email: string, password: string }} dto
     * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
     */
    static async register({ name, email, password }) {
        let user;
        try {
            // Texto plano — el pre-save hook hashea la contraseña UNA sola vez.
            // NO pasar el password ya hasheado aquí.
            user = await User.create({ name, email, password });
        } catch (err) {
            // Captura el error de índice único directamente — atómico y sin TOCTOU.
            if (err.code === 11000) {
                throw new AppError('El email ya está registrado', 409, 'EMAIL_TAKEN');
            }
            throw err;
        }

        const tokens = user.generateTokenPair();
        return { ...tokens, user: user.toJSON() };
    }

    /**
     * Autentica un usuario con email y contraseña.
     *
     * @param {{ email: string, password: string, ip?: string }} dto
     * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
     */
    static async login({ email, password, ip = '' }) {
        // Carga con campos de seguridad necesarios para el flujo de login
        const user = await User.findByEmailForAuth(email);

        // Mensaje genérico — previene user enumeration
        if (!user) {
            throw AppError.unauthorized('Credenciales incorrectas');
        }

        // Verificar estado de la cuenta ANTES de comparar contraseña
        // (evita timing de bcrypt en cuentas desactivadas)
        if (!user.isActive) {
            throw AppError.forbidden('Cuenta desactivada. Contacte soporte.');
        }

        if (user.isLocked) {
            const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60_000);
            throw new AppError(
                `Cuenta bloqueada. Intente de nuevo en ${minutesLeft} minuto(s).`,
                429,
                'ACCOUNT_LOCKED'
            );
        }

        const passwordMatch = await user.comparePassword(password);
        if (!passwordMatch) {
            // Operación atómica — no afectada por concurrencia
            await User.registerFailedLogin(user._id);
            throw AppError.unauthorized('Credenciales incorrectas');
        }

        // Login exitoso — reset atómico de contadores
        await User.registerSuccessfulLogin(user._id, ip);

        const tokens = user.generateTokenPair();
        return { ...tokens, user: user.toJSON() };
    }

    /**
     * Rota el par de tokens usando un refresh token válido.
     *
     * @param {string} refreshToken - Token desde cookie httpOnly.
     * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
     */
    static async refreshTokens(refreshToken) {
        if (!refreshToken) {
            throw AppError.unauthorized('Refresh token no proporcionado');
        }

        const decoded = JwtUtils.verifyRefreshToken(refreshToken);

        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            throw AppError.unauthorized('Usuario no válido o inactivo');
        }

        const tokens = user.generateTokenPair();
        return { ...tokens, user: user.toJSON() };
    }

    /**
     * Devuelve el perfil del usuario autenticado.
     * req.user.userId viene del token verificado en AuthMiddleware.protect.
     *
     * NOTA sobre performance: esta DB query es necesaria para datos frescos.
     * Para endpoints de alta frecuencia, considera cache con TTL corto (30s).
     *
     * @param {string} userId
     * @returns {Promise<object>}
     */
    static async getProfile(userId) {
        const user = await User.findById(userId);
        if (!user) {
            throw AppError.notFound('Usuario no encontrado');
        }
        return user.toJSON();
    }
}

module.exports = AuthService;