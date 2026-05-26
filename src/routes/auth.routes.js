/**
 * @file auth.routes.js
 * @description Router de autenticación con rate limiting, validación y guards.
 *
 *
 * Montar en app.js:
 *   app.use('/api/auth', require('./auth.routes'));
 *
 * Instalación de dependencias nuevas:
 *   npm install express-rate-limit zod
 */

'use strict';

const express      = require('express');
const rateLimit    = require('express-rate-limit');
const AuthMiddleware  = require('../middlewares/auth.middleware');
const authController  = require('../controllers/auth.controller');
const { validate, schemas } = require('../middlewares/validate.middleware');

const router = express.Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────

/**
 * FIX [P-01]: Rate limiter para /login.
 *
 * 15 intentos por IP en 15 minutos.
 * skipSuccessfulRequests: true — solo cuenta fallos, no penaliza logins correctos.
 *
 * NOTA: Para producción real con múltiples instancias (cluster/K8s),
 * usar un store compartido en Redis:
 *   const RedisStore = require('rate-limit-redis');
 *   store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) })
 */
const loginLimiter = rateLimit({
    windowMs:               15 * 60 * 1000,  // 15 minutos
    max:                    15,
    skipSuccessfulRequests: true,
    standardHeaders:        true,             // Expone X-RateLimit-* headers
    legacyHeaders:          false,
    message: {
        success: false,
        code:    'TOO_MANY_REQUESTS',
        message: 'Demasiados intentos. Intente de nuevo en 15 minutos.',
    },
    keyGenerator: (req) => req.ip,
});

/**
 * Rate limiter para /register.
 * 5 cuentas por hora por IP — previene creación masiva de cuentas.
 */
const registerLimiter = rateLimit({
    windowMs:        60 * 60 * 1000,  // 1 hora
    max:             5,
    standardHeaders: true,
    legacyHeaders:   false,
    message: {
        success: false,
        code:    'TOO_MANY_REQUESTS',
        message: 'Límite de registros alcanzado. Intente en 1 hora.',
    },
});

/**
 * Rate limiter para /refresh — previene rotación masiva de tokens.
 */
const refreshLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             30,
    standardHeaders: true,
    legacyHeaders:   false,
});

/**
 * Rate limiter para /forgot-password — previene abuso de envío de emails.
 */
const forgotPasswordLimiter = rateLimit({
    windowMs:        60 * 60 * 1000,  // 1 hora
    max:             3,
    standardHeaders: true,
    legacyHeaders:   false,
    message: {
        success: false,
        code:    'TOO_MANY_REQUESTS',
        message: 'Demasiados intentos. Intente en 1 hora.',
    },
});

// ─── Rutas públicas ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar nuevo usuario
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *               - passwordConfirm
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               passwordConfirm:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usuario registrado exitosamente
 *       400:
 *         description: Datos inválidos
 */
router.post(
    '/register',
    registerLimiter,              // 1. Limita por IP
    validate(schemas.register),   // 2. Valida y sanitiza input (incluyendo passwordConfirm)
    authController.register       // 3. Delega a controller → service → model
    // NOTA: NO hay hashPasswordMiddleware aquí.
    //       El pre-save hook del modelo hashea el texto plano.
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       401:
 *         description: Credenciales inválidas
 */
router.post(
    '/login',
    loginLimiter,                 // 1. Limita por IP
    validate(schemas.login),      // 2. Valida email y password
    authController.login          // 3. Controller → service
);

router.post(
    '/refresh',
    refreshLimiter,
    authController.refresh
);

router.post('/logout', authController.logout);

router.post(
    '/forgot-password',
    forgotPasswordLimiter,
    authController.forgotPassword
);

router.post(
    '/reset-password',
    authController.resetPassword
);

// ─── Rutas protegidas ─────────────────────────────────────────────────────────

router.get(
    '/me',
    AuthMiddleware.protect,       // Verifica JWT + estado de cuenta + cambio de password
    authController.me
);

module.exports = router;