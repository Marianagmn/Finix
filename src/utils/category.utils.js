/**
 * @file category.utils.js
 * @description Utilidades para normalización y manejo de categorías.
 * Centraliza la lógica de categorías usada por múltiples servicios.
 */

'use strict';

/**
 * Normaliza una categoría a formato estándar.
 * Convierte a minúsculas, reemplaza espacios con underscores.
 * @param {*} cat - Valor raw de categoría
 * @returns {string} Categoría normalizada
 */
const normalizarCategoria = (cat) => {
    if (!cat) return 'sin_categoria';
    return cat.toString().toLowerCase().trim().replace(/\s+/g, '_') || 'sin_categoria';
};

/**
 * Verifica si una categoría es de gasto esencial.
 * @param {string} categoria - Categoría normalizada
 * @returns {boolean} true si es esencial
 */
const esCategoriaEsencial = (categoria) => {
    const esenciales = [
        'vivienda', 'comida', 'alimentacion', 'transporte',
        'servicios', 'salud', 'educacion', 'aseo', 'medicina'
    ];
    return esenciales.includes(categoria);
};

/**
 * Verifica si una categoría es discrecional (no esencial).
 * @param {string} categoria - Categoría normalizada
 * @returns {boolean} true si es discrecional
 */
const esCategoriaDiscrecional = (categoria) => {
    const discrecionales = [
        'entretenimiento', 'ocio', 'compras', 'shopping',
        'lujo', 'restaurantes', 'hobbies', 'viajes', 'regalos'
    ];
    return discrecionales.includes(categoria);
};

/**
 * Obtiene el tipo de clasificación de una categoría.
 * @param {string} categoria - Categoría normalizada
 * @returns {string} 'esencial', 'discrecional', o 'otro'
 */
const clasificarCategoria = (categoria) => {
    if (esCategoriaEsencial(categoria)) return 'esencial';
    if (esCategoriaDiscrecional(categoria)) return 'discrecional';
    return 'otro';
};

module.exports = {
    normalizarCategoria,
    esCategoriaEsencial,
    esCategoriaDiscrecional,
    clasificarCategoria
};
