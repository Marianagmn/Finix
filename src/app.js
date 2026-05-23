/**
 * @file app.js
 * @description Configuración principal de Express - montaje de rutas y middlewares globales.
 *
 * Estructura de rutas:
 *   /api/auth              - Autenticación (login, register, refresh, logout, me)
 *   /api/users             - Gestión de usuarios
 *   /api/accounts          - Cuentas financieras
 *   /api/categories        - Categorías de transacciones
 *   /api/personal-finance  - Finanzas personales
 *   /api/business-finance  - Finanzas empresariales
 *   /api/docs              - Documentación Swagger
 */

'use strict';

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { errorHandler } = require('./middlewares/error.middleware');
const requestIdMiddleware = require('./middlewares/requestId.middleware');
const { requestLoggerMiddleware } = require('./utils/logger.utils');

// ─── Crear aplicación Express ─────────────────────────────────────────────────

const app = express();

// ─── Request ID (trazabilidad) ────────────────────────────────────────────────
// FIX [M-04]: Agregar correlation ID para tracing completo
app.use(requestIdMiddleware);

// ─── Middlewares globales ─────────────────────────────────────────────────────

// Request ID ya aplicado arriba para máxima cobertura

// CORS - permitir solicitudes cross-origin
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,  // Permitir cookies cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parsear JSON en body
app.use(express.json({ limit: '10kb' }));

// Parsear cookies
app.use(cookieParser());

// Logger de requests
app.use(requestLoggerMiddleware);

// ─── Documentación Swagger ────────────────────────────────────────────────────

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Finix API Documentation'
}));

// Endpoint para obtener spec JSON
app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});

// ─── Rutas de la API ───────────────────────────────────────────────────────────

// Autenticación
app.use('/api/auth', require('./routes/auth.routes'));

// Usuarios
app.use('/api/users', require('./routes/user.routes'));

// Cuentas financieras
app.use('/api/accounts', require('./routes/account.routes'));

// Categorías
app.use('/api/categories', require('./routes/category.routes'));

// Finanzas personales
app.use('/api/personal-finance', require('./routes/personalFinance.routes'));

// Finanzas empresariales
app.use('/api/business-finance', require('./routes/businessFinance.routes'));

// ─── Ruta base / health check ─────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Finix API funcionando 🚀',
        version: '1.0.0',
        docs: '/api/docs',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint - FIX [M-05]: Health check profundo con DB y Redis
app.get('/health', async (req, res) => {
    const mongoose = require('mongoose');
    const redisService = require('./services/redis.service');

    const checks = {
        api: true,
        mongodb: false,
        redis: false
    };

    // Verificar MongoDB
    try {
        checks.mongodb = mongoose.connection.readyState === 1;
    } catch (err) {
        checks.mongodb = false;
    }

    // Verificar Redis
    try {
        checks.redis = redisService.isConnected;
        if (redisService.isConnected) {
            await redisService.client.ping();
        }
    } catch (err) {
        checks.redis = false;
    }

    const allHealthy = Object.values(checks).every(v => v === true);

    res.status(allHealthy ? 200 : 503).json({
        success: allHealthy,
        status: allHealthy ? 'healthy' : 'degraded',
        checks,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        requestId: req.id
    });
});

// ─── Manejo de rutas no encontradas ───────────────────────────────────────────

app.all('*', (req, res) => {
    res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`
    });
});

// ─── Error handler global ───────────────────────────────────────────────────
// Debe ir al final, después de todas las rutas

app.use(errorHandler);

// ─── Exportar aplicación ──────────────────────────────────────────────────────

module.exports = app;
