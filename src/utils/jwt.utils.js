'use strict';

/**
 * @file jwt.utils.js
 * @description Utilidades JWT puras — sign, verify, generateTokenPair.
 * Extraído de auth.middleware.js para romper la dependencia circular:
 *   User.js → AuthMiddleware → User.js (lazy)
 * Ahora:
 *   User.js → JwtUtils          (sin circular)
 *   auth.middleware.js → JwtUtils (usa internamente)
 */

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { AppError } = require('../middlewares/error.middleware');

// ─── Configuración ────────────────────────────────────────────────────────────

const ACCESS_SECRET   = process.env.JWT_SECRET;
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES  = process.env.JWT_EXPIRES_IN      || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error(
        '[jwt.utils] JWT_SECRET y JWT_REFRESH_SECRET son obligatorios. ' +
        'Verifica tus variables de entorno.'
    );
}

// ─── JwtUtils ─────────────────────────────────────────────────────────────────

class JwtUtils {

    /**
     * Firma un access token. Incluye jti (UUID) para soporte de blacklist.
     * @param {object} payload - Debe contener userId.
     * @returns {string}
     */
    static signAccessToken(payload) {
        JwtUtils._assertPayload(payload);
        return jwt.sign(
            { ...payload, type: 'access', jti: crypto.randomUUID() },
            ACCESS_SECRET,
            { expiresIn: ACCESS_EXPIRES, algorithm: 'HS256', issuer: process.env.JWT_ISSUER || 'api' }
        );
    }

    /**
     * Firma un refresh token. Solo incluye userId y jti.
     * @param {object} payload - { userId }
     * @returns {string}
     */
    static signRefreshToken(payload) {
        JwtUtils._assertPayload(payload);
        return jwt.sign(
            { userId: payload.userId, type: 'refresh', jti: crypto.randomUUID() },
            REFRESH_SECRET,
            { expiresIn: REFRESH_EXPIRES, algorithm: 'HS256', issuer: process.env.JWT_ISSUER || 'api' }
        );
    }

    /**
     * Genera un par access + refresh token de una sola vez.
     * @param {object} userPayload - Campos seguros del usuario.
     * @returns {{ accessToken: string, refreshToken: string }}
     */
    static generateTokenPair(userPayload) {
        // Include businessId in access token if user has one (for enterprise features)
        const accessPayload = {
            ...userPayload,
            businessId: userPayload.businessId || undefined
        };

        return {
            accessToken:  JwtUtils.signAccessToken(accessPayload),
            refreshToken: JwtUtils.signRefreshToken({ userId: userPayload.userId }),
        };
    }

    /**
     * Verifica y decodifica un access token.
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
            if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Token expirado');
            throw AppError.unauthorized('Token inválido');
        }
    }

    /**
     * Verifica y decodifica un refresh token.
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
            if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Refresh token expirado');
            throw AppError.unauthorized('Refresh token inválido');
        }
    }

    /** @private */
    static _assertPayload(payload) {
        if (!payload || typeof payload !== 'object' || !payload.userId) {
            throw AppError.internal('El payload del token debe incluir userId');
        }
    }
}

module.exports = JwtUtils;
