/**
 * @file csrf.middleware.js
 * @description CSRF protection middleware for state-changing requests.
 *
 * Uses the csrf library to generate and validate CSRF tokens.
 * Tokens are stored in cookies and must be included in request headers for state-changing operations.
 */

'use strict';

const csrf = require('csrf');
const cookieParser = require('cookie-parser');

// CSRF token secret (in production, this should be in environment variables)
const CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-secret-change-in-production';
const csrfInstance = new csrf(CSRF_SECRET);

/**
 * CSRF Protection Middleware
 * 
 * Generates and validates CSRF tokens for state-changing requests.
 * Safe methods (GET, HEAD, OPTIONS) are exempt from CSRF checks.
 * 
 * Usage:
 *   - Apply globally to protect all routes
 *   - Or apply selectively to specific route groups
 */
class CsrfMiddleware {
    /**
     * Generate CSRF token and attach it to response
     */
    static generateToken(req, res, next) {
        const token = csrfInstance.create(CSRF_SECRET);
        res.cookie('csrf-token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            path: '/'
        });
        res.locals.csrfToken = token;
        next();
    }

    /**
     * Validate CSRF token for state-changing requests
     */
    static validateToken(req, res, next) {
        // Skip CSRF check for safe methods
        const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
        if (safeMethods.includes(req.method)) {
            return next();
        }

        const token = req.headers['x-csrf-token'] || req.body?.csrfToken;
        const cookieToken = req.cookies?.['csrf-token'];

        if (!token || !cookieToken) {
            return res.status(403).json({
                success: false,
                code: 'CSRF_TOKEN_MISSING',
                message: 'CSRF token is required for this request'
            });
        }

        if (!csrfInstance.verify(CSRF_SECRET, token)) {
            return res.status(403).json({
                success: false,
                code: 'CSRF_TOKEN_INVALID',
                message: 'Invalid CSRF token'
            });
        }

        if (token !== cookieToken) {
            return res.status(403).json({
                success: false,
                code: 'CSRF_TOKEN_MISMATCH',
                message: 'CSRF token mismatch'
            });
        }

        next();
    }

    /**
     * Combined middleware: generate token for all requests, validate for state-changing
     */
    static protect(req, res, next) {
        CsrfMiddleware.generateToken(req, res, () => {
            CsrfMiddleware.validateToken(req, res, next);
        });
    }
}

module.exports = CsrfMiddleware;
