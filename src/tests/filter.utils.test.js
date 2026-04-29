/**
 * @file filter.utils.test.js
 * @description Tests unitarios para utilidades de filtrado.
 */

'use strict';

const assert = require('assert');
const {
    esTransaccionValida,
    esGastoValido,
    esIngresoValido,
    extraerMonto,
    extraerFecha,
    filtrarTransaccionesValidas,
    ESTADOS,
    TIPOS
} = require('../utils/filter.utils');

describe('filter.utils', () => {

    describe('esTransaccionValida()', () => {
        it('debe aceptar transacción válida completada', () => {
            const item = {
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.GASTO,
                monto: 100,
                fecha: new Date()
            };
            assert.strictEqual(esTransaccionValida(item), true);
        });

        it('debe rechazar transacción pendiente', () => {
            const item = {
                estado: ESTADOS.BORRADOR,
                tipo: TIPOS.GASTO,
                monto: 100
            };
            assert.strictEqual(esTransaccionValida(item), false);
        });

        it('debe rechazar monto no numérico', () => {
            const item = {
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.GASTO,
                monto: 'invalid'
            };
            assert.strictEqual(esTransaccionValida(item), false);
        });

        it('debe rechazar monto negativo o cero', () => {
            const item1 = { estado: ESTADOS.COMPLETADO, tipo: TIPOS.GASTO, monto: -10 };
            const item2 = { estado: ESTADOS.COMPLETADO, tipo: TIPOS.GASTO, monto: 0 };
            assert.strictEqual(esTransaccionValida(item1), false);
            assert.strictEqual(esTransaccionValida(item2), false);
        });

        it('debe filtrar por tipo específico', () => {
            const item = {
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.INGRESO,
                monto: 100
            };
            assert.strictEqual(esTransaccionValida(item, TIPOS.INGRESO), true);
            assert.strictEqual(esTransaccionValida(item, TIPOS.GASTO), false);
        });
    });

    describe('esGastoValido()', () => {
        it('debe identificar gasto válido', () => {
            const item = {
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.GASTO,
                monto: 100
            };
            assert.strictEqual(esGastoValido(item), true);
        });

        it('debe rechazar ingreso como gasto', () => {
            const item = {
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.INGRESO,
                monto: 100
            };
            assert.strictEqual(esGastoValido(item), false);
        });
    });

    describe('esIngresoValido()', () => {
        it('debe identificar ingreso válido', () => {
            const item = {
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.INGRESO,
                monto: 100
            };
            assert.strictEqual(esIngresoValido(item), true);
        });
    });

    describe('extraerMonto()', () => {
        it('debe extraer monto numérico válido', () => {
            assert.strictEqual(extraerMonto({ monto: 100 }), 100);
            assert.strictEqual(extraerMonto({ monto: '100' }), 100);
            assert.strictEqual(extraerMonto({ monto: 100.50 }), 100.50);
        });

        it('debe retornar null para monto inválido', () => {
            assert.strictEqual(extraerMonto({ monto: 'invalid' }), null);
            assert.strictEqual(extraerMonto({ monto: -10 }), null);
            assert.strictEqual(extraerMonto({ monto: 0 }), null);
        });
    });

    describe('extraerFecha()', () => {
        it('debe extraer fecha válida', () => {
            const fecha = new Date('2024-01-15');
            const resultado = extraerFecha({ fecha });
            assert(resultado instanceof Date);
            assert.strictEqual(resultado.getTime(), fecha.getTime());
        });

        it('debe retornar null para fecha inválida', () => {
            assert.strictEqual(extraerFecha({ fecha: 'invalid' }), null);
            assert.strictEqual(extraerFecha({ fecha: null }), null);
        });
    });

    describe('filtrarTransaccionesValidas()', () => {
        it('debe filtrar solo transacciones válidas', () => {
            const data = [
                { estado: ESTADOS.COMPLETADO, tipo: TIPOS.GASTO, monto: 100 },
                { estado: ESTADOS.BORRADOR, tipo: TIPOS.GASTO, monto: 100 }, // inválida
                { estado: ESTADOS.COMPLETADO, tipo: TIPOS.GASTO, monto: -10 }, // inválida
                { estado: ESTADOS.COMPLETADO, tipo: TIPOS.INGRESO, monto: 200 }
            ];
            const resultado = filtrarTransaccionesValidas(data);
            assert.strictEqual(resultado.length, 2);
        });

        it('debe manejar array vacío', () => {
            assert.deepStrictEqual(filtrarTransaccionesValidas([]), []);
        });

        it('debe manejar input no-array', () => {
            assert.deepStrictEqual(filtrarTransaccionesValidas(null), []);
            assert.deepStrictEqual(filtrarTransaccionesValidas(undefined), []);
        });
    });
});
