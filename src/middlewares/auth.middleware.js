/**
 * @file auth.middleware.js
 * @description JWT lifecycle: firmar, verificar, rotar y guardar en cookie httpOnly.
 *
 *
 * Variables de entorno requeridas:
 *   JWT_SECRET          - Secret para access tokens.
 *   JWT_REFRESH_SECRET  - Secret para refresh tokens.
 *   JWT_EXPIRES_IN      - TTL access token  (default: '15m').
 *   JWT_REFRESH_EXPIRES - TTL refresh token (default: '7d').
 */

'use strict';

// FIX [C-04]: Delegar operaciones JWT a JwtUtils — misma API pública, sin circular dep.
const JwtUtils     = require('../utils/jwt.utils');
const { AppError } = require('./error.middleware');
const redisService = require('../services/redis.service');

// ─── AuthMiddleware ───────────────────────────────────────────────────────────
// La sección de configuración JWT (secrets, validation) se movió a jwt.utils.js.

// ─── AuthMiddleware ───────────────────────────────────────────────────────────

class AuthMiddleware {

    // ── Generación de tokens ─────────────────────────────────────────────────

    /**
     * Firma un access token de corta duración.
     *
     * @param {object} payload - Datos a incluir. NUNCA campos sensibles (password, etc.).
     * @returns {string}
     */
    static signAccessToken(payload) {
        AuthMiddleware._assertPayload(payload);
        // FIX [P-01]: Delegar a JwtUtils para usar las constantes definidas ahí
        return JwtUtils.signAccessToken(payload);
    }

    /**
     * Firma un refresh token de larga duración.
     * Solo incluir userId — superficie mínima.
     *
     * @param {object} payload - { userId }
     * @returns {string}
     */
    static signRefreshToken(payload) {
        AuthMiddleware._assertPayload(payload);
        // FIX [P-01]: Delegar a JwtUtils para usar las constantes definidas ahí
        return JwtUtils.signRefreshToken(payload);
    }

    /**
     * Genera ambos tokens de una sola vez.
     *
     * @param {object} userPayload - Campos seguros del usuario.
     * @returns {{ accessToken: string, refreshToken: string }}
     */
    static generateTokenPair(userPayload) {
        return {
            accessToken:  AuthMiddleware.signAccessToken(userPayload),
            refreshToken: AuthMiddleware.signRefreshToken({ userId: userPayload.userId }),
        };
    }

    // ── Verificación ─────────────────────────────────────────────────────────

    /**
     * Verifica y decodifica un access token.
     *
     * @param {string} token
     * @returns {object} Payload decodificado.
     * @throws {AppError} 401 si inválido o expirado.
     */
    static verifyAccessToken(token) {
        // FIX [P-01]: Delegar a JwtUtils para usar las constantes definidas ahí
        return JwtUtils.verifyAccessToken(token);
    }

    /**
     * Verifica y decodifica un refresh token.
     *
     * @param {string} token
     * @returns {object} Payload decodificado.
     * @throws {AppError} 401 si inválido o expirado.
     */
    static verifyRefreshToken(token) {
        // FIX [P-01]: Delegar a JwtUtils para usar las constantes definidas ahí
        return JwtUtils.verifyRefreshToken(token);
    }

    // ── Guard middlewares de Express ──────────────────────────────────────────

