/**
 * @file auth.middleware.js
 * @description JWT lifecycle management: sign, verify, refresh, and Express guard middleware.
 *
 * Token strategy:
 *  - Access token  : short-lived (15 min default), sent in Authorization header.
 *  - Refresh token : long-lived (7 days default), stored in httpOnly cookie.
 *
 * Environment variables consumed:
 *  JWT_SECRET          - Required. Secret for signing access tokens.
 *  JWT_REFRESH_SECRET  - Required. Secret for signing refresh tokens.
 *  JWT_EXPIRES_IN      - Access token TTL  (default '15m').
 *  JWT_REFRESH_EXPIRES - Refresh token TTL (default '7d').
 *  NODE_ENV            - Used to set cookie secure flag in production.
 */

'use strict';

const jwt          = require('jsonwebtoken');
const { AppError } = require('./error.middleware');

// ─── Configuration ────────────────────────────────────────────────────────────

const ACCESS_SECRET   = process.env.JWT_SECRET;
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES  = process.env.JWT_EXPIRES_IN      || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error(
        'JWT_SECRET y JWT_REFRESH_SECRET deben estar definidos en las variables de entorno'
    );
}

// ─── AuthMiddleware Class ─────────────────────────────────────────────────────

class AuthMiddleware {

    // ── Token Generation ─────────────────────────────────────────────────────

    /**
     * Sign a short-lived access token.
     *
     * @param {object} payload - Data to embed (userId, email, roles…).
     *                           Do NOT include sensitive fields (password, etc.).
     * @returns {string} Signed JWT string.
     */
    static signAccessToken(payload) {
        AuthMiddleware._validatePayload(payload);
        return jwt.sign(
            { ...payload, type: 'access' },
            ACCESS_SECRET,
            {
                expiresIn: ACCESS_EXPIRES,
                algorithm: 'HS256',
                issuer:    process.env.JWT_ISSUER || 'api',
            }
        );
    }

    /**
     * Sign a long-lived refresh token.
     * Only embed the userId — keep the surface area minimal.
     *
     * @param {object} payload - Typically { userId }.
     * @returns {string} Signed refresh JWT.
     */
    static signRefreshToken(payload) {
        AuthMiddleware._validatePayload(payload);
        return jwt.sign(
            { ...payload, type: 'refresh' },
            REFRESH_SECRET,
            {
                expiresIn: REFRESH_EXPIRES,
                algorithm: 'HS256',
                issuer:    process.env.JWT_ISSUER || 'api',
            }
        );
    }

    /**
     * Convenience: generate both tokens at once.
     *
     * @param {object} userPayload - Safe fields to embed in the access token.
     * @returns {{ accessToken: string, refreshToken: string }}
     */
    static generateTokenPair(userPayload) {
        return {
            accessToken:  AuthMiddleware.signAccessToken(userPayload),
            refreshToken: AuthMiddleware.signRefreshToken({ userId: userPayload.userId }),
        };
    }

    // ── Token Verification ───────────────────────────────────────────────────

    /**
     * Verify and decode an access token.
     *
     * @param {string} token
     * @returns {object} Decoded payload.
     * @throws {AppError} 401 if invalid or expired.
     */
    static verifyAccessToken(token) {
        try {
            const decoded = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
            if (decoded.type !== 'access') {
                throw AppError.unauthorized('Tipo de token inválido');
            }
            return decoded;
        } catch (err) {
            // Re-throw AppError as-is; convert JWT errors
            if (err instanceof AppError) throw err;
            if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Token expirado');
            throw AppError.unauthorized('Token inválido');
        }
    }

    /**
     * Verify and decode a refresh token.
     *
     * @param {string} token
     * @returns {object} Decoded payload.
     * @throws {AppError} 401 if invalid or expired.
     */
    static verifyRefreshToken(token) {
        try {
            const decoded = jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
            if (decoded.type !== 'refresh') {
                throw AppError.unauthorized('Tipo de token inválido');
            }
            return decoded;
        } catch (err) {
            if (err instanceof AppError) throw err;
            if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Refresh token expirado');
            throw AppError.unauthorized('Refresh token inválido');
        }
    }

    // ── Express Guard Middlewares ─────────────────────────────────────────────

    /**
     * Protect a route — requires a valid access token.
     *
     * Reads the token from:
     *   1. Authorization header:  Bearer <token>
     *   2. Cookie:                accessToken=<token>   (optional fallback)
     *
     * On success, attaches the decoded payload to req.user.
     *
     * Usage:
     *   router.get('/profile', AuthMiddleware.protect, userController.getProfile);
     */
    static protect(req, res, next) {
        try {
            const token = AuthMiddleware._extractToken(req);
            if (!token) {
                return next(AppError.unauthorized('No se proporcionó token de autenticación'));
            }

            req.user = AuthMiddleware.verifyAccessToken(token);
            next();
        } catch (err) {
            next(err);
        }
    }

    /**
     * Optional auth — attaches req.user if a valid token is present,
     * but does NOT block the request if there is none.
     * Useful for routes that behave differently for authenticated users.
     */
    static optionalAuth(req, res, next) {
        try {
            const token = AuthMiddleware._extractToken(req);
            if (token) {
                req.user = AuthMiddleware.verifyAccessToken(token);
            }
        } catch {
            // Silently ignore — token absent or invalid, treat as guest
        }
        next();
    }

    /**
     * Role-based access control gate.
     * Must be used AFTER AuthMiddleware.protect.
     *
     * @param {...string} roles - Allowed role names.
     * @returns {Function} Express middleware.
     *
     * Usage:
     *   router.delete('/users/:id', AuthMiddleware.protect, AuthMiddleware.requireRole('admin'), ...);
     */
    static requireRole(...roles) {
        return (req, res, next) => {
            if (!req.user) {
                return next(AppError.unauthorized('No autenticado'));
            }
            const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
            const hasRole   = roles.some(r => userRoles.includes(r));

            if (!hasRole) {
                return next(AppError.forbidden(`Requiere uno de los roles: ${roles.join(', ')}`));
            }
            next();
        };
    }

    /**
     * Attach the refresh token as an httpOnly cookie in the response.
     * Call this after generating a token pair.
     *
     * @param {Response} res
     * @param {string}   refreshToken
     */
    static attachRefreshCookie(res, refreshToken) {
        const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,                                    // Not accessible via JS
            secure:   process.env.NODE_ENV === 'production',  // HTTPS only in prod
            sameSite: 'strict',                               // CSRF protection
            maxAge:   maxAgeMs,
            path:     '/api/auth',                            // Scope to auth endpoints
        });
    }

    /** Clear the refresh token cookie (used on logout). */
    static clearRefreshCookie(res) {
        res.clearCookie('refreshToken', { path: '/api/auth' });
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    /**
     * Extract the Bearer token from the request.
     * Priority: Authorization header → accessToken cookie.
     *
     * @param {Request} req
     * @returns {string|null}
     */
    static _extractToken(req) {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];

        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.slice(7).trim() || null;
        }

        // Cookie fallback (for browser clients using cookie-based sessions)
        if (req.cookies && req.cookies.accessToken) {
            return req.cookies.accessToken;
        }

        return null;
    }

    /**
     * Ensure the payload has at least a userId before signing.
     * @param {object} payload
     */
    static _validatePayload(payload) {
        if (!payload || typeof payload !== 'object' || !payload.userId) {
            throw AppError.internal('El payload del token debe incluir userId');
        }
    }
}

module.exports = AuthMiddleware;