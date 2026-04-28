/**
 * @file metrics.middleware.js
 * @description Middleware para recopilación de métricas de performance.
 * Expone métricas para Prometheus y tracking de performance de API.
 */

'use strict';

const { logResponse } = require('../utils/logger.utils');

// Almacenamiento en memoria de métricas (para demo; usar Prometheus/InfluxDB en producción)
const metrics = {
    requests: {
        total: 0,
        byRoute: {},
        byStatus: {}
    },
    responseTimes: [],
    dbOperations: {
        total: 0,
        slowQueries: 0
    }
};

/**
 * Middleware para tracking de métricas HTTP
 */
const metricsMiddleware = (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1_000_000; // Convertir a milisegundos

        // Actualizar métricas
        metrics.requests.total++;
        
        const route = `${req.method} ${req.route?.path || req.path}`;
        metrics.requests.byRoute[route] = (metrics.requests.byRoute[route] || 0) + 1;
        
        const statusCode = res.statusCode.toString();
        metrics.requests.byStatus[statusCode] = (metrics.requests.byStatus[statusCode] || 0) + 1;
        
        // Mantener solo últimos 1000 tiempos de respuesta
        metrics.responseTimes.push(duration);
        if (metrics.responseTimes.length > 1000) {
            metrics.responseTimes.shift();
        }

        // Log si es lento (> 1000ms)
        if (duration > 1000) {
            console.warn(`[SLOW] ${route} tomó ${duration.toFixed(2)}ms`);
        }
    });

    next();
};

/**
 * Tracking de operaciones de base de datos
 * @param {string} operation - Tipo de operación (find, update, etc.)
 * @param {string} collection - Nombre de la colección
 * @param {number} duration - Duración en ms
 */
const trackDBOperation = (operation, collection, duration) => {
    metrics.dbOperations.total++;
    
    if (duration > 500) {
        metrics.dbOperations.slowQueries++;
        console.warn(`[SLOW DB] ${operation} en ${collection} tomó ${duration.toFixed(2)}ms`);
    }
};

/**
 * Endpoint para exponer métricas (formato simple para desarrollo)
 * En producción, usar formato Prometheus
 */
const getMetrics = (req, res) => {
    const avgResponseTime = metrics.responseTimes.length > 0
        ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
        : 0;

    // FIX [I-06]: [...arr].sort() para no mutar el array original.
    // metrics.responseTimes.sort() muta en-place — corrompe el orden cronológico
    // y el cálculo del avg en la siguiente llamada.
    const sorted = [...metrics.responseTimes].sort((a, b) => a - b);
    const p95ResponseTime = sorted.length > 0
        ? sorted[Math.floor(sorted.length * 0.95)]
        : 0;

    res.json({
        success: true,
        data: {
            requests: metrics.requests,
            responseTime: {
                avg: Math.round(avgResponseTime * 100) / 100,
                p95: Math.round(p95ResponseTime * 100) / 100,
                samples: metrics.responseTimes.length
            },
            dbOperations: metrics.dbOperations,
            uptime: process.uptime()
        }
    });
};

/**
 * Resetear métricas (útil para tests)
 */
const resetMetrics = () => {
    metrics.requests.total = 0;
    metrics.requests.byRoute = {};
    metrics.requests.byStatus = {};
    metrics.responseTimes = [];
    metrics.dbOperations.total = 0;
    metrics.dbOperations.slowQueries = 0;
};

module.exports = {
    metricsMiddleware,
    trackDBOperation,
    getMetrics,
    resetMetrics
};
