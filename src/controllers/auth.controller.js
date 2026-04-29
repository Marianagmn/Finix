/**
 * @file auth.controller.js
 * @description Controllers de autenticación — delegan lógica a AuthService.
 */

'use strict';

const AuthService  = require('../services/auth.service');
const ApiResponse  = require('../utils/response.utils');
const AuthMiddleware = require('../middlewares/auth.middleware');

// ─── Registro ─────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Registra un nuevo usuario y retorna tokens + perfil.
 */
async function register(req, res, next) {
    try {
        const { name, email, password } = req.body;
        const result = await AuthService.register({ name, email, password });

        // Adjunta refresh token en cookie httpOnly
        AuthMiddleware.attachRefreshCookie(res, result.refreshToken);

        ApiResponse.created(res, {
            user: result.user,
            accessToken: result.accessToken,
        }, 'Usuario registrado exitosamente');
    } catch (err) {
        next(err);
    }
}

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Autentica usuario y retorna tokens + perfil.
 */
async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        const ip = req.ip;

        const result = await AuthService.login({ email, password, ip });

        AuthMiddleware.attachRefreshCookie(res, result.refreshToken);

        ApiResponse.success(res, {
            user: result.user,
            accessToken: result.accessToken,
        }, { message: 'Login exitoso' });
    } catch (err) {
        next(err);
    }
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 * Rota tokens usando refresh token desde cookie httpOnly.
 */
async function refresh(req, res, next) {
    try {
        const refreshToken = req.cookies?.refreshToken;
        const result = await AuthService.refreshTokens(refreshToken);

        AuthMiddleware.attachRefreshCookie(res, result.refreshToken);

        ApiResponse.success(res, {
            user: result.user,
            accessToken: result.accessToken,
        });
    } catch (err) {
        next(err);
    }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout
 * Limpia cookie de refresh token.
 */
async function logout(req, res, next) {
    try {
        AuthMiddleware.clearRefreshCookie(res);
        ApiResponse.success(res, null, { message: 'Logout exitoso' });
    } catch (err) {
        next(err);
    }
}

// ─── Perfil ───────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Retorna perfil del usuario autenticado.
 */
async function me(req, res, next) {
    try {
        const user = await AuthService.getProfile(req.user.userId);
        ApiResponse.success(res, user);
    } catch (err) {
        next(err);
    }
}

module.exports = {
    register,
    login,
    refresh,
    logout,
    me,
};