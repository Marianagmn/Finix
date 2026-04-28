/**
 * Account Model
 * Represents a financial account (wallet, bank, credit, investment)
 * Supports multi-currency balances with automatic decimal handling
 * @module models/Account
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

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
    },

    // Soft delete flag - preserves data integrity for financial records
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },

    deletedAt: {
        type: Date
    }

}, {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true }
});

accountSchema.index({ userId: 1, nombre: 1 });

accountSchema.methods.softDelete = function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
};

accountSchema.pre(/^find/, function(next) {
    this.where({ isDeleted: false });
    next();
});

accountSchema.pre('aggregate', function(next) {
    const pipeline = this.pipeline();
    if (pipeline.length && pipeline[0].$geoNear) {
        pipeline.splice(1, 0, { $match: { isDeleted: false } });
    } else {
        pipeline.unshift({ $match: { isDeleted: false } });
    }
    next();
});

module.exports = mongoose.model('Account', accountSchema);