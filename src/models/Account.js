/**
 * Account Model
 * Represents a financial account (wallet, bank, credit, investment)
 * Supports multi-currency balances with automatic decimal handling
 * El plugin añade: isDeleted, deletedAt, deletedBy, softDelete(),
 * pre-find y pre-aggregate hooks de forma consistente con todos los modelos.
 *
 * @module models/Account
 */

'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const softDeletePlugin = require('../plugins/softDelete.plugin');

const accountSchema = new Schema({
    // Reference to account owner
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    nombre: {
        type: String,
        required: true,
        trim: true
    },

    tipo: {
        type: String,
        enum: ['efectivo', 'ahorro', 'corriente', 'credito', 'inversion'],
        required: true,
        index: true
    },

    moneda: {
        type: String,
        enum: ['COP', 'USD', 'EUR'],
        default: 'COP'
    },

    // Account balance stored in cents (integer) for precision
    // Getter/setter handle automatic conversion to/from decimal
    balance: {
        type: Number,
        default: 0,
        set: v => Math.round(v * 100),
        get: v => v / 100
    },

    isActive: {
        type: Boolean,
        default: true
    }

}, {
    timestamps: true,
    toJSON:   { getters: true },
    toObject: { getters: true }
});

// ─── Indexes ─────────────────────────────────────────────────────────────────

accountSchema.index({ userId: 1, nombre: 1 });
accountSchema.index({ userId: 1, tipo: 1 });
accountSchema.index({ userId: 1, isActive: 1 });
accountSchema.index({ userId: 1, tipo: 1, isActive: 1 });

// ─── Plugin (C-02 FIX) ────────────────────────────────────────────────────────
// Agrega: isDeleted, deletedAt, deletedBy, softDelete() y todos los query hooks
accountSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Account', accountSchema);