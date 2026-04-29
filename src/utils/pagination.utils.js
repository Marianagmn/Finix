/**
 * @file pagination.utils.js
 * @description Paginación de nivel producción para sistemas financieros de alto tráfico.
 *
 * CAPACIDADES:
 *  ① Offset pagination  — para listados normales con salto de página
 *  ② Cursor pagination  — para feeds en tiempo real y alto tráfico (sin countDocuments)
 *  ③ Multi-field sort   — ?sort=name:asc,createdAt:desc
 *  ④ Dynamic filters    — ?status=active&tipo=gasto&monto_gte=1000
 *  ⑤ Mongoose builder  — .applyTo(query) en lugar de .skip().limit().sort() manual
 *
 * ─── CUÁNDO USAR CADA MODO ────────────────────────────────────────────────────
 *
 *  Offset  → Tablas con paginación numérica (página 1, 2, 3…)
 *            Reportes donde importa el total exacto
 *            Máx recomendado: ~50k documentos (skip se vuelve lento después)
 *
 *  Cursor  → Feeds / timelines que se actualizan en tiempo real
 *            Exportaciones masivas (iterar millones de docs sin saltar)
 *            Infinite scroll en mobile
 *            No tiene "ir a página X" pero es O(log n) en lugar de O(n)
 *
 * ─── EJEMPLOS DE USO ─────────────────────────────────────────────────────────
 *
 *  // Offset (service):
 *  const { mongooseQuery, meta } = await Pagination
 *      .offset(req.query, { defaultLimit: 20, maxLimit: 100 })
 *      .applyTo(BusinessFinance.find(filter));
 *  const [items, total] = await Promise.all([mongooseQuery, BusinessFinance.countDocuments(filter)]);
 *  meta.total = total;
 *
 *  // Cursor (service):
 *  const result = await Pagination
 *      .cursor(req.query, { cursorField: 'fecha', defaultLimit: 50 })
 *      .applyTo(BusinessFinance.find(filter));
 *  // result = { items, nextCursor, hasMore }
 *
 *  // Filtros dinámicos:
 *  const filter = FilterParser.parse(req.query, {
 *      allowed: ['estado', 'tipo', 'terceroId'],
 *      ranges:  ['monto', 'fecha'],
 *  });
 */

'use strict';

const mongoose     = require('mongoose');
const { AppError } = require('../middlewares/error.middleware');

// ─── Constantes globales ──────────────────────────────────────────────────────

const DEFAULTS = {
    PAGE:          1,
    LIMIT:         20,
    MAX_LIMIT:     100,
    CURSOR_LIMIT:  50,
    MAX_SORT_FIELDS: 3,     // Más de 3 sort fields en Mongo es raro y costoso
};

// ─── SortParser ───────────────────────────────────────────────────────────────

/**
 * Parsea múltiples campos de sort desde el query string.
 *
 * Formatos soportados:
 *   ?sort=-fecha                        → { fecha: -1 }  (legacy, compatible)
 *   ?sort=fecha:desc                    → { fecha: -1 }
 *   ?sort=name:asc,createdAt:desc       → { name: 1, createdAt: -1 }
 *   ?sort=monto:desc,fecha:desc,tipo:asc → hasta MAX_SORT_FIELDS campos
 */
class SortParser {

    /**
     * @param {string|string[]} sortParam    - req.query.sort
     * @param {string[]}        allowedFields - Whitelist de campos permitidos
     * @param {string}          defaultSort   - Ej: '-fecha' o 'fecha:desc'
     * @returns {object} Objeto sort para Mongoose { campo: 1|-1 }
     */
    static parse(sortParam, allowedFields = [], defaultSort = '-createdAt') {
        const raw = sortParam || defaultSort;

        // Normalizar a array de tokens
        const tokens = Array.isArray(raw) ? raw : raw.split(',');

        const sortObj = {};
        let count = 0;

        for (const token of tokens) {
            if (count >= DEFAULTS.MAX_SORT_FIELDS) break;

            const { field, direction } = SortParser._parseToken(token.trim());

            // Whitelist — campo no permitido se ignora silenciosamente (no error)
            if (allowedFields.length && !allowedFields.includes(field)) continue;

            // Prevenir injection: solo chars alfanuméricos y punto (para nested)
            if (!/^[a-zA-Z0-9_.]+$/.test(field)) continue;

            sortObj[field] = direction;
            count++;
        }

        // Si nada fue válido, usar default
        if (Object.keys(sortObj).length === 0) {
            return SortParser._parseDefault(defaultSort);
        }

        return sortObj;
    }

