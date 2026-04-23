const mongoose = require('mongoose');
const { Schema } = mongoose;

const accountSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    nombre: {
        type: String,
        required: true
    },
    tipo: {
        type: String,
        enum: ['efectivo', 'ahorro', 'corriente', 'credito', 'inversion'],
        required: true
    },
    moneda: {
        type: String,
        enum: ['COP', 'USD', 'EUR'],
        default: 'COP'
    },
    balance: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// TODO: Add methods for balance calculation
// TODO: Add transaction history reference

module.exports = mongoose.model('Account', accountSchema);