    /**
     *
     * Verifica en orden:
     *   1. Presencia del token en Authorization header o cookie.
     *   2. Firma y expiración del JWT.
     *   3. Que el usuario sigue activo en DB (no eliminado, no desactivado).
     *   4. Que el token fue emitido DESPUÉS del último cambio de contraseña.
     *      Esto invalida tokens anteriores cuando el usuario cambia su password.
     *
     * El paso 3-4 requiere una DB query (~1ms). Es el único mecanismo real
     * de revocación sin implementar una blacklist en Redis.
     *
     * Adjunta req.user = { userId, email, roles, iat, exp }
     *
     * Usage:
     *   router.get('/profile', AuthMiddleware.protect, controller.getProfile);
     */
    // Los tokens con jti en la blacklist son rechazados inmediatamente,
    // incluso si la firma JWT sigue siendo válida (tokens robados / logout forzado).
    static async protect(req, res, next) {
        try {
            const token = AuthMiddleware._extractToken(req);
            if (!token) {
                return next(AppError.unauthorized('No se proporcionó token de autenticación'));
            }

            const decoded = JwtUtils.verifyAccessToken(token);
            if (decoded.jti) {
                const blacklisted = await redisService.isTokenBlacklisted(decoded.jti);
                if (blacklisted) {
                    return next(AppError.unauthorized('Token revocado. Por favor inicia sesión nuevamente.'));
                }
            }

            // Carga lazy del User model para evitar circular dependency al importar
            const User = require('../models/User');

            const user = await User.findById(decoded.userId).select('+passwordChangedAt');

            if (!user || !user.isActive) {
                return next(AppError.unauthorized('Usuario no válido o inactivo'));
            }

            // Verificar que el token no es anterior al cambio de contraseña
            if (!user.isTokenValidAfterPasswordChange(decoded.iat)) {
                return next(AppError.unauthorized(
                    'La contraseña fue cambiada. Por favor inicia sesión nuevamente.'
                ));
            }

            req.user = decoded;
            next();
        } catch (err) {
            next(err);
        }
    }

    /**
     * Auth opcional — adjunta req.user si hay token válido, pero no bloquea.
     * Para rutas con comportamiento diferente para usuarios autenticados vs anónimos.
     */
    static optionalAuth(req, res, next) {
        const token = AuthMiddleware._extractToken(req);
        if (!token) return next();

        try {
            req.user = AuthMiddleware.verifyAccessToken(token);
        } catch {
            // Token inválido o ausente — continúa como anónimo
        }
        next();
    }

    /**
     * Control de acceso por rol.
     * Debe usarse DESPUÉS de AuthMiddleware.protect.
     *
     * @param {...string} roles - Roles permitidos.
     * @returns {Function} Express middleware.
     *
     * Usage:
     *   router.delete('/users/:id',
     *     AuthMiddleware.protect,
     *     AuthMiddleware.requireRole('admin'),
     *     controller.deleteUser
     *   );
     */
    static requireRole(...roles) {
        return (req, res, next) => {
            if (!req.user) {
                return next(AppError.unauthorized('No autenticado'));
            }
            const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
            if (!roles.some(r => userRoles.includes(r))) {
                return next(AppError.forbidden(`Requiere uno de los roles: ${roles.join(', ')}`));
            }
            next();
        };
    }

    // ── Cookie helpers ────────────────────────────────────────────────────────

    /**
     * Adjunta el refresh token como cookie httpOnly segura.
     *
     * @param {Response} res
     * @param {string}   refreshToken
     */
    static attachRefreshCookie(res, refreshToken) {
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge:   7 * 24 * 60 * 60 * 1000,
            path:     '/api/auth',
        });
    }

    /** Limpia el cookie de refresh token (logout). */
    static clearRefreshCookie(res) {
        res.clearCookie('refreshToken', { path: '/api/auth' });
    }

    // ── Helpers privados ──────────────────────────────────────────────────────

    /**
     * Extrae el Bearer token del request.
     * Prioridad: Authorization header → cookie accessToken.
     */
    static _extractToken(req) {
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7).trim();
            return token || null;
        }
        if (req.cookies?.accessToken) {
            return req.cookies.accessToken;
        }
        return null;
    }

    /** Valida que el payload incluya userId antes de firmar. */
    static _assertPayload(payload) {
        if (!payload || typeof payload !== 'object' || !payload.userId) {
            throw AppError.internal('El payload del token debe incluir userId');
        }
    }
}

module.exports = AuthMiddleware;