    /** Parsea un token individual: 'fecha:desc', '-fecha', 'fecha' */
    static _parseToken(token) {
        // Formato legacy: -fecha
        if (token.startsWith('-')) {
            return { field: token.slice(1), direction: -1 };
        }
        // Formato nuevo: fecha:desc o fecha:asc
        const [field, dir] = token.split(':');
        const direction = (dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
        return { field, direction };
    }

    static _parseDefault(defaultSort) {
        const { field, direction } = SortParser._parseToken(defaultSort.trim());
        return { [field]: direction };
    }
}

// ─── FilterParser ─────────────────────────────────────────────────────────────

/**
 * Construye un filtro Mongoose desde req.query de forma segura.
 *
 * Soporta:
 *   Exacto:    ?estado=activo           → { estado: 'activo' }
 *   Rango:     ?monto_gte=1000          → { monto: { $gte: 1000 } }
 *              ?fecha_gte=2024-01-01&fecha_lte=2024-12-31
 *   Búsqueda:  ?search=juan             → { $or: [{ name: /juan/i }, ...] }
 *   ObjectId:  ?terceroId=abc123        → { terceroId: ObjectId('abc123') }
 *   Boolean:   ?isActive=true           → { isActive: true }
 *   Array:     ?tipo=gasto,ingreso      → { tipo: { $in: ['gasto','ingreso'] } }
 */
class FilterParser {

    /**
     * @param {object} query    - req.query completo
     * @param {object} options
     * @param {string[]} options.allowed      - Campos permitidos para filtro exacto
     * @param {string[]} options.ranges       - Campos que admiten _gte/_lte/_gt/_lt
     * @param {string[]} options.objectIds    - Campos que deben convertirse a ObjectId
     * @param {string[]} options.booleans     - Campos que deben convertirse a boolean
     * @param {string[]} options.arrays       - Campos que admiten lista separada por comas
     * @param {string[]} options.searchFields - Campos donde aplica ?search=
     * @returns {object} Filtro Mongoose listo para usar en .find()
     */
    static parse(query = {}, options = {}) {
        const {
            allowed      = [],
            ranges       = [],
            objectIds    = [],
            booleans     = [],
            arrays       = [],
            searchFields = [],
        } = options;

        const filter = {};

        // ── Campos exactos ────────────────────────────────────────────────────
        for (const field of allowed) {
            const val = query[field];
            if (val === undefined || val === '') continue;

            if (booleans.includes(field)) {
                filter[field] = val === 'true' || val === true;
                continue;
            }

            if (objectIds.includes(field)) {
                if (!mongoose.isValidObjectId(val)) continue; // Ignorar IDs inválidos
                filter[field] = new mongoose.Types.ObjectId(val);
                continue;
            }

            if (arrays.includes(field)) {
                const values = val.split(',').map(v => v.trim()).filter(Boolean);
                if (values.length > 0) filter[field] = { $in: values };
                continue;
            }

            filter[field] = val;
        }

        // ── Rangos (_gte, _lte, _gt, _lt) ────────────────────────────────────
        for (const field of ranges) {
            const rangeFilter = {};
            const ops = { gte: '$gte', lte: '$lte', gt: '$gt', lt: '$lt' };

            for (const [suffix, mongoOp] of Object.entries(ops)) {
                const val = query[`${field}_${suffix}`];
                if (val === undefined || val === '') continue;

                // Intentar parsear como número, si falla intentar como fecha
                const parsed = FilterParser._parseValue(val);
                if (parsed !== null) rangeFilter[mongoOp] = parsed;
            }

            if (Object.keys(rangeFilter).length > 0) {
                filter[field] = rangeFilter;
            }
        }

        // ── Búsqueda de texto (regex case-insensitive) ────────────────────────
        if (query.search && searchFields.length > 0) {
            const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = searchFields.map(f => ({
                [f]: { $regex: escaped, $options: 'i' },
            }));
        }

        return filter;
    }

    /** Intenta parsear string a número o Date. Retorna null si no es posible. */
    static _parseValue(val) {
        // Número
        const num = Number(val);
        if (!isNaN(num) && val.trim() !== '') return num;

        // Fecha ISO
        const date = new Date(val);
        if (!isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}/.test(val)) return date;

        return null;
    }
}

