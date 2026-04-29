/**
 * @file requestId.middleware.js
 * @description Middleware de correlación de requests para trazabilidad.
 * Genera un UUID único por request y lo adjunta a req.id.
 * Este ID aparece en todos los logs y respuestas API.
 */

'use strict';

const crypto = require('crypto');

/**
 * Genera un request ID y lo adjunta al objeto request.
 * También lo expone en el header X-Request-Id para el cliente.
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next
 */
function requestIdMiddleware(req, res, next) {
    const requestId = crypto.randomUUID();
    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}

module.exports = requestIdMiddleware;
