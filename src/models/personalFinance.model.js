const mongoose = require('mongoose');

const personalFinanceSchema = new mongoose.Schema({
    
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    tipo: {
        type: String,
        enum: ['ingreso', 'gasto'],
        required: true
    },

    monto: {
        type: Number,
        required: true,
        min: 0
    },

    categoria: {
        type: String,
        required: true,
        trim: true
    },

    descripcion: {
        type: String,
        trim: true,
        maxlength: 200
    },

    fecha: {
        type: Date,
        default: Date.now
    },

    meta: {
        type: String,
        trim: true,
        default: null
    },

    esAhorro: {
        type: Boolean,
        default: false
    }

}, {
    timestamps: true
});

module.exports = mongoose.model('PersonalFinance', personalFinanceSchema);
