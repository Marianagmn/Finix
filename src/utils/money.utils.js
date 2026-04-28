'use strict';

/**
 * @file money.utils.js
 * @description Utilidades de normalización monetaria.
 * El modelo almacena montos en centavos (set: v => v * 100).
 * lean() no aplica getters, así que la conversión es manual aquí.
 */

/**
 * Convierte un monto en centavos a moneda decimal.
 * @param {number} cents
 * @returns {number}
 */
const fromCents = (cents) => (typeof cents === 'number' ? cents / 100 : 0);

/**
 * Convierte un monto decimal a centavos (entero).
 * @param {number} value
 * @returns {number}
 */
const toCents = (value) => Math.round((value || 0) * 100);

/**
 * Normaliza los campos monetarios de un objeto plano (resultado de lean()).
 * Convierte de centavos a moneda real solo los campos indicados.
 *
 * @param {object} item - Documento plano de Mongoose (resultado de lean())
 * @param {string[]} fields - Nombres de campos a normalizar (default: campos comunes)
 * @returns {object} Objeto con campos monetarios normalizados
 */
const normalizeMoneyFields = (item, fields = ['monto']) => {
    if (!item || typeof item !== 'object') return item;
    const result = { ...item };
    for (const field of fields) {
        if (result[field] !== undefined && result[field] !== null) {
            result[field] = fromCents(result[field]);
        }
    }
    return result;
};

/**
 * Normaliza montos de un array de documentos planos.
 * @param {object[]} items
 * @param {string[]} fields
 * @returns {object[]}
 */
const normalizeAmounts = (items, fields = ['monto']) => {
    if (!Array.isArray(items)) return items;
    return items.map(item => normalizeMoneyFields(item, fields));
};

/**
 * Campos monetarios estándar de PersonalFinance (para lean())
 */
const PERSONAL_FINANCE_MONEY_FIELDS = ['monto'];

/**
 * Campos monetarios de BusinessFinance (para lean())
 */
const BUSINESS_FINANCE_MONEY_FIELDS = [
    'monto', 'montoNeto', 'totalImpuestos', 'montoCOP', 'saldoPendiente',
];

module.exports = {
    fromCents,
    toCents,
    normalizeMoneyFields,
    normalizeAmounts,
    PERSONAL_FINANCE_MONEY_FIELDS,
    BUSINESS_FINANCE_MONEY_FIELDS,
};
