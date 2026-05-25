/**
 * Category Model
 * Transaction classification system per user
 * Enforces unique category names per user for consistent reporting
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
// Partial index: only applies to non-deleted records to allow recreation after soft-delete
categorySchema.index({ userId: 1, nombre: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

// ─── Plugin (C-02 FIX) ────────────────────────────────────────────────────────
categorySchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Category', categorySchema);