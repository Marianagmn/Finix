/**
 * @file response.utils.test.js
 * @description Tests del contrato de respuesta — lo más importante de testear.
 *
 * Ejecutar: npx jest response.utils.test.js --verbose
 *
 * El objetivo principal: garantizar que el shape NUNCA cambia.
 * Si alguien modifica ApiResponse y rompe el contrato, estos tests fallan.
 */

'use strict';

const ApiResponse = require('./response.utils');

// Mock de res para no necesitar Express
function mockRes() {
    const res = {
        _status: null,
        _body:   null,
        status(code) { this._status = code; return this; },
        json(body)   { this._body   = body; return this; },
        send()       { this._body   = null; return this; },
    };
    return res;
}

// ─── Contrato base ────────────────────────────────────────────────────────────

describe('Contrato base — shape siempre consistente', () => {

    test('success siempre tiene success:true, data y meta', () => {
        const res = mockRes();
        ApiResponse.success(res, { id: 1 });

        expect(res._body).toHaveProperty('success', true);
        expect(res._body).toHaveProperty('data');
        expect(res._body).toHaveProperty('meta');
    });

    test('meta nunca es null — siempre tiene al menos timestamp', () => {
        const res = mockRes();
        ApiResponse.success(res, null);

        expect(res._body.meta).not.toBeNull();
        expect(res._body.meta).toHaveProperty('timestamp');
    });

    test('timestamp es ISO string válido', () => {
        const res = mockRes();
        ApiResponse.success(res, null);
        const ts = new Date(res._body.meta.timestamp);
        expect(isNaN(ts.getTime())).toBe(false);
    });

    test('data es null (no undefined) cuando no se pasa', () => {
        const res = mockRes();
        ApiResponse.success(res, undefined);
        // undefined en JSON se serializa como ausencia, null se serializa como null
        // Queremos null para que el cliente pueda hacer if (data === null)
        expect(res._body.data).toBeNull();
    });

    test('message no aparece en el body si no se pasa', () => {
        const res = mockRes();
        ApiResponse.success(res, {});
        expect(res._body).not.toHaveProperty('message');
    });

    test('message aparece cuando se pasa', () => {
        const res = mockRes();
        ApiResponse.success(res, {}, { message: 'OK' });
        expect(res._body.message).toBe('OK');
    });

    test('requestId aparece en meta cuando se pasa', () => {
        const res = mockRes();
        ApiResponse.success(res, {}, { requestId: 'abc-123' });
        expect(res._body.meta.requestId).toBe('abc-123');
    });

    test('requestId no aparece en meta cuando no se pasa', () => {
        const res = mockRes();
        ApiResponse.success(res, {});
        expect(res._body.meta).not.toHaveProperty('requestId');
    });
});

// ─── Status codes ─────────────────────────────────────────────────────────────

describe('Status codes correctos', () => {

    test('success devuelve 200 por defecto', () => {
        const res = mockRes();
        ApiResponse.success(res, {});
        expect(res._status).toBe(200);
    });

    test('success acepta statusCode custom', () => {
        const res = mockRes();
        ApiResponse.success(res, {}, { statusCode: 202 });
        expect(res._status).toBe(202);
    });

    test('created devuelve 201', () => {
        const res = mockRes();
        ApiResponse.created(res, {});
        expect(res._status).toBe(201);
    });

    test('noContent devuelve 204', () => {
        const res = mockRes();
        ApiResponse.noContent(res);
        expect(res._status).toBe(204);
    });

    test('noContent no tiene body (spec HTTP 204)', () => {
        const res = mockRes();
        ApiResponse.noContent(res);
        expect(res._body).toBeNull();
    });

    test('error devuelve el statusCode indicado', () => {
        const res = mockRes();
        ApiResponse.error(res, 'No encontrado', { statusCode: 404 });
        expect(res._status).toBe(404);
    });
});

// ─── Respuestas paginadas (offset) ────────────────────────────────────────────

