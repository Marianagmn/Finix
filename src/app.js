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
const CsrfMiddleware = require('./middlewares/csrf.middleware');

// ─── Crear aplicación Express ─────────────────────────────────────────────────

const app = express();

// ─── Request ID (trazabilidad) ────────────────────────────────────────────────
// FIX [M-04]: Agregar correlation ID para tracing completo
app.use(requestIdMiddleware);

// ─── Middlewares globales ─────────────────────────────────────────────────────

// Request ID ya aplicado arriba para máxima cobertura

// CORS - permitir solicitudes cross-origin con whitelist estricta
// SECURITY FIX: Never use '*' with credentials enabled
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200').split(',').map(o => o.trim());

app.use(cors({
    origin(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,  // Permitir cookies cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Security headers
app.use((req, res, next) => {
    // HSTS - Force HTTPS in production
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    next();
});

// Parsear JSON en body
app.use(express.json({ limit: '10kb' }));

// Parsear cookies
app.use(cookieParser());

// CSRF Protection - SECURITY FIX: Protect against CSRF attacks
// Only enable in production or when explicitly enabled
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CSRF === 'true') {
    app.use(CsrfMiddleware.protect);
}

// Logger de requests
app.use(requestLoggerMiddleware);

// ─── Documentación Swagger ────────────────────────────────────────────────────
// SECURITY FIX: Hide Swagger in production to prevent exposing API structure

if (process.env.NODE_ENV !== 'production') {
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
}

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
