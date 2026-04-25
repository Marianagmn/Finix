/**
 * @file bcrypt.middleware.js
 * @description Password hashing & verification utilities built on bcrypt.
 *
 * Responsibilities:
 *  - Hash plain-text passwords before they reach the database.
 *  - Compare a plain-text candidate against a stored hash on login.
 *  - Expose an Express middleware that hashes req.body.password in-place
 *    so controllers never touch plain-text passwords.
 *
 * Security notes:
 *  - SALT_ROUNDS = 12 gives ~300 ms hashing on a modern CPU — enough to
 *    slow brute-force attacks without hurting UX.
 *  - Never log or return plain-text passwords.
 *  - bcrypt silently truncates input at 72 bytes; validate max length upstream.
 */

'use strict';

const bcrypt   = require('bcryptjs'); // bcryptjs = pure-JS, no native bindings required
const { AppError } = require('./error.middleware');

// ─── Configuration ────────────────────────────────────────────────────────────

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// ─── BcryptMiddleware Class ───────────────────────────────────────────────────

class BcryptMiddleware {

    // ── Static Utilities ─────────────────────────────────────────────────────

    /**
     * Hash a plain-text password.
     *
     * @param {string} plainPassword - Raw password from the user.
     * @returns {Promise<string>}      bcrypt hash (60-char string).
     * @throws {AppError}              400 if input is empty / too long.
     */
    static async hash(plainPassword) {
        BcryptMiddleware._validateInput(plainPassword);
        const salt = await bcrypt.genSalt(SALT_ROUNDS);
        return bcrypt.hash(plainPassword, salt);
    }

    /**
     * Compare a plain-text candidate against a stored bcrypt hash.
     *
     * @param {string} plainPassword  - Candidate supplied by the user.
     * @param {string} hashedPassword - Hash stored in the database.
     * @returns {Promise<boolean>}      true if match, false otherwise.
     * @throws {AppError}               400 if either argument is missing.
     */
    static async compare(plainPassword, hashedPassword) {
        if (!plainPassword || !hashedPassword) {
            throw AppError.badRequest('Se requieren contraseña y hash para comparar');
        }
        return bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Verify that the candidate matches the hash and throw if it does not.
     * Convenience wrapper around compare() for use in login flows.
     *
     * @param {string} plainPassword
     * @param {string} hashedPassword
     * @throws {AppError} 401 Unauthorized if passwords do not match.
     */
    static async verifyOrThrow(plainPassword, hashedPassword) {
        const match = await BcryptMiddleware.compare(plainPassword, hashedPassword);
        if (!match) {
            // Generic message prevents user-enumeration attacks
            throw AppError.unauthorized('Credenciales incorrectas');
        }
    }

    // ── Express Middleware ────────────────────────────────────────────────────

    /**
     * Express middleware: hashes req.body.password (and req.body.passwordConfirm
     * if present) in-place before passing control to the next handler.
     *
     * Usage:
     *   router.post('/register', BcryptMiddleware.hashPasswordMiddleware, userController.register);
     *
     * @param {Request}  req
     * @param {Response} res
     * @param {Function} next
     */
    static async hashPasswordMiddleware(req, res, next) {
        try {
            const { password, passwordConfirm } = req.body;

            if (!password) return next(); // Let validators catch missing passwords

            // Reject mismatched confirmation early
            if (passwordConfirm !== undefined && password !== passwordConfirm) {
                return next(AppError.badRequest('Las contraseñas no coinciden'));
            }

            req.body.password = await BcryptMiddleware.hash(password);

            // Remove confirmation field — no need to store it
            delete req.body.passwordConfirm;

            next();
        } catch (err) {
            next(err);
        }
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    /**
     * Basic validation before attempting to hash.
     * @param {*} password
     */
    static _validateInput(password) {
        if (!password || typeof password !== 'string') {
            throw AppError.badRequest('La contraseña es requerida y debe ser texto');
        }
        if (password.length < 8) {
            throw AppError.badRequest('La contraseña debe tener al menos 8 caracteres');
        }
        // bcrypt silently truncates at 72 bytes — warn the consumer
        if (Buffer.byteLength(password, 'utf8') > 72) {
            throw AppError.badRequest('La contraseña excede el límite de 72 bytes de bcrypt');
        }
    }
}

module.exports = BcryptMiddleware;