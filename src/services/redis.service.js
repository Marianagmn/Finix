/**
 * @file redis.service.js
 * @description Servicio Redis para blacklist de tokens y cache.
 * Implementa revocación real de tokens (BUG-05 fix).
 */

'use strict';

const { AppError } = require('../middlewares/error.middleware');

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    /**
     * Inicializa la conexión Redis.
     * @returns {Promise<void>}
     */
    async connect() {
        if (this.isConnected) return;

        try {
            // Dynamic import para ioredis (evita error si no está instalado)
            const { Redis } = await import('ioredis');
            
            this.client = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT, 10) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                db: parseInt(process.env.REDIS_DB, 10) || 0,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3
            });

            this.client.on('connect', () => {
                console.log('[Redis] Conectado exitosamente');
                this.isConnected = true;
            });

            this.client.on('error', (err) => {
                console.error('[Redis] Error:', err.message);
                this.isConnected = false;
            });

            // Esperar a que esté listo
            await this.client.ping();
            this.isConnected = true;

        } catch (err) {
            console.error('[Redis] No se pudo conectar:', err.message);
            console.log('[Redis] Continuando sin Redis (tokens no podrán ser revocados)');
            this.isConnected = false;
        }
    }

    /**
     * Agrega un token a la blacklist.
     * @param {string} jti - JWT ID del token
     * @param {number} ttl - Tiempo de vida en segundos
     * @returns {Promise<void>}
     */
    async blacklistToken(jti, ttl) {
        if (!this.isConnected || !this.client) {
            console.warn('[Redis] No disponible, token no agregado a blacklist');
            return;
        }

        try {
            await this.client.setex(`token:blacklist:${jti}`, ttl, 'revoked');
        } catch (err) {
            console.error('[Redis] Error al blacklist token:', err.message);
        }
    }

    /**
     * Verifica si un token está en la blacklist.
     * @param {string} jti - JWT ID del token
     * @returns {Promise<boolean>}
     */
    async isTokenBlacklisted(jti) {
        if (!this.isConnected || !this.client) {
            return false; // Si no hay Redis, asumir token válido
        }

        try {
            const result = await this.client.get(`token:blacklist:${jti}`);
            return result === 'revoked';
        } catch (err) {
            console.error('[Redis] Error al verificar token:', err.message);
            return false;
        }
    }

    /**
     * Revoca todos los tokens de un usuario (logout global).
     * @param {string} userId - ID del usuario
     * @returns {Promise<void>}
     */
    async revokeAllUserTokens(userId) {
        if (!this.isConnected || !this.client) {
            console.warn('[Redis] No disponible, tokens no revocados');
            return;
        }

        try {
            // Marcar que todos los tokens anteriores a este momento son inválidos
            const timestamp = Date.now();
            await this.client.setex(`user:token_revoke:${userId}`, 7 * 24 * 60 * 60, timestamp.toString());
        } catch (err) {
            console.error('[Redis] Error al revocar tokens de usuario:', err.message);
        }
    }

    /**
     * Verifica si los tokens de un usuario fueron revocados.
     * @param {string} userId - ID del usuario
     * @param {number} tokenIat - Timestamp de emisión del token
     * @returns {Promise<boolean>}
     */
    async areUserTokensRevoked(userId, tokenIat) {
        if (!this.isConnected || !this.client) {
            return false;
        }

        try {
            const revokeTimestamp = await this.client.get(`user:token_revoke:${userId}`);
            if (!revokeTimestamp) return false;
            
            // Si el token fue emitido antes de la revocación, está inválido
            return tokenIat < parseInt(revokeTimestamp, 10);
        } catch (err) {
            console.error('[Redis] Error al verificar revocación:', err.message);
            return false;
        }
    }

    /**
     * Cachea datos con TTL.
     * @param {string} key - Clave del cache
     * @param {*} value - Valor a cachear
     * @param {number} ttl - Tiempo de vida en segundos
     * @returns {Promise<void>}
     */
    async setCache(key, value, ttl = 300) {
        if (!this.isConnected || !this.client) return;

        try {
            const serialized = JSON.stringify(value);
            await this.client.setex(`cache:${key}`, ttl, serialized);
        } catch (err) {
            console.error('[Redis] Error al setear cache:', err.message);
        }
    }

    /**
     * Obtiene datos del cache.
     * @param {string} key - Clave del cache
     * @returns {Promise<*|null>}
     */
    async getCache(key) {
        if (!this.isConnected || !this.client) return null;

        try {
            const value = await this.client.get(`cache:${key}`);
            if (!value) return null;
            return JSON.parse(value);
        } catch (err) {
            console.error('[Redis] Error al obtener cache:', err.message);
            return null;
        }
    }

    /**
     * Invalida una clave del cache.
     * @param {string} key - Clave a invalidar
     * @returns {Promise<void>}
     */
    async invalidateCache(key) {
        if (!this.isConnected || !this.client) return;

        try {
            await this.client.del(`cache:${key}`);
        } catch (err) {
            console.error('[Redis] Error al invalidar cache:', err.message);
        }
    }

    /**
     * Cierra la conexión Redis.
     * @returns {Promise<void>}
     */
    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
            console.log('[Redis] Desconectado');
        }
    }
}

// Singleton instance
const redisService = new RedisService();

module.exports = redisService;
