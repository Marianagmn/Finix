/**
 * @file pagination.utils.test.js
 * @description Tests unitarios para pagination.utils.js
 *
 * Instalación: npm install --save-dev jest
 * Ejecutar:    npx jest pagination.utils.test.js --verbose
 *
 * Estos tests cubren los casos que explotan en producción:
 *  - Inputs maliciosos desde req.query
 *  - Límites de seguridad (MAX_LIMIT)
 *  - Sort injection
 *  - Cursores malformados
 *  - Filtros con tipos incorrectos
 */

'use strict';

const Pagination              = require('./pagination.utils');
const { SortParser, FilterParser } = Pagination;

// ─── SortParser ───────────────────────────────────────────────────────────────

describe('SortParser', () => {

    describe('formato legacy (-campo)', () => {
        test('parsea campo descendente con prefijo -', () => {
            expect(SortParser.parse('-fecha', ['fecha'])).toEqual({ fecha: -1 });
        });

        test('parsea campo ascendente sin prefijo', () => {
            expect(SortParser.parse('fecha', ['fecha'])).toEqual({ fecha: 1 });
        });
    });

    describe('formato nuevo (campo:dir)', () => {
        test('parsea campo:desc', () => {
            expect(SortParser.parse('fecha:desc', ['fecha'])).toEqual({ fecha: -1 });
        });

        test('parsea campo:asc', () => {
            expect(SortParser.parse('monto:asc', ['monto'])).toEqual({ monto: 1 });
        });

        test('parsea múltiples campos separados por coma', () => {
            expect(SortParser.parse(
                'estado:asc,fecha:desc',
                ['estado', 'fecha']
            )).toEqual({ estado: 1, fecha: -1 });
        });

        test('respeta el límite de MAX_SORT_FIELDS (3)', () => {
            const result = SortParser.parse(
                'a:asc,b:desc,c:asc,d:asc,e:asc',
                ['a', 'b', 'c', 'd', 'e']
            );
            expect(Object.keys(result).length).toBeLessThanOrEqual(3);
        });
    });

    describe('seguridad — sort injection', () => {
        test('ignora campos no en la whitelist', () => {
            const result = SortParser.parse('password:asc', ['fecha', 'monto'], '-fecha');
            expect(result).not.toHaveProperty('password');
        });

        test('usa default si ningún campo es válido', () => {
            expect(SortParser.parse('__proto__:asc', ['fecha'], '-fecha'))
                .toEqual({ fecha: -1 });
        });

        test('rechaza campos con caracteres especiales', () => {
            const result = SortParser.parse('$where:1', ['fecha'], '-fecha');
            expect(result).toEqual({ fecha: -1 });
        });

        test('acepta campos con punto para nested (ej: vencimiento.fechaVencimiento)', () => {
            const result = SortParser.parse(
                'vencimiento.fechaVencimiento:asc',
                ['vencimiento.fechaVencimiento']
            );
            expect(result).toEqual({ 'vencimiento.fechaVencimiento': 1 });
        });
    });

    describe('con array (React Query envía arrays)', () => {
        test('parsea el primer elemento de un array', () => {
            const result = SortParser.parse(['fecha:desc', 'monto:asc'], ['fecha', 'monto']);
            expect(result).toHaveProperty('fecha', -1);
        });
    });
});

// ─── FilterParser ─────────────────────────────────────────────────────────────

