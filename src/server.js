/**
 * @file server.js
 * @description Punto de entrada de la aplicación - conecta a DB y levanta servidor.
 *
 * Este archivo:
 *   1. Carga variables de entorno
 *   2. Conecta a MongoDB
 *   3. Importa la app configurada desde app.js
 *   4. Levanta el servidor HTTP
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');

// ─── Configuración ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// ─── Validar variables de entorno críticas ───────────────────────────────────

if (!MONGO_URI) {
    console.error('❌ ERROR: MONGO_URI no está definida en las variables de entorno');
    process.exit(1);
}

if (!process.env.JWT_SECRET) {
    console.error('❌ ERROR: JWT_SECRET no está definida en las variables de entorno');
    process.exit(1);
}

if (!process.env.JWT_REFRESH_SECRET) {
    console.error('❌ ERROR: JWT_REFRESH_SECRET no está definida en las variables de entorno');
    process.exit(1);
}

// ─── Conectar a MongoDB ──────────────────────────────────────────────────────

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    w: 'majority'
})
    .then(() => {
        console.log('✅ MongoDB conectado correctamente');
        startServer();
    })
    .catch(err => {
        console.error('❌ Error al conectar MongoDB:', err.message);
        process.exit(1);
    });

// ─── Eventos de conexión MongoDB ─────────────────────────────────────────────

mongoose.connection.on('connected', () => {
    console.log('📦 Mongoose conectado a MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ Error en conexión de Mongoose:', err.message);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️  Mongoose desconectado de MongoDB');
});

// ─── Iniciar servidor HTTP ───────────────────────────────────────────────────

function startServer() {
    const server = app.listen(PORT, () => {
        console.log('');
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║              🚀 FINIX API - Servidor iniciado          ║');
        console.log('╠════════════════════════════════════════════════════════╣');
        console.log(`║  📡 Puerto:     ${PORT.toString().padEnd(38)}║`);
        console.log(`║  🌐 URL:        http://localhost:${PORT}${'/'.padEnd(22)}║`);
        console.log(`║  📚 Docs:       http://localhost:${PORT}/api/docs${' '.padEnd(12)}║`);
        console.log(`║  💻 Environment: ${(process.env.NODE_ENV || 'development').padEnd(35)}║`);
        console.log('╚════════════════════════════════════════════════════════╝');
        console.log('');
    });

    // ─── Manejo graceful shutdown ─────────────────────────────────────────────

    const gracefulShutdown = (signal) => {
        console.log(`\n${signal} recibido. Cerrando servidor gracefully...`);

        server.close(() => {
            console.log('🔒 Servidor HTTP cerrado');

            mongoose.connection.close(false, () => {
                console.log('📦 Conexión a MongoDB cerrada');
                process.exit(0);
            });
        });

        // Forzar cierre después de 10 segundos
        setTimeout(() => {
            console.error('⚠️  Forzando cierre después de 10 segundos');
            process.exit(1);
        }, 10000);
    };

    // Escuchar señales de terminación
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// ─── Manejo de errores no capturados ─────────────────────────────────────────

process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION! Cerrando...');
    console.error(err.name, err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 UNHANDLED REJECTION!');
    console.error('Promise:', promise);
    console.error('Reason:', reason);
    process.exit(1);
});
 
