/**
 * @file filter.utils.js
 * @description Utilidades consistentes para filtrado de transacciones.
 * Unifica los criterios de filtrado entre todos los servicios de IA.
 */

'use strict';

const { TIPOS, ESTADOS } = require('../constants/transaction.constants');

/**
 * Verifica si una transacción es válida para análisis.
 * Criterios: estado completado, monto positivo, fecha válida.
 * @param {Object} item - Transacción a evaluar
 * @param {string} [tipoRequerido] - Tipo específico requerido (opcional)
 * @returns {boolean} true si la transacción es válida
 */
const esTransaccionValida = (item, tipoRequerido = null) => {
    // Verificar estado completado
    if (!item.estado || item.estado !== ESTADOS.COMPLETADO) {
        return false;
    }

    // Verificar tipo si se especificó
    if (tipoRequerido && item.tipo !== tipoRequerido) {
        return false;
    }

    // Verificar monto numérico positivo
    const monto = Number(item.monto);
    if (isNaN(monto) || monto <= 0) {
        return false;
    }

    // Verificar fecha válida
    if (item.fecha) {
        const fecha = new Date(item.fecha);
        if (isNaN(fecha.getTime())) {
            return false;
        }
    }

    return true;
};

/**
 * Verifica si un item es un gasto válido.
 * @param {Object} item - Transacción a evaluar
 * @returns {boolean} true si es un gasto válido
 */
const esGastoValido = (item) => {
    return esTransaccionValida(item, TIPOS.GASTO);
};

/**
 * Verifica si un item es un ingreso válido.
 * @param {Object} item - Transacción a evaluar
 * @returns {boolean} true si es un ingreso válido
 */
const esIngresoValido = (item) => {
    return esTransaccionValida(item, TIPOS.INGRESO);
};

/**
 * Extrae el monto numérico validado de una transacción.
 * @param {Object} item - Transacción
 * @returns {number|null} Monto validado o null si es inválido
 */
const extraerMonto = (item) => {
    const monto = Number(item.monto);
    if (isNaN(monto) || monto <= 0) {
        return null;
    }
    return monto;
};

/**
 * Extrae y valida la fecha de una transacción.
 * @param {Object} item - Transacción
 * @returns {Date|null} Fecha validada o null si es inválida
 */
const extraerFecha = (item) => {
    if (!item.fecha) return null;
    const fecha = new Date(item.fecha);
    if (isNaN(fecha.getTime())) {
        return null;
    }
    return fecha;
};

/**
 * Filtra un array de transacciones, retornando solo las válidas.
 * @param {Array} data - Array de transacciones
 * @param {string} [tipo] - Tipo específico a filtrar (opcional)
 * @returns {Array} Transacciones válidas
 */
const filtrarTransaccionesValidas = (data, tipo = null) => {
    if (!Array.isArray(data)) return [];
    return data.filter(item => esTransaccionValida(item, tipo));
};

module.exports = {
    esTransaccionValida,
    esGastoValido,
    esIngresoValido,
    extraerMonto,
    extraerFecha,
    filtrarTransaccionesValidas,
    // Exponer constantes para conveniencia
    TIPOS,
    ESTADOS
};
