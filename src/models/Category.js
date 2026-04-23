const mongoose = require('mongoose');
const { Schema } = mongoose;

const categorySchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    nombre: {
        type: String,
        required: true,
        trim: true
    },
    tipo: {
        type: String,
        enum: ['ingreso', 'gasto', 'ambos'],
        required: true
    },
    color: String,
    icono: String,
    isDefault: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