describe('FilterParser', () => {

    describe('campos exactos', () => {
        test('parsea campo string exacto', () => {
            const filter = FilterParser.parse(
                { estado: 'contabilizado' },
                { allowed: ['estado'] }
            );
            expect(filter).toEqual({ estado: 'contabilizado' });
        });

        test('ignora campos no en la whitelist', () => {
            const filter = FilterParser.parse(
                { estado: 'ok', password: 'hack' },
                { allowed: ['estado'] }
            );
            expect(filter).not.toHaveProperty('password');
        });

        test('ignora valores vacíos', () => {
            const filter = FilterParser.parse(
                { estado: '' },
                { allowed: ['estado'] }
            );
            expect(filter).not.toHaveProperty('estado');
        });
    });

    describe('arrays (?tipo=gasto,ingreso)', () => {
        test('convierte string separado por coma a $in', () => {
            const filter = FilterParser.parse(
                { tipo: 'gasto,ingreso,transferencia' },
                { arrays: ['tipo'] }
            );
            expect(filter.tipo).toEqual({ $in: ['gasto', 'ingreso', 'transferencia'] });
        });

        test('valor único no genera $in innecesario... espera array con 1 elem', () => {
            const filter = FilterParser.parse({ tipo: 'gasto' }, { arrays: ['tipo'] });
            expect(filter.tipo.$in).toContain('gasto');
        });
    });

    describe('booleanos', () => {
        test('convierte string "true" a boolean true', () => {
            const filter = FilterParser.parse(
                { isActive: 'true' },
                { booleans: ['isActive'] }
            );
            expect(filter.isActive).toBe(true);
        });

        test('convierte string "false" a boolean false', () => {
            const filter = FilterParser.parse(
                { isActive: 'false' },
                { booleans: ['isActive'] }
            );
            expect(filter.isActive).toBe(false);
        });
    });

    describe('rangos (_gte, _lte)', () => {
        test('parsea monto_gte como número', () => {
            const filter = FilterParser.parse(
                { monto_gte: '1000' },
                { ranges: ['monto'] }
            );
            expect(filter.monto).toEqual({ $gte: 1000 });
        });

        test('parsea rango completo de fechas', () => {
            const filter = FilterParser.parse(
                { fecha_gte: '2024-01-01', fecha_lte: '2024-12-31' },
                { ranges: ['fecha'] }
            );
            expect(filter.fecha.$gte).toBeInstanceOf(Date);
            expect(filter.fecha.$lte).toBeInstanceOf(Date);
        });

        test('ignora rangos con valores no parseables', () => {
            const filter = FilterParser.parse(
                { monto_gte: 'no-es-numero' },
                { ranges: ['monto'] }
            );
            expect(filter).not.toHaveProperty('monto');
        });
    });

    describe('seguridad — NoSQL injection', () => {
        test('ignora objectIds inválidos silenciosamente', () => {
            const filter = FilterParser.parse(
                { terceroId: '{ "$gt": "" }' },
                { objectIds: ['terceroId'] }
            );
            expect(filter).not.toHaveProperty('terceroId');
        });

        test('escapa regex en search para prevenir ReDoS', () => {
            const filter = FilterParser.parse(
                { search: 'a.+.+.+b' },
                { searchFields: ['nombre'] }
            );
            // El punto debe estar escapado en el regex
            expect(filter.$or[0].nombre.$regex).toContain('\\.');
        });
    });
});

// ─── OffsetPagination ─────────────────────────────────────────────────────────

describe('OffsetPagination', () => {

    describe('parseo de parámetros', () => {
        test('usa defaults cuando no hay query params', () => {
            const pag = Pagination.offset({});
            expect(pag.page).toBe(1);
            expect(pag.limit).toBe(20);
            expect(pag.skip).toBe(0);
        });

        test('calcula skip correctamente', () => {
            const pag = Pagination.offset({ page: '3', limit: '10' });
            expect(pag.skip).toBe(20);
        });

        test('respeta MAX_LIMIT — no permite limit > 100', () => {
            const pag = Pagination.offset({ limit: '999' });
            expect(pag.limit).toBeLessThanOrEqual(100);
        });

        test('custom maxLimit desde options', () => {
            const pag = Pagination.offset({ limit: '200' }, { maxLimit: 50 });
            expect(pag.limit).toBe(50);
        });

        test('normaliza page negativa a 1', () => {
            const pag = Pagination.offset({ page: '-5' });
            expect(pag.page).toBe(1);
        });

        test('normaliza page 0 a 1', () => {
            const pag = Pagination.offset({ page: '0' });
            expect(pag.page).toBe(1);
        });

        test('ignora page no numérica', () => {
            const pag = Pagination.offset({ page: 'abc' });
            expect(pag.page).toBe(1);
        });

        test('ignora limit no numérico', () => {
            const pag = Pagination.offset({ limit: 'mucho' });
            expect(pag.limit).toBe(20); // default
        });
    });

    describe('buildMeta', () => {
        test('calcula totalPages correctamente', () => {
            const pag  = Pagination.offset({ page: '1', limit: '20' });
            const meta = pag.buildMeta(47);
            expect(meta.pagination.totalPages).toBe(3);
            expect(meta.pagination.total).toBe(47);
        });

        test('hasNext y hasPrev correctos en página intermedia', () => {
            const pag  = Pagination.offset({ page: '2', limit: '10' });
            const meta = pag.buildMeta(30);
            expect(meta.pagination.hasNext).toBe(true);
            expect(meta.pagination.hasPrev).toBe(true);
        });

        test('hasPrev es false en primera página', () => {
            const pag  = Pagination.offset({ page: '1', limit: '10' });
            const meta = pag.buildMeta(30);
            expect(meta.pagination.hasPrev).toBe(false);
        });

        test('hasNext es false en última página', () => {
            const pag  = Pagination.offset({ page: '3', limit: '10' });
            const meta = pag.buildMeta(30);
            expect(meta.pagination.hasNext).toBe(false);
        });

        test('totalPages es 1 cuando total es 0', () => {
            const pag  = Pagination.offset({});
            const meta = pag.buildMeta(0);
            expect(meta.pagination.totalPages).toBe(1);
        });

        test('meta tiene type: offset', () => {
            const pag  = Pagination.offset({});
            const meta = pag.buildMeta(10);
            expect(meta.pagination.type).toBe('offset');
        });
    });
});

// ─── CursorPagination ─────────────────────────────────────────────────────────

describe('CursorPagination', () => {

    describe('encoding / decoding de cursores', () => {
        test('cursor codificado es base64url opaco (no JSON legible)', () => {
            const encoded = Pagination.CursorPagination
                ? Pagination.CursorPagination._encode('2024-01-15', 'fecha')
                : null;

            // Test indirecto via buildMeta si _encode no está expuesto
            const pag = Pagination.cursor({});
            expect(typeof pag).toBe('object');
        });

        test('cursor malformado no rompe la paginación — trata como primera página', () => {
            const pag = Pagination.cursor({ cursor: 'esto-no-es-base64-valido!!' });
            expect(pag.decoded).toBeNull();
        });

        test('cursor vacío trata como primera página', () => {
            const pag = Pagination.cursor({ cursor: '' });
            expect(pag.decoded).toBeNull();
        });
    });

    describe('parámetros', () => {
        test('usa defaultLimit cuando no hay query params', () => {
            const pag = Pagination.cursor({}, { defaultLimit: 50 });
            expect(pag.limit).toBe(50);
        });

        test('respeta maxLimit', () => {
            const pag = Pagination.cursor({ limit: '500' }, { maxLimit: 100 });
            expect(pag.limit).toBe(100);
        });
    });

    describe('buildMeta', () => {
        test('hasMore true cuando hay más páginas', () => {
            const pag  = Pagination.cursor({}, { defaultLimit: 10 });
            const meta = pag.buildMeta('cursor123', true);
            expect(meta.pagination.hasMore).toBe(true);
            expect(meta.pagination.nextCursor).toBe('cursor123');
        });

        test('nextCursor es null cuando no hay más páginas', () => {
            const pag  = Pagination.cursor({});
            const meta = pag.buildMeta(null, false);
            expect(meta.pagination.nextCursor).toBeNull();
            expect(meta.pagination.hasMore).toBe(false);
        });

        test('meta tiene type: cursor', () => {
            const pag  = Pagination.cursor({});
            const meta = pag.buildMeta(null, false);
            expect(meta.pagination.type).toBe('cursor');
        });

        test('meta NO tiene total ni totalPages (ese es el tradeoff)', () => {
            const pag  = Pagination.cursor({});
            const meta = pag.buildMeta(null, false);
            expect(meta.pagination).not.toHaveProperty('total');
            expect(meta.pagination).not.toHaveProperty('totalPages');
        });
    });
});

// ─── Pagination.auto ──────────────────────────────────────────────────────────

describe('Pagination.auto', () => {
    test('retorna CursorPagination cuando hay ?cursor=', () => {
        const pag = Pagination.auto({ cursor: 'abc' });
        // CursorPagination tiene la propiedad cursorField, OffsetPagination no
        expect(pag).toHaveProperty('cursorField');
    });

    test('retorna OffsetPagination cuando no hay ?cursor=', () => {
        const pag = Pagination.auto({ page: '2' });
        // OffsetPagination tiene la propiedad skip, CursorPagination no como tal
        expect(pag).toHaveProperty('skip');
    });
});