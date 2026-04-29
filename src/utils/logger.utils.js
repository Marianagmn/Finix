/**
 * @file logger.utils.js
 * @description Logger estructurado con Winston para producción.
 * Reemplaza console.log con logs JSON estructurados.
 */

'use strict';

const winston = require('winston');

// Formato personalizado para desarrollo (legible)
const devFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
    })
);

// Formato JSON para producción (estructurado)
const prodFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

// Crear logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: {
        service: 'finix-api',
        environment: process.env.NODE_ENV || 'development'
    },
    format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
    transports: [
        // Siempre escribir en consola
        new winston.transports.Console(),
        
        // En producción, también escribir en archivos
        ...(process.env.NODE_ENV === 'production' ? [
            new winston.transports.File({ 
                filename: 'logs/error.log', 
                level: 'error',
                maxsize: 5242880, // 5MB
                maxFiles: 5
            }),
            new winston.transports.File({ 
                filename: 'logs/combined.log',
                maxsize: 5242880,
                maxFiles: 5
            })
        ] : [])
    ],
    // No salir en errores no capturados
    exitOnError: false
});

/**
 * Log de request HTTP entrante
 * @param {Object} req - Express request
 */
const logRequest = (req) => {
    logger.info('Request recibido', {
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.id
    });
};

/**
 * Log de response HTTP saliente
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {number} duration - Duración en ms
 */
const logResponse = (req, res, duration) => {
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('Response enviado', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        requestId: req.id
    });
};

/**
 * Log de error
 * @param {Error} error - Error ocurrido
 * @param {Object} context - Contexto adicional
 */
const logError = (error, context = {}) => {
    logger.error('Error en aplicación', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        statusCode: error.statusCode,
        ...context
    });
};

/**
 * Middleware Express para logging de requests
 */
const requestLoggerMiddleware = (req, res, next) => {
    const start = Date.now();
    
    logRequest(req);

    res.on('finish', () => {
        const duration = Date.now() - start;
        logResponse(req, res, duration);
    });

    next();
};

/**
 * Log de operaciones de base de datos
 * @param {string} operation - Nombre de la operación
 * @param {string} collection - Colección afectada
 * @param {number} duration - Duración en ms
 * @param {Object} metadata - Metadata adicional
 */
const logDBOperation = (operation, collection, duration, metadata = {}) => {
    logger.debug('DB Operation', {
        operation,
        collection,
        duration: `${duration}ms`,
        ...metadata
    });
};

/**
 * Log de autenticación
 * @param {string} action - Acción realizada
 * @param {string} userId - ID del usuario
 * @param {boolean} success - Si fue exitosa
 * @param {Object} metadata - Metadata adicional
 */
const logAuth = (action, userId, success, metadata = {}) => {
    const level = success ? 'info' : 'warn';
    logger[level](`Auth: ${action}`, {
        userId,
        success,
        ...metadata
    });
};

/**
 * Log de seguridad (intentos sospechosos)
 * @param {string} type - Tipo de evento de seguridad
 * @param {Object} details - Detalles del evento
 */
const logSecurity = (type, details) => {
    logger.warn(`Security: ${type}`, {
        type,
        timestamp: new Date().toISOString(),
        ...details
    });
};

module.exports = {
    logger,
    logRequest,
    logResponse,
    logError,
    requestLoggerMiddleware,
    logDBOperation,
    logAuth,
    logSecurity
};
