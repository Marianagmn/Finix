/**
 * @file swagger.js
 * @description Configuración de Swagger/OpenAPI para documentación de API.
 */

'use strict';

const swaggerJSDoc = require('swagger-jsdoc');

// Importar constantes para mantener sincronizados los enums
const {
    ESTADOS,
    ESTADOS_PERSONALES,
    TIPOS_BASE,
    TIPOS,
    METODOS_PAGO
} = require('../constants/transaction.constants');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Finix API',
            version: '1.0.0',
            description: 'API de gestión financiera personal y empresarial',
            contact: {
                name: 'Equipo Finix',
                email: 'support@finix.com'
            }
        },
        servers: [
            {
                url: 'http://localhost:3000/api',
                description: 'Servidor de desarrollo'
            },
            {
                url: 'https://api.finix.com/api',
                description: 'Servidor de producción'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Ingresa tu token JWT'
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        roles: { type: 'array', items: { type: 'string' } },
                        isActive: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                Account: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        nombre: { type: 'string' },
                        tipo: { type: 'string', enum: Object.values(TIPOS_BASE) },
                        moneda: { type: 'string' },
                        balance: { type: 'number' },
                        isActive: { type: 'boolean' }
                    }
                },
                Category: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        nombre: { type: 'string' },
                        tipo: { type: 'string', enum: Object.values(TIPOS) },
                        color: { type: 'string' },
                        icono: { type: 'string' }
                    }
                },
                Transaction: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        tipo: { type: 'string', enum: Object.values(TIPOS) },
                        monto: { type: 'number' },
                        descripcion: { type: 'string' },
                        fecha: { type: 'string', format: 'date-time' },
                        categoria: { type: 'string' },
                       estado: { type: 'string', enum: Object.values(ESTADOS_PERSONALES) }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        code: { type: 'string' },
                        message: { type: 'string' },
                        meta: { type: 'object' }
                    }
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    apis: [
        './src/routes/*.js',
        './src/controllers/*.js'
    ]
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;