describe('paginated — contrato de paginación offset', () => {

    const fakeMeta = {
        pagination: {
            type: 'offset', page: 1, limit: 20, total: 50,
            totalPages: 3, hasNext: true, hasPrev: false,
        },
    };

    test('data es el array de items', () => {
        const res   = mockRes();
        const items = [{ id: 1 }, { id: 2 }];
        ApiResponse.paginated(res, items, fakeMeta);
        expect(res._body.data).toEqual(items);
    });

    test('meta.pagination existe con todos los campos requeridos', () => {
        const res = mockRes();
        ApiResponse.paginated(res, [], fakeMeta);
        const p = res._body.meta.pagination;

        expect(p).toHaveProperty('type', 'offset');
        expect(p).toHaveProperty('page');
        expect(p).toHaveProperty('limit');
        expect(p).toHaveProperty('total');
        expect(p).toHaveProperty('totalPages');
        expect(p).toHaveProperty('hasNext');
        expect(p).toHaveProperty('hasPrev');
    });

    test('meta.extra se fusiona correctamente', () => {
        const res = mockRes();
        ApiResponse.paginated(res, [], fakeMeta, {
            extra: { totalEnCOP: 5000000 },
        });
        expect(res._body.meta.totalEnCOP).toBe(5000000);
    });

    test('meta.timestamp siempre presente', () => {
        const res = mockRes();
        ApiResponse.paginated(res, [], fakeMeta);
        expect(res._body.meta).toHaveProperty('timestamp');
    });

    test('success siempre true', () => {
        const res = mockRes();
        ApiResponse.paginated(res, [], fakeMeta);
        expect(res._body.success).toBe(true);
    });
});

// ─── Respuestas cursor ────────────────────────────────────────────────────────

describe('cursor — contrato de cursor pagination', () => {

    const fakeCursorMeta = {
        pagination: {
            type: 'cursor', limit: 50, hasMore: true, nextCursor: 'eyJ2Ij...',
        },
    };

    test('meta.pagination.type es cursor', () => {
        const res = mockRes();
        ApiResponse.cursor(res, [], fakeCursorMeta);
        expect(res._body.meta.pagination.type).toBe('cursor');
    });

    test('meta.pagination NO tiene total (tradeoff del cursor)', () => {
        const res = mockRes();
        ApiResponse.cursor(res, [], fakeCursorMeta);
        expect(res._body.meta.pagination).not.toHaveProperty('total');
    });

    test('nextCursor es accesible en meta.pagination', () => {
        const res = mockRes();
        ApiResponse.cursor(res, [], fakeCursorMeta);
        expect(res._body.meta.pagination.nextCursor).toBe('eyJ2Ij...');
    });
});

// ─── Error response ───────────────────────────────────────────────────────────

describe('error — shape de error', () => {

    test('success es false', () => {
        const res = mockRes();
        ApiResponse.error(res, 'Falló');
        expect(res._body.success).toBe(false);
    });

    test('tiene code, message y meta', () => {
        const res = mockRes();
        ApiResponse.error(res, 'No autorizado', { statusCode: 401, code: 'UNAUTHORIZED' });
        expect(res._body).toHaveProperty('code', 'UNAUTHORIZED');
        expect(res._body).toHaveProperty('message', 'No autorizado');
        expect(res._body).toHaveProperty('meta');
    });
});

// ─── requestId helper ────────────────────────────────────────────────────────

describe('ApiResponse.requestId(req)', () => {

    test('retorna req.id si existe', () => {
        expect(ApiResponse.requestId({ id: 'abc' })).toBe('abc');
    });

    test('retorna x-request-id header como fallback', () => {
        expect(ApiResponse.requestId({
            headers: { 'x-request-id': 'xyz' },
        })).toBe('xyz');
    });

    test('retorna undefined si no hay ningún ID', () => {
        expect(ApiResponse.requestId({ headers: {} })).toBeUndefined();
    });

    test('no rompe con req undefined', () => {
        expect(ApiResponse.requestId(undefined)).toBeUndefined();
    });
});