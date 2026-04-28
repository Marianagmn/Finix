/**
 * Category Model
 * Transaction classification system per user
 * Enforces unique category names per user for consistent reporting
 *
 * FIX [C-02]: Aplicado softDelete.plugin en lugar de implementación manual.
 *
 * @module models/Category
 */

'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const softDeletePlugin = require('../plugins/softDelete.plugin');

const categorySchema = new Schema({
    // Reference to category owner (categories are user-specific)
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Category name (normalized to lowercase for consistency)
    nombre: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },

    // Transaction type this category applies to
    tipo: {
        type: String,
        enum: ['ingreso', 'gasto', 'transferencia'],
        required: true,
        index: true
    },

    color: String,
    icono: String,

    // System-generated categories (vs user-created)
    isDefault: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });

// ─── Indexes ─────────────────────────────────────────────────────────────────

// Enforce unique category names per user (case-insensitive via lowercase)
categorySchema.index({ userId: 1, nombre: 1 }, { unique: true });

// ─── Plugin (C-02 FIX) ────────────────────────────────────────────────────────
categorySchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Category', categorySchema);