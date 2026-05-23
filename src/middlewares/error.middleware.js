/**
 * @file error.middleware.js
 * @description Centralised error handling — custom error class + Express error handler.
 *
 * Usage:
 *   throw new AppError('Not found', 404);
 *   // or in an async controller:
 *   next(new AppError('Unauthorized', 401));
 */

'use strict';

// ─── Custom Error Class ───────────────────────────────────────────────────────

/**
 * AppError
 * Extends the native Error to carry an HTTP status code and an
 * optional machine-readable `code` string for client-side i18n.
 */
class AppError extends Error {
    /**
     * @param {string} message      - Human-readable description.
     * @param {number} statusCode   - HTTP status code (default 500).
     * @param {string} [code]       - Optional machine-readable error code.
     */
    constructor(message, statusCode = 500, code = null) {
        super(message);

        this.name       = this.constructor.name;
        this.statusCode = statusCode;
        this.code       = code || AppError._defaultCode(statusCode);
        this.isOperational = true; // Distinguishes known errors from programming bugs

        // Capture a clean stack trace (V8 only)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /** Map common status codes to readable string codes */
    static _defaultCode(statusCode) {
        const codes = {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            422: 'UNPROCESSABLE',
            429: 'TOO_MANY_REQUESTS',
            500: 'INTERNAL_ERROR',
        };
        return codes[statusCode] || 'ERROR';
    }

    // ── Named constructors (semantic sugar) ──────────────────────────────────

    static badRequest(message = 'Bad request')       { return new AppError(message, 400); }
    static unauthorized(message = 'No autorizado')   { return new AppError(message, 401); }
    static forbidden(message = 'Acceso denegado')    { return new AppError(message, 403); }
    static notFound(message = 'Recurso no encontrado') { return new AppError(message, 404); }
    static conflict(message = 'Conflicto de datos')  { return new AppError(message, 409); }
    static internal(message = 'Error interno')       { return new AppError(message, 500); }
}

// ─── Express Error-Handler Middleware ─────────────────────────────────────────

/**
 * Global Express error handler.
 * Must be registered AFTER all routes:  app.use(errorHandler)
 *
 * @param {Error}    err
 * @param {Request}  req
 * @param {Response} res
 * @param {Function} next
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    // Normalise non-AppError instances (e.g. Mongoose ValidationError, JWT errors)
    const error = _normalise(err);

    // Log non-operational (programming) errors for debugging
    if (!error.isOperational) {
        console.error('[UNHANDLED ERROR]', err);
    }

    // SECURITY FIX: Never expose sensitive data in production
    const isDevelopment = process.env.NODE_ENV === 'development';

    const response = {
        success: false,
        code: error.code,
        message: error.message,
        requestId: req.id, // Include request ID for tracing
    };

    // Only expose stack traces in development
    if (isDevelopment) {
        response.stack = error.stack;
    }

    // Never expose internal error details in production
    if (!isDevelopment) {
        // Remove any potentially sensitive information from error message
        if (error.message.includes('password') || 
            error.message.includes('token') ||
            error.message.includes('secret') ||
            error.message.includes('key')) {
            response.message = 'An internal error occurred';
        }
    }

    res.status(error.statusCode).json(response);
}

/**
 * Convert known third-party errors into AppError instances.
 * @param {Error} err
 * @returns {AppError}
 */
function _normalise(err) {
    if (err instanceof AppError) return err;

    // Mongoose duplicate-key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0] || 'campo';
        return new AppError(`El ${field} ya está registrado`, 409, 'DUPLICATE_KEY');
    }

    // Mongoose ValidationError
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(e => e.message).join(', ');
        return new AppError(messages, 400, 'VALIDATION_ERROR');
    }

    // JWT errors (re-thrown from auth.middleware)
    if (err.name === 'JsonWebTokenError')  return AppError.unauthorized('Token inválido');
    if (err.name === 'TokenExpiredError')  return AppError.unauthorized('Token expirado');
    if (err.name === 'NotBeforeError')     return AppError.unauthorized('Token aún no activo');

    // Fallback
    return new AppError(err.message || 'Error interno del servidor', err.statusCode || 500);
}

module.exports = { AppError, errorHandler };