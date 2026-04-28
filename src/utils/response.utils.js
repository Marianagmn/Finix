/**
 * @file response.utils.js
 * @description Respuestas HTTP estandarizadas con contrato fijo e irrompible.
 *
 * POR QUÉ IMPORTA UN CONTRATO FIJO:
 *  Sin esto pasa esto en producción:
 *    GET /users      → { data: [], total: 10 }
 *    GET /products   → { items: [], count: 10 }
 *    GET /orders     → { result: { list: [] }, meta: { n: 10 } }
 *  El frontend necesita código diferente para cada endpoint.
 *  Los dashboards de BI no pueden parsear automáticamente.
 *  Los tests no saben qué shape esperar.
 *
 * CONTRATO ÚNICO (todos los endpoints responden igual):
 *
 *  Éxito:
 *  {
 *    "success": true,
 *    "data": <any>,
 *    "meta": { "pagination": {...}, "timestamp": "...", "requestId": "..." },
 *    "message": "opcional"
 *  }
 *
 *  Error (manejado por error.middleware.js):
 *  {
 *    "success": false,
 *    "code": "NOT_FOUND",
 *    "message": "Recurso no encontrado",
 *    "meta": { "timestamp": "...", "requestId": "..." }
 *  }
 *
 * El campo "meta" siempre existe — nunca null. Esto permite que el cliente
 * acceda a meta.pagination sin verificar si meta existe.
 *
 * INTEGRACIÓN CON requestId:
 *  Si usas un middleware de correlación de requests (recomendado), pasa
 *  req.id a ApiResponse y aparece en TODAS las respuestas — invaluable
 *  para trazar errores en logs.
 *
 *  app.use((req, res, next) => {
 *      req.id = crypto.randomUUID();
 *      res.setHeader('X-Request-Id', req.id);
 *      next();
 *  });
 */

'use strict';

// ─── Shape base ───────────────────────────────────────────────────────────────

/**
 * Construye el shape base de TODA respuesta exitosa.
 * Garantiza que el contrato nunca varíe entre endpoints.
 *
 * @param {object} options
 * @returns {object}
 */
function _buildShape({ data, message, meta, requestId }) {
    return {
        success:   true,
        data:      data !== undefined ? data : null,
        meta:      _buildMeta(meta, requestId),
        ...(message ? { message } : {}),
    };
}

/**
 * Construye el objeto meta siempre presente.
 * Nunca retorna null — garantiza que meta.pagination sea accesible.
 *
 * @param {object} [extra]      - Datos adicionales (pagination, etc.)
 * @param {string} [requestId]  - Correlation ID del request.
 * @returns {object}
 */
function _buildMeta(extra = {}, requestId = null) {
    return {
        timestamp: new Date().toISOString(),
        ...(requestId ? { requestId } : {}),
        ...extra,
    };
}

// ─── ApiResponse ──────────────────────────────────────────────────────────────

class ApiResponse {

    /**
     * 200 OK — respuesta exitosa estándar.
     *
     * @param {Response} res
     * @param {*}        data
     * @param {object}   [options]
     * @param {number}   [options.statusCode=200]
     * @param {string}   [options.message]
     * @param {object}   [options.meta]       - Datos extra para el campo meta.
     * @param {string}   [options.requestId]  - Correlation ID.
     */
    static success(res, data, { statusCode = 200, message, meta, requestId } = {}) {
        return res.status(statusCode).json(
            _buildShape({ data, message, meta, requestId })
        );
    }

    /**
     * 201 Created — para recursos recién creados.
     *
     * @param {Response} res
     * @param {*}        data
     * @param {string}   [message]
     * @param {string}   [requestId]
     */
    static created(res, data, message = 'Recurso creado exitosamente', requestId) {
        return res.status(201).json(
            _buildShape({ data, message, requestId })
        );
    }

    /**
     * 204 No Content — para DELETE y acciones sin cuerpo de respuesta.
     * Nota: 204 no puede tener body por spec HTTP.
     *
     * @param {Response} res
     */
    static noContent(res) {
        return res.status(204).send();
    }

    /**
     * Respuesta paginada — offset pagination.
     * Incluye meta.pagination con info completa para UI y BI.
     *
     * @param {Response} res
     * @param {Array}    items
     * @param {object}   paginationMeta  - Resultado de OffsetPagination.buildMeta(total)
     * @param {object}   [options]
     * @param {string}   [options.message]
     * @param {string}   [options.requestId]
     * @param {object}   [options.extra]   - Meta extra (totales de negocio, etc.)
     */
    static paginated(res, items, paginationMeta, { message, requestId, extra } = {}) {
        return res.status(200).json(
            _buildShape({
                data:    items,
                message,
                requestId,
                meta: {
                    ...paginationMeta,
                    ...extra,
                },
            })
        );
    }

    /**
     * Respuesta con cursor pagination.
     * Para feeds y listados de alto tráfico sin countDocuments.
     *
     * @param {Response} res
     * @param {Array}    items
     * @param {object}   cursorMeta    - Resultado de CursorPagination.buildMeta(nextCursor, hasMore)
     * @param {object}   [options]
     */
    static cursor(res, items, cursorMeta, { message, requestId, extra } = {}) {
        return res.status(200).json(
            _buildShape({
                data: items,
                message,
                requestId,
                meta: {
                    ...cursorMeta,
                    ...extra,
                },
            })
        );
    }

    /**
     * Respuesta de error operacional.
     * Normalmente manejado por error.middleware.js, pero disponible
     * para casos donde se quiere responder con error sin throw.
     *
     * @param {Response} res
     * @param {string}   message
     * @param {number}   [statusCode=400]
     * @param {string}   [code='ERROR']
     * @param {string}   [requestId]
     */
    static error(res, message, { statusCode = 400, code = 'ERROR', requestId } = {}) {
        return res.status(statusCode).json({
            success: false,
            code,
            message,
            meta: _buildMeta({}, requestId),
        });
    }

    /**
     * Helper para extraer el requestId del request de forma segura.
     * Usar en controllers: ApiResponse.requestId(req)
     *
     * @param {Request} req
     * @returns {string|undefined}
     */
    static requestId(req) {
        return req?.id || req?.headers?.['x-request-id'] || undefined;
    }
}

module.exports = ApiResponse;

// ─── EJEMPLOS DE USO EN CONTROLLERS ──────────────────────────────────────────
//
// ── Básico ────────────────────────────────────────────────────────────────────
//
//  ApiResponse.success(res, user);
//  ApiResponse.success(res, user, { message: 'Perfil actualizado' });
//  ApiResponse.created(res, txn, 'Transacción creada');
//  ApiResponse.noContent(res);
//
// ── Con requestId (trazabilidad) ──────────────────────────────────────────────
//
//  ApiResponse.success(res, user, {
//      message:   'OK',
//      requestId: ApiResponse.requestId(req),
//  });
//
// ── Paginado (offset) ─────────────────────────────────────────────────────────
//
//  // En el service:
//  const pag = Pagination.offset(req.query, { allowedSortFields: ['fecha', 'monto'] });
//  const [items, total] = await Promise.all([
//      pag.applyTo(BusinessFinance.find(filter)),
//      BusinessFinance.countDocuments(filter),
//  ]);
//  const paginationMeta = pag.buildMeta(total);
//
//  // En el controller:
//  ApiResponse.paginated(res, items, paginationMeta, {
//      requestId: ApiResponse.requestId(req),
//      extra: { totalEnCOP: sumTotal },  // Datos de negocio en meta
//  });
//
//  // Shape resultante:
//  // {
//  //   "success": true,
//  //   "data": [...],
//  //   "meta": {
//  //     "pagination": { "type": "offset", "page": 1, "limit": 20, "total": 150, ... },
//  //     "totalEnCOP": 4500000,
//  //     "timestamp": "2024-01-15T10:30:00.000Z",
//  //     "requestId": "a1b2c3d4"
//  //   }
//  // }
//
// ── Cursor (feed) ─────────────────────────────────────────────────────────────
//
//  const pag = Pagination.cursor(req.query, { cursorField: 'fecha' });
//  const { items, nextCursor, hasMore } = await pag.applyTo(Model.find(filter));
//
//  ApiResponse.cursor(res, items, pag.buildMeta(nextCursor, hasMore), {
//      requestId: ApiResponse.requestId(req),
//  });
//
//  // Shape resultante:
//  // {
//  //   "success": true,
//  //   "data": [...],
//  //   "meta": {
//  //     "pagination": { "type": "cursor", "limit": 50, "hasMore": true, "nextCursor": "eyJ2..." },
//  //     "timestamp": "..."
//  //   }
//  // }