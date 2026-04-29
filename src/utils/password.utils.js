/**
 * @file password.utils.js
 * @description Utilidades de hashing y verificación de contraseñas (bcrypt).
 *
 * RENOMBRADO desde bcrypt.middleware.js por las siguientes razones:
 *  - Un "middleware" Express es una función (req, res, next). Esta clase no lo es.
 *  - El nombre BcryptMiddleware mezcla la implementación (bcrypt) con el rol (utility).
 *  - PasswordUtils describe exactamente qué hace: utilidades para contraseñas.
 *
 * IMPORTANTE — por qué NO exponemos un middleware de pre-hashing en rutas:
 *  El patrón anterior (hashPasswordMiddleware en la ruta + pre-save hook en el modelo)
 *  causaba DOUBLE-HASHING: bcrypt(bcrypt(password)) se almacenaba en DB.
 *  Mongoose marca todos los campos de un documento nuevo como isModified() === true,
 *  por lo que el pre-save hook SIEMPRE re-hasheaba el hash entrante.
 *  Solución: el hashing ocurre en UN SOLO LUGAR — el pre-save hook del modelo.
 *  Aquí solo exponemos hash() y compare() para uso directo del modelo y el servicio.
 */

'use strict';

const bcrypt       = require('bcryptjs');
const { AppError } = require('../middlewares/error.middleware');

// ─── Configuración ────────────────────────────────────────────────────────────

const SALT_ROUNDS    = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;
const MIN_LENGTH     = 8;
const MAX_BYTE_LENGTH = 72; // bcrypt trunca silenciosamente a 72 bytes

// ─── PasswordUtils ────────────────────────────────────────────────────────────

class PasswordUtils {

    /**
     * Valida la contraseña en texto plano ANTES de hashearla.
     * Debe llamarse con el valor original del usuario, nunca con un hash.
     *
     * @param {string} password - Contraseña en texto plano.
     * @throws {AppError} 400 si no cumple los criterios.
     */
    static validate(password) {
        if (!password || typeof password !== 'string') {
            throw AppError.badRequest('La contraseña es requerida y debe ser texto');
        }
        if (password.length < MIN_LENGTH) {
            throw AppError.badRequest(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`);
        }
        if (Buffer.byteLength(password, 'utf8') > MAX_BYTE_LENGTH) {
            // bcrypt ignora silenciosamente los bytes después del 72 —
            // dos contraseñas diferentes podrían producir el mismo hash.
            throw AppError.badRequest('La contraseña excede 72 bytes (límite de bcrypt)');
        }
    }

    /**
     * Hashea una contraseña en texto plano.
     * Llama a validate() internamente — nunca hashea inputs inválidos.
     *
     * @param {string} plainPassword
     * @returns {Promise<string>} Hash bcrypt de 60 caracteres.
     */
    static async hash(plainPassword) {
        PasswordUtils.validate(plainPassword);
        const salt = await bcrypt.genSalt(SALT_ROUNDS);
        return bcrypt.hash(plainPassword, salt);
    }

    /**
     * Compara un texto plano contra un hash almacenado.
     * Usa comparación de tiempo constante — inmune a timing attacks.
     *
     * @param {string} plainPassword   - Candidato del usuario.
     * @param {string} hashedPassword  - Hash almacenado en DB.
     * @returns {Promise<boolean>}
     */
    static async compare(plainPassword, hashedPassword) {
        if (!plainPassword || !hashedPassword) {
            throw AppError.badRequest('Se requieren contraseña y hash para comparar');
        }
        return bcrypt.compare(plainPassword, hashedPassword);
    }
}

module.exports = PasswordUtils;