// ─── OffsetPagination ─────────────────────────────────────────────────────────

/**
 * Paginación offset clásica.
 * Buena para tablas y reportes. Degradación de performance en páginas muy altas.
 */
class OffsetPagination {

    /**
     * @param {object} query    - req.query
     * @param {object} options
     * @param {number} options.defaultLimit
     * @param {number} options.maxLimit
     * @param {string[]} options.allowedSortFields
     * @param {string}   options.defaultSort
     */
    constructor(query = {}, options = {}) {
        const {
            defaultLimit     = DEFAULTS.LIMIT,
            maxLimit         = DEFAULTS.MAX_LIMIT,
            allowedSortFields = [],
            defaultSort      = '-createdAt',
        } = options;

        this.page  = Math.max(1, parseInt(query.page, 10) || DEFAULTS.PAGE);
        this.limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
        this.skip  = (this.page - 1) * this.limit;
        this.sort  = SortParser.parse(query.sort, allowedSortFields, defaultSort);
    }

    /**
     * Aplica skip, limit y sort a un Mongoose Query existente.
     * No ejecuta la query — solo la configura.
     *
     * @param {Query} mongooseQuery - Ej: Model.find(filter)
     * @returns {Query} La misma query con skip/limit/sort aplicados.
     */
    applyTo(mongooseQuery) {
        return mongooseQuery.skip(this.skip).limit(this.limit).sort(this.sort);
    }

    /**
     * Construye el objeto meta para ApiResponse.paginated().
     * Llamar DESPUÉS de tener el total de countDocuments.
     *
     * @param {number} total
     * @returns {object}
     */
    buildMeta(total) {
        const totalPages = Math.ceil(total / this.limit) || 1;
        return {
            pagination: {
                type:       'offset',
                page:       this.page,
                limit:      this.limit,
                total,
                totalPages,
                hasNext:    this.page < totalPages,
                hasPrev:    this.page > 1,
                nextPage:   this.page < totalPages ? this.page + 1 : null,
                prevPage:   this.page > 1           ? this.page - 1 : null,
            },
        };
    }
}

// ─── CursorPagination ─────────────────────────────────────────────────────────

/**
 * Paginación por cursor — O(log n), ideal para alto tráfico.
 *
 * Cómo funciona:
 *  1. Primera llamada: GET /transactions?limit=50
 *     Responde con items + nextCursor (opaque string, base64 del último ID+campo)
 *  2. Siguiente página: GET /transactions?cursor=<nextCursor>&limit=50
 *     El cursor indica "dame los docs DESPUÉS de este punto"
 *  3. Cuando hasMore=false, no hay más páginas.
 *
 * Ventajas sobre offset:
 *  - No se "saltan" docs si hay inserciones concurrentes
 *  - Performance constante sin importar qué página se pide
 *  - Sin countDocuments (costoso en colecciones grandes)
 *
 * Limitación:
 *  - No se puede saltar a "página 47" — solo siguiente/anterior
 */
class CursorPagination {

    /**
     * @param {object} query
     * @param {object} options
     * @param {string} options.cursorField   - Campo por el que se pagina (ej: 'fecha', '_id')
     * @param {number} options.defaultLimit
     * @param {number} options.maxLimit
     * @param {'asc'|'desc'} options.direction
     */
    constructor(query = {}, options = {}) {
        const {
            cursorField  = '_id',
            defaultLimit = DEFAULTS.CURSOR_LIMIT,
            maxLimit     = DEFAULTS.MAX_LIMIT,
            direction    = 'desc',
        } = options;

        this.cursorField = cursorField;
        this.limit       = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
        this.direction   = direction;
        this.rawCursor   = query.cursor || null;
        this.decoded     = this.rawCursor ? CursorPagination._decode(this.rawCursor) : null;
    }

    /**
     * Aplica el cursor como filtro adicional a la query y configura limit+sort.
     * Pide limit+1 docs para saber si hay más sin un countDocuments extra.
     *
     * @param {Query} mongooseQuery
     * @returns {Promise<{ items: object[], nextCursor: string|null, hasMore: boolean }>}
     */
    async applyTo(mongooseQuery) {
        const isDesc = this.direction === 'desc';
        const op     = isDesc ? '$lt' : '$gt';
        const sort   = { [this.cursorField]: isDesc ? -1 : 1 };

        if (this.decoded) {
            mongooseQuery = mongooseQuery.where({
                [this.cursorField]: { [op]: this.decoded.value },
            });
        }

        // Pedir uno extra para detectar si hay más sin countDocuments
        const raw = await mongooseQuery
            .sort(sort)
            .limit(this.limit + 1)
            .lean();

        const hasMore = raw.length > this.limit;
        const items   = hasMore ? raw.slice(0, this.limit) : raw;

        const lastItem  = items[items.length - 1];
        const nextCursor = hasMore && lastItem
            ? CursorPagination._encode(lastItem[this.cursorField], this.cursorField)
            : null;

        return { items, nextCursor, hasMore };
    }

    /**
     * Construye el objeto meta para ApiResponse.
     */
    buildMeta(nextCursor, hasMore) {
        return {
            pagination: {
                type:       'cursor',
                limit:      this.limit,
                hasMore,
                nextCursor,
                // Nota: no hay total ni totalPages — ese es el tradeoff del cursor
            },
        };
    }

    /** Codifica cursor a base64 opaco para el cliente. */
    static _encode(value, field) {
        const payload = JSON.stringify({ value, field, v: 1 });
        return Buffer.from(payload).toString('base64url');
    }

    /** Decodifica cursor desde base64. Retorna null si es inválido. */
    static _decode(cursor) {
        try {
            const payload = Buffer.from(cursor, 'base64url').toString('utf8');
            const parsed  = JSON.parse(payload);
            if (!parsed.value || !parsed.field) return null;
            return parsed;
        } catch {
            return null; // Cursor malformado — tratar como primera página
        }
    }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Factory principal — elige el modo según el query string.
 *
 * Si viene ?cursor=... → CursorPagination
 * Si viene ?page=...   → OffsetPagination
 * Default              → OffsetPagination
 */
const Pagination = {

    /**
     * Crea una instancia de OffsetPagination.
     * @param {object} query
     * @param {object} options
     * @returns {OffsetPagination}
     */
    offset(query, options = {}) {
        return new OffsetPagination(query, options);
    },

    /**
     * Crea una instancia de CursorPagination.
     * @param {object} query
     * @param {object} options
     * @returns {CursorPagination}
     */
    cursor(query, options = {}) {
        return new CursorPagination(query, options);
    },

    /**
     * Auto-selecciona el modo según el query string.
     * Si ?cursor= está presente → cursor. Si no → offset.
     *
     * @param {object} query
     * @param {object} options
     * @returns {OffsetPagination|CursorPagination}
     */
    auto(query, options = {}) {
        return query.cursor
            ? new CursorPagination(query, options)
            : new OffsetPagination(query, options);
    },

    // Re-exportar clases para uso avanzado
    SortParser,
    FilterParser,
};

module.exports = Pagination;

// ─── EJEMPLOS DE USO EN SERVICES ─────────────────────────────────────────────
//
// ── Offset básico ─────────────────────────────────────────────────────────────
//
//  const pag = Pagination.offset(req.query, {
//      allowedSortFields: ['fecha', 'monto', 'estado'],
//      defaultSort: '-fecha',
//  });
//
//  const filter = FilterParser.parse(req.query, {
//      allowed:   ['estado', 'tipo', 'moneda'],
//      ranges:    ['monto', 'fecha'],
//      objectIds: ['terceroId', 'categoria'],
//      booleans:  ['esRecurrente', 'esCuentaPorCobrar'],
//      arrays:    ['tipo'],
//      searchFields: ['descripcion', 'numeroDocumento'],
//  });
//
//  const [items, total] = await Promise.all([
//      pag.applyTo(BusinessFinance.find(filter)),
//      BusinessFinance.countDocuments(filter),
//  ]);
//
//  return { items, meta: pag.buildMeta(total) };
//
// ── Cursor (feed en tiempo real) ──────────────────────────────────────────────
//
//  const pag = Pagination.cursor(req.query, {
//      cursorField: 'fecha',
//      defaultLimit: 50,
//  });
//
//  const { items, nextCursor, hasMore } = await pag.applyTo(
//      BusinessFinance.find({ businessId }).select('monto tipo fecha descripcion')
//  );
//
//  return { items, meta: pag.buildMeta(nextCursor, hasMore) };
//
// ── Multi-sort directo ────────────────────────────────────────────────────────
//
//  // ?sort=estado:asc,fecha:desc,monto:desc
//  const sort = SortParser.parse(req.query.sort, ['estado', 'fecha', 'monto'], '-fecha');
//  // → { estado: 1, fecha: -1, monto: -1 }