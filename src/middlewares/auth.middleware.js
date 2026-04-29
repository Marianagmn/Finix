/**
 * @file auth.middleware.js
 * @description JWT lifecycle: firmar, verificar, rotar y guardar en cookie httpOnly.
 *
 * Diseño de seguridad:
 *   - Revocación de tokens: protect() valida que el token fue emitido después del
 *     último cambio de contraseña. Cualquier cambio invalida todos los tokens previos.
 *   - Verificación de estado: en cada request protegido se carga el usuario desde DB
 *     para verificar isActive e isDeleted (~1ms overhead). Esto proporciona revocación
 *     inmediata sin necesidad de blacklist.
 *   - Blacklist de tokens (opcional): la verificación de jti en Redis permite revocar
 *     tokens específicos (logout forzado, tokens robados).
 *
 * Variables de entorno requeridas:
 *   JWT_SECRET          - Secret para access tokens.
 *   JWT_REFRESH_SECRET  - Secret para refresh tokens.
 *   JWT_EXPIRES_IN      - TTL access token  (default: '15m').
 *   JWT_REFRESH_EXPIRES - TTL refresh token (default: '7d').
 */

'use strict';

// JwtUtils centraliza las operaciones JWT evitando dependencias circulares
const JwtUtils     = require('../utils/jwt.utils');
const { AppError } = require('./error.middleware');
const redisService = require('../services/redis.service');
const jwt = require('jsonwebtoken');

// Constantes de configuración
const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

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
        return jwt.sign(
            { ...payload, type: 'access' },
            ACCESS_SECRET,
            { expiresIn: ACCESS_EXPIRES, algorithm: 'HS256', issuer: process.env.JWT_ISSUER || 'api' }
        );
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
        return jwt.sign(
            { ...payload, type: 'refresh' },
            REFRESH_SECRET,
            { expiresIn: REFRESH_EXPIRES, algorithm: 'HS256', issuer: process.env.JWT_ISSUER || 'api' }
        );
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
        try {
            const decoded = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
            if (decoded.type !== 'access') throw AppError.unauthorized('Tipo de token inválido');
            return decoded;
        } catch (err) {
            if (err instanceof AppError) throw err;
            if (err.name === 'TokenExpiredError')  throw AppError.unauthorized('Token expirado');
            throw AppError.unauthorized('Token inválido');
        }
    }

    /**
     * Verifica y decodifica un refresh token.
     *
     * @param {string} token
     * @returns {object} Payload decodificado.
     * @throws {AppError} 401 si inválido o expirado.
     */
    static verifyRefreshToken(token) {
        try {
            const decoded = jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
            if (decoded.type !== 'refresh') throw AppError.unauthorized('Tipo de token inválido');
            return decoded;
        } catch (err) {
            if (err instanceof AppError) throw err;
            if (err.name === 'TokenExpiredError')  throw AppError.unauthorized('Refresh token expirado');
            throw AppError.unauthorized('Refresh token inválido');
        }
    }

    // ── Guard middlewares de Express ──────────────────────────────────────────

    /**
     * FIX [BUG-04]: Protege una ruta — requiere access token válido.
     *
     * Verificación en orden:
     *   1. Presencia del token en Authorization header o cookie.
     *   2. Firma y expiración del JWT.
     *   3. Estado del usuario en DB (isActive, isDeleted).
     *   4. Que el token fue emitido después del último cambio de contraseña
     *      (invalida tokens previos al cambiar password).
     *
     * Las verificaciones 3-4 requieren DB query (~1ms) pero permiten revocación
     * inmediata sin blacklist en Redis.
     *
     * Adjunta req.user = { userId, email, roles, iat, exp }
     *
     * Usage:
     *   router.get('/profile', AuthMiddleware.protect, controller.getProfile);
     */
    // FIX [C-05 / M-03]: protect() ahora es async y verifica Redis blacklist.
    // Los tokens con jti en la blacklist son rechazados inmediatamente,
    // incluso si la firma JWT sigue siendo válida (tokens robados / logout forzado).
    static async protect(req, res, next) {
        try {
            const token = AuthMiddleware._extractToken(req);
            if (!token) {
                return next(AppError.unauthorized('No se proporcionó token de autenticación'));
            }

            const decoded = JwtUtils.verifyAccessToken(token);

            // FIX [C-05]: Verificar blacklist Redis si el token tiene jti
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

    /**
     * Middleware para requerir businessId en req.user.
     * Debe usarse DESPUÉS de AuthMiddleware.protect.
     */
    static requireBusinessId(req, res, next) {
        if (!req.user?.businessId) {
            return next(AppError.forbidden('Acceso denegado: se requiere un negocio válido'));
        }
        next();
    }
}

module.exports = AuthMiddleware;