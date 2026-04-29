/**
 * @file softDelete.plugin.js
 * @description Plugin Mongoose reutilizable para soft-delete.
 * Añade campos isDeleted y deletedAt, métodos softDelete/restore,
 * y filtra automáticamente documentos eliminados en queries.
 *
 * Uso:
 *   const softDeletePlugin = require('./plugins/softDelete.plugin');
 *   mySchema.plugin(softDeletePlugin, { deletedBy: true, index: true });
 */

'use strict';

/**
 * @param {Schema} schema - Mongoose schema
 * @param {object} options - Opciones de configuración
 * @param {boolean} options.deletedBy - Incluir campo deletedBy (default: true)
 * @param {boolean} options.index - Crear índices (default: true)
 * @param {string} options.deletedByRef - Modelo de referencia para deletedBy (default: 'User')
 */
function softDeletePlugin(schema, options = {}) {
    const { deletedBy = true, index = true, deletedByRef = 'User' } = options;

    // ─── Añadir campos al schema ───────────────────────────────────────────────

    schema.add({
        isDeleted: {
            type: Boolean,
            default: false,
            index: index ? { sparse: true } : false
        },
        deletedAt: {
            type: Date,
            default: null
        }
    });

    if (deletedBy) {
        schema.add({
            deletedBy: {
                type: schema.constructor.Types.ObjectId,
                ref: deletedByRef,
                default: null
            }
        });
    }

    // ─── Índices ───────────────────────────────────────────────────────────────

    if (index) {
        schema.index({ isDeleted: 1, deletedAt: 1 }, { sparse: true });
    }

    // ─── Métodos de instancia ──────────────────────────────────────────────────

    /**
     * Marca el documento como eliminado (soft-delete).
     * @param {string} userId - ID del usuario que elimina (opcional)
     * @returns {Promise<Document>}
     */
    schema.methods.softDelete = async function(userId = null) {
        this.isDeleted = true;
        this.deletedAt = new Date();
        if (deletedBy && userId) {
            this.deletedBy = userId;
        }
        return this.save();
    };

    /**
     * Restaura un documento eliminado.
     * @returns {Promise<Document>}
     */
    schema.methods.restore = async function() {
        this.isDeleted = false;
        this.deletedAt = null;
        if (deletedBy) {
            this.deletedBy = null;
        }
        return this.save();
    };

    // ─── Métodos estáticos ─────────────────────────────────────────────────────

    /**
     * Soft-delete por ID.
     * @param {string} id - Document ID
     * @param {string} userId - User ID (opcional)
     * @returns {Promise<Document|null>}
     */
    schema.statics.softDeleteById = async function(id, userId = null) {
        const doc = await this.findById(id);
        if (!doc || doc.isDeleted) return null;
        return doc.softDelete(userId);
    };

    /**
     * Restaurar por ID.
     * @param {string} id - Document ID
     * @returns {Promise<Document|null>}
     */
    schema.statics.restoreById = async function(id) {
        const doc = await this.findById(id);
        if (!doc || !doc.isDeleted) return null;
        return doc.restore();
    };

    // ─── Query middleware (hooks) ──────────────────────────────────────────────

    // Filtrar documentos eliminados por defecto
    schema.pre(/^find/, function(next) {
        // Si no se ha especificado explícitamente isDeleted, filtrarlo
        if (this.getQuery().isDeleted === undefined) {
            this.where({ isDeleted: { $ne: true } });
        }
        next();
    });

    // Asegurar que countDocuments también filtre
    schema.pre('countDocuments', function(next) {
        if (this.getQuery().isDeleted === undefined) {
            this.where({ isDeleted: { $ne: true } });
        }
        next();
    });
}

module.exports = softDeletePlugin;
