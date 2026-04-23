/**
 * PersonalFinance Model
 * Enterprise-grade financial transaction management
 * Features: multi-currency, GeoJSON locations, AI metadata, audit trail, soft delete
 * Money handling: stored in cents (integer) with automatic decimal conversion
 * @module models/PersonalFinance
 */
const mongoose = require('mongoose');

const { Schema } = mongoose;

// Transaction type constants
const TIPOS = ['ingreso', 'gasto', 'transferencia'];
// Transaction status constants
const ESTADOS = ['pendiente', 'completado', 'cancelado'];
// Payment method constants (granular for analytics)
const METODOS_PAGO = [
    'efectivo',
    'tarjeta_credito',
    'tarjeta_debito',
    'transferencia_bancaria',
    'wallet'
];
// Supported currencies (expandable)
const MONEDAS = ['COP', 'USD', 'EUR'];

const personalFinanceSchema = new Schema({
    // Transaction owner reference
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    tipo: {
        type: String,
        enum: TIPOS,
        required: true,
        index: true
    },

    // Transaction amount (stored in cents for precision, displayed as decimal)
    monto: {
        type: Number,
        required: true,
        min: [1, 'El monto debe ser mayor a 0'],
        set: v => Math.round(v * 100),  // Convert dollars to cents on save
        get: v => v / 100               // Convert cents to dollars on read
    },

    moneda: {
        type: String,
        enum: MONEDAS,
        default: 'COP'
    },

    // Exchange rate to COP (1 for COP transactions, required for foreign currency)
    tasaCambio: {
        type: Number,
        default: 1
    },

    // Category classification (references Category model)
    categoria: {
        type: Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
        index: true
    },

    // Source account (required for gastos and transferencias)
    cuentaOrigenId: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: function() {
            return this.tipo === 'gasto';
        }
    },

    // Destination account (required for ingresos and transferencias)
    cuentaDestinoId: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: function() {
            return this.tipo === 'ingreso' || this.tipo === 'transferencia';
        }
    },

    metodoPago: {
        type: String,
        enum: METODOS_PAGO,
        default: 'efectivo'
    },

    descripcion: {
        type: String,
        trim: true,
        maxlength: 200
    },

    fecha: {
        type: Date,
        default: () => new Date(),
        index: true
    },

    estado: {
        type: String,
        enum: ESTADOS,
        default: 'completado',
        index: true
    },

    esAhorro: {
        type: Boolean,
        default: false
    },

    tags: [{
        type: String,
        lowercase: true,
        trim: true
    }],

    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            required: false,
            validate: {
                validator: function(v) {
                    if (!v) return true;
                    return v.length === 2 &&
                        v[0] >= -180 && v[0] <= 180 &&
                        v[1] >= -90 && v[1] <= 90;
                },
                message: 'Coordenadas invalidas'
            }
        },
        address: String
    },

    // Internal transfer flag (excluded from balance calculations to avoid double-counting)
    esTransferenciaInterna: {
        type: Boolean,
        default: false
    },

    transferenciaId: {
        type: Schema.Types.ObjectId,
        ref: 'PersonalFinance'
    },

    source: {
        type: String,
        enum: ['manual', 'ia', 'importado'],
        default: 'manual'
    },

    // AI-generated insights and predictions
    aiMetadata: {
        clasificacion: {
            categoriaSugerida: String,   // ML-suggested category
            confianza: Number            // 0-1 confidence score
        },
        analisis: {
            patronDetectado: String,     // Recurring pattern identifier
            alerta: String               // Anomaly detection alerts
        },
        predicciones: {
            gastoMensual: Number         // Forecasted monthly spend
        }
    },

    // Audit trail - tracks all field modifications (auto-limited to 50 entries)
    historialCambios: [{
        campo: String,
        valorAnterior: Schema.Types.Mixed,
        valorNuevo: Schema.Types.Mixed,
        modificadoPor: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        fecha: { type: Date, default: Date.now }
    }],

    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },

    updatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },

    // Soft delete flag - financial records must never be truly deleted
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },

    deletedAt: {
        type: Date
    },

    notaTransaccion: {
        type: String
    }

}, {
    timestamps: true,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true }
});

// Optimized compound index for most common query pattern (user + status + date)
personalFinanceSchema.index({ userId: 1, estado: 1, fecha: -1 });
personalFinanceSchema.index({ userId: 1, fecha: -1 });
personalFinanceSchema.index({ userId: 1, tipo: 1, fecha: -1 });
personalFinanceSchema.index({ userId: 1, categoria: 1 });
personalFinanceSchema.index({ userId: 1, estado: 1 });
// NOTE: Multikey index - use only if filtering by tags is frequent
personalFinanceSchema.index({ location: '2dsphere' });

personalFinanceSchema.statics.toCents = (value) => {
    return Math.round(value * 100);
};

// Synchronous validation - async checks moved to service layer
personalFinanceSchema.pre('validate', function (next) {
    if (this.tipo === 'transferencia' && !this.descripcion) {
        return next(new Error('Las transferencias requieren descripción'));
    }

    if (this.tipo === 'transferencia') {
        if (!this.transferenciaId) {
            return next(new Error('Transferencia debe estar vinculada'));
        }
        if (this.cuentaOrigenId?.toString() === this.cuentaDestinoId?.toString()) {
            return next(new Error('Cuenta origen y destino no pueden ser iguales'));
        }
    }

    if (this.tipo === 'gasto' && !this.cuentaOrigenId) {
        return next(new Error('Un gasto requiere cuenta origen'));
    }

    if (this.tipo === 'ingreso' && !this.cuentaDestinoId) {
        return next(new Error('Un ingreso requiere cuenta destino'));
    }

    if (this.moneda !== 'COP' && (!this.tasaCambio || this.tasaCambio <= 0)) {
        return next(new Error('Tasa de cambio inválida'));
    }

    next();
});

personalFinanceSchema.methods.softDelete = function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
};

personalFinanceSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

personalFinanceSchema.pre('aggregate', function(next) {
    const pipeline = this.pipeline();

    if (pipeline.length && pipeline[0].$geoNear) {
        pipeline.splice(1, 0, { $match: { isDeleted: false } });
    } else {
        pipeline.unshift({ $match: { isDeleted: false } });
    }

    next();
});

personalFinanceSchema.pre('save', function(next) {
    if (!this.isModified()) return next();

    // Limit audit trail size (MongoDB 16MB doc limit)
    if (this.historialCambios.length > 50) {
        this.historialCambios = this.historialCambios.slice(-50);
    }

    if (!this.$__.original) {
        this.$__.original = this.toObject({ depopulate: true });
    }

    const original = this.$__.original;

    this.modifiedPaths().forEach(field => {
        if (field !== 'historialCambios' && field !== 'updatedAt') {
            // Use this.get() for deep object/array tracking
            const valorNuevo = this.get(field);
            const valorAnterior = original[field];

            this.historialCambios.push({
                campo: field,
                valorAnterior,
                valorNuevo,
                fecha: new Date()
            });
        }
    });

    next();
});

module.exports = mongoose.model('PersonalFinance', personalFinanceSchema);