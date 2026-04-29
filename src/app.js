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

// ─── Crear aplicación Express ─────────────────────────────────────────────────

const app = express();

// ─── Middlewares globales ─────────────────────────────────────────────────────

// CORS - permitir solicitudes cross-origin
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,  // Permitir cookies cross-origin
}));

// Parsear JSON en body
app.use(express.json({ limit: '10kb' }));

// Parsear cookies
app.use(cookieParser());

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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
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
