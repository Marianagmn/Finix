const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    nombre: String,
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// TODO: Add password hashing pre-save hook
// TODO: Add JWT token generation method

module.exports = mongoose.model('User', userSchema);
