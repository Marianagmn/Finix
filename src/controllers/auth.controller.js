/**
 * @file auth.controller.js
 * @description Express controllers for all authentication flows.
 *
 * Endpoints handled:
 *  POST   /api/auth/register   — Create account
 *  POST   /api/auth/login      — Login and receive token pair
 *  POST   /api/auth/refresh    — Rotate tokens using refresh cookie
 *  POST   /api/auth/logout     — Clear refresh cookie
 *  GET    /api/auth/me         — Return current user profile
 *
 * All handlers are async and delegate errors to Express via next().
 */

'use strict';

const User            = require('./user');
const AuthMiddleware  = require('./auth.middleware');
const { AppError }    = require('./error.middleware');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build and send the standard auth response.
 * Attaches the refresh token as an httpOnly cookie and returns the
 * access token + public user data in the JSON body.
 *
 * @param {Response} res
 * @param {Document} user        - Mongoose User document
 * @param {number}   statusCode  - HTTP status (200 | 201)
 */
function _sendTokenResponse(res, user, statusCode = 200) {
    const { accessToken, refreshToken } = user.generateTokenPair();

    // Refresh token goes into a secure, httpOnly cookie
    AuthMiddleware.attachRefreshCookie(res, refreshToken);

    res.status(statusCode).json({
        success:     true,
        accessToken,
        expiresIn:   process.env.JWT_EXPIRES_IN || '15m',
        user:        user.toJSON(),      // Sensitive fields stripped by schema transform
    });
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Body: { nombre?, email, password, passwordConfirm }
 *
 * The BcryptMiddleware.hashPasswordMiddleware should be applied as a
 * route-level middleware BEFORE this controller so req.body.password
 * already contains the hash when we reach here.
 */
async function register(req, res, next) {
    try {
        const { nombre, email, password } = req.body;

        // Basic field presence check (detailed validation belongs in a validator middleware)
        if (!email || !password) {
            return next(AppError.badRequest('Email y contraseña son requeridos'));
        }

        // Duplicate email — fail fast with a friendly message
        const exists = await User.findOne({ email: email.toLowerCase() });
        if (exists) {
            return next(new AppError('El email ya está registrado', 409, 'EMAIL_TAKEN'));
        }

        // user.js pre-save hook hashes the password if it arrives as plain text.
        // If BcryptMiddleware.hashPasswordMiddleware ran first, the password is
        // already hashed — the hook detects no modification and skips re-hashing.
        const user = await User.create({ nombre, email, password });

        _sendTokenResponse(res, user, 201);
    } catch (err) {
        next(err);
    }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res, next) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return next(AppError.badRequest('Email y contraseña son requeridos'));
        }

        // Fetch with password field (excluded by default)
        const user = await User.findByEmailWithPassword(email);

        // Use a generic error message to prevent user enumeration
        if (!user) {
            return next(AppError.unauthorized('Credenciales incorrectas'));
        }

        // Account lock check (brute-force protection)
        if (user.isLocked) {
            const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
            return next(
                new AppError(
                    `Cuenta bloqueada. Intente de nuevo en ${minutesLeft} minuto(s).`,
                    429,
                    'ACCOUNT_LOCKED'
                )
            );
        }

        // Inactive account
        if (!user.isActive) {
            return next(AppError.forbidden('Cuenta desactivada. Contacte soporte.'));
        }

        // Password comparison
        const passwordMatch = await user.comparePassword(password);
        if (!passwordMatch) {
            await user.registerFailedLogin();
            return next(AppError.unauthorized('Credenciales incorrectas'));
        }

        // Success — clear failure counters and record login metadata
        await user.registerSuccessfulLogin(req.ip);

        _sendTokenResponse(res, user, 200);
    } catch (err) {
        next(err);
    }
}

/**
 * POST /api/auth/refresh
 * Reads the refresh token from the httpOnly cookie, verifies it,
 * and issues a new access + refresh token pair (token rotation).
 */
async function refresh(req, res, next) {
    try {
        const token = req.cookies?.refreshToken;

        if (!token) {
            return next(AppError.unauthorized('Refresh token no proporcionado'));
        }

        // Verify signature and expiry
        const decoded = AuthMiddleware.verifyRefreshToken(token);

        // Load user from DB to ensure account is still active
        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            return next(AppError.unauthorized('Usuario no válido o inactivo'));
        }

        // Rotate: clear old cookie, issue new pair
        AuthMiddleware.clearRefreshCookie(res);
        _sendTokenResponse(res, user, 200);
    } catch (err) {
        next(err);
    }
}

/**
 * POST /api/auth/logout
 * Clears the refresh token cookie. The client is responsible for
 * discarding the access token (it will expire naturally).
 */
function logout(req, res) {
    AuthMiddleware.clearRefreshCookie(res);
    res.status(200).json({ success: true, message: 'Sesión cerrada correctamente' });
}

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile.
 * Requires AuthMiddleware.protect to have run first.
 */
async function me(req, res, next) {
    try {
        // req.user was attached by AuthMiddleware.protect
        const user = await User.findById(req.user.userId);
        if (!user) {
            return next(AppError.notFound('Usuario no encontrado'));
        }
        res.status(200).json({ success: true, user: user.toJSON() });
    } catch (err) {
        next(err);
    }
}

module.exports = { register, login, refresh, logout, me };