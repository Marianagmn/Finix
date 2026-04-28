/**
 * @file category.utils.test.js
 * @description Tests unitarios para utilidades de categorías.
 */

'use strict';

const assert = require('assert');
const {
    normalizarCategoria,
    esCategoriaEsencial,
    esCategoriaDiscrecional,
    clasificarCategoria
} = require('../utils/category.utils');

describe('category.utils', () => {

    describe('normalizarCategoria()', () => {
        it('debe convertir a minúsculas', () => {
            assert.strictEqual(normalizarCategoria('Alimentacion'), 'alimentacion');
        });

        it('debe reemplazar espacios con guiones bajos', () => {
            assert.strictEqual(normalizarCategoria('comida rapida'), 'comida_rapida');
        });

        it('debe retornar "sin_categoria" para valores null/undefined', () => {
            assert.strictEqual(normalizarCategoria(null), 'sin_categoria');
            assert.strictEqual(normalizarCategoria(undefined), 'sin_categoria');
            assert.strictEqual(normalizarCategoria(''), 'sin_categoria');
        });

        it('debe manejar múltiples espacios', () => {
            assert.strictEqual(normalizarCategoria('  entretenimiento  '), 'entretenimiento');
            assert.strictEqual(normalizarCategoria('ocio    y  hobbies'), 'ocio_y_hobbies');
        });
    });

    describe('esCategoriaEsencial()', () => {
        it('debe identificar categorías esenciales', () => {
            assert.strictEqual(esCategoriaEsencial('vivienda'), true);
            assert.strictEqual(esCategoriaEsencial('salud'), true);
            assert.strictEqual(esCategoriaEsencial('educacion'), true);
        });

        it('debe rechazar categorías discrecionales', () => {
            assert.strictEqual(esCategoriaEsencial('entretenimiento'), false);
            assert.strictEqual(esCategoriaEsencial('lujo'), false);
        });
    });

    describe('esCategoriaDiscrecional()', () => {
        it('debe identificar categorías discrecionales', () => {
            assert.strictEqual(esCategoriaDiscrecional('entretenimiento'), true);
            assert.strictEqual(esCategoriaDiscrecional('viajes'), true);
            assert.strictEqual(esCategoriaDiscrecional('hobbies'), true);
        });

        it('debe rechazar categorías esenciales', () => {
            assert.strictEqual(esCategoriaDiscrecional('comida'), false);
            assert.strictEqual(esCategoriaDiscrecional('transporte'), false);
        });
    });

    describe('clasificarCategoria()', () => {
        it('debe clasificar como esencial', () => {
            assert.strictEqual(clasificarCategoria('vivienda'), 'esencial');
        });

        it('debe clasificar como discrecional', () => {
            assert.strictEqual(clasificarCategoria('ocio'), 'discrecional');
        });

        it('debe clasificar como otro para categorías desconocidas', () => {
            assert.strictEqual(clasificarCategoria('categoria_desconocida'), 'otro');
        });
    });
});
