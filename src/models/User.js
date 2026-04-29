/**
 * @file user.js
 * @description Mongoose User model — schema, validaciones, hooks y helpers de instancia.
 *
 */

'use strict';

const mongoose       = require('mongoose');
const { Schema }     = mongoose;
const PasswordUtils  = require('../utils/password.utils');
// Antes: User.js → AuthMiddleware → (lazy) User.js
// Ahora: User.js → JwtUtils (sin circular)
const JwtUtils       = require('../utils/jwt.utils');

// ─── Constantes ───────────────────────────────────────────────────────────────

// Sin esto, AuthMiddleware.requireRole('aprobador','contador') siempre devuelve 403.
const ROLES     = ['user', 'admin', 'superadmin', 'aprobador', 'contador'];
const PROVIDERS = ['local', 'google', 'github'];

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5;
const LOCK_DURATION_MS   = (parseInt(process.env.LOCK_DURATION_MINUTES, 10) || 15) * 60_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

const userSchema = new Schema({

    // ── Identidad ─────────────────────────────────────────────────────────────

    name: {
      
        type:      String,
        trim:      true,
        maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },

    email: {
        type:      String,
        required:  [true, 'El email es obligatorio'],
     
        lowercase: true,
        trim:      true,
        match:     [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Formato de email inválido'],
    },

    // ── Autenticación ─────────────────────────────────────────────────────────

    password: {
        type:   String,
      
        select: false,
    },

    provider: {
        type:    String,
        enum:    PROVIDERS,
        default: 'local',
    },

    providerId: {
        type:   String,
        select: false,
    },

    // ── Autorización ──────────────────────────────────────────────────────────

    roles: {
        type:    [{ type: String, enum: ROLES }],
        default: ['user'],
    },

    // ── Estado y seguridad ────────────────────────────────────────────────────

    isActive: {
        type:    Boolean,
        default: true,
    },

    isEmailVerified: {
        type:    Boolean,
        default: false,
    },

    verificationToken: {
        type:   String,
        select: false,
    },

    verificationTokenExpiresAt: {
        type:   Date,
        select: false,
    },

    passwordResetToken: {
        type:   String,
        select: false,
    },

    passwordResetExpiresAt: {
        type:   Date,
        select: false,
    },

    /**
     * Timestamp del último cambio de contraseña.
     * AuthMiddleware.protect verifica que el JWT fue emitido DESPUÉS de este valor.
     * Cualquier cambio de contraseña invalida todos los tokens anteriores.
     */
    passwordChangedAt: {
        type:   Date,
        select: false,
    },

    // ── Protección contra fuerza bruta ────────────────────────────────────────

    /**
     * REGLA: Estos campos se actualizan SOLO mediante operaciones atómicas
     * (findByIdAndUpdate con $inc / $set). Nunca modificar sobre el documento
     * en memoria y luego .save() — produce race conditions bajo carga concurrente.
     */
    loginAttempts: {
        type:    Number,
        default: 0,
        select:  false,
    },

    lockUntil: {
        type:   Date,
        select: false,
    },

    lastLoginAt: Date,

    lastLoginIp: {
        type:   String,
        select: false,
    },

    // ── Soft delete ───────────────────────────────────────────────────────────

    isDeleted: {
        type:    Boolean,
        default: false,
    },

    deletedAt: Date,

}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform(_doc, ret) {
            // Allowlist explícita: más seguro que deletear campos sensibles uno a uno.
            // Si se agrega un campo nuevo sensible al schema, NO se expone automáticamente.
            return {
                id:              ret._id,
                name:            ret.name,
                email:           ret.email,
                roles:           ret.roles,
                provider:        ret.provider,
                isActive:        ret.isActive,
                isEmailVerified: ret.isEmailVerified,
                lastLoginAt:     ret.lastLoginAt,
                createdAt:       ret.createdAt,
            };
        },
    },
    toObject: { virtuals: true },
});

// ─── Índices ──────────────────────────────────────────────────────────────────

// El índice resultante satisface findOne({ email }) y findOne({ email, isDeleted: false }).
// La constraint unique aplica solo a documentos donde isDeleted: false.
userSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false }, name: 'email_unique_active' }
);

userSchema.index({ isActive: 1, isDeleted: 1 });

// Para jobs que limpian lockouts expirados
userSchema.index({ lockUntil: 1 }, { sparse: true, name: 'lockUntil_sparse' });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

/** true si la cuenta está temporalmente bloqueada por intentos fallidos */
userSchema.virtual('isLocked').get(function () {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ─── Pre-validate ─────────────────────────────────────────────────────────────

userSchema.pre('validate', function (next) {
    if (this.isNew && this.provider === 'local' && !this.password) {
        this.invalidate('password', 'La contraseña es obligatoria para cuentas locales');
    }
    next();
});

// ─── Pre-save: ÚNICO punto de hashing ────────────────────────────────────────

/**
 *
 * Por qué no se hashea en la ruta (middleware) + aquí:
 *   En documentos nuevos, Mongoose.isModified() retorna true para TODOS
 *   los campos. El guard `if (!this.isModified('password'))` no salta
 *   en el primer save. Si el password llega ya hasheado desde un middleware
 *   de ruta, este hook lo vuelve a hashear: bcrypt(bcrypt(password)).
 *   El resultado se almacena en DB y bcrypt.compare() siempre falla.
 *
 * Solución: el password llega como texto plano, este hook lo hashea UNA vez.
 */
userSchema.pre('save', async function (next) {
    try {
        if (!this.isModified('password') || !this.password) return next();

        this.password          = await PasswordUtils.hash(this.password);
        this.passwordChangedAt = new Date();

        // Un cambio de contraseña resetea los contadores de fuerza bruta
        this.loginAttempts = 0;
        this.lockUntil     = undefined;

        next();
    } catch (err) {
        next(err);
    }
});

// ─── Query middleware ─────────────────────────────────────────────────────────

userSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

// ─── Métodos de instancia ─────────────────────────────────────────────────────

/**
 * Compara texto plano contra el hash almacenado.
 * Requiere que el documento haya sido fetched con .select('+password').
 */
userSchema.methods.comparePassword = function (plainPassword) {
    return PasswordUtils.compare(plainPassword, this.password);
};

/**
 * Genera un par access + refresh token para este usuario.
 * El payload solo incluye lo estrictamente necesario — nunca campos sensibles.
 */
userSchema.methods.generateTokenPair = function () {
    // FIX [C-04]: Delegado a JwtUtils — sin dependencia circular.
    return JwtUtils.generateTokenPair({
        userId: this._id.toString(),
        email:  this.email,
        roles:  this.roles,
    });
};

/**
 * Verifica si un JWT fue emitido DESPUÉS del último cambio de contraseña.
 * Cualquier cambio invalida todos los tokens anteriores.
 * Esta función se INVOCA en AuthMiddleware.protect() — no es solo declarativa.
 *
 * @param {number} jwtIssuedAt - Campo 'iat' del JWT (segundos epoch).
 * @returns {boolean} false = token obsoleto, debe rechazarse.
 */
userSchema.methods.isTokenValidAfterPasswordChange = function (jwtIssuedAt) {
    if (!this.passwordChangedAt) return true;
    // Margen de 1 segundo para diferencias de reloj entre servidores
    const changedAtSeconds = Math.floor(this.passwordChangedAt.getTime() / 1000) - 1;
    return jwtIssuedAt > changedAtSeconds;
};

// ─── Statics ──────────────────────────────────────────────────────────────────

/**
 * Busca un usuario por email incluyendo campos de seguridad necesarios para login.
 * Centraliza el patrón .select('+password +...') — no duplicar en controllers.
 */
userSchema.statics.findByEmailForAuth = function (email) {
    return this
        .findOne({ email: email.toLowerCase() })
        .select('+password +loginAttempts +lockUntil +passwordChangedAt');
};

/**
 *
 * Por qué no se usa this.loginAttempts++ + this.save():
 *   Bajo carga concurrente, 10 requests leen loginAttempts: 0, todos incrementan
 *   a 1 y guardan. Resultado final: loginAttempts: 1 (en lugar de 10).
 *   El lockout nunca se activa. Toda la protección contra fuerza bruta es inútil.
 *
 * $inc es una operación atómica de MongoDB — safe para concurrencia.
 *
 * @param {string|ObjectId} userId
 */
userSchema.statics.registerFailedLogin = async function (userId) {
    const user = await this.findByIdAndUpdate(
        userId,
        { $inc: { loginAttempts: 1 } },
        { new: true, select: 'loginAttempts lockUntil' }
    );

    if (user && user.loginAttempts >= MAX_LOGIN_ATTEMPTS && !user.lockUntil) {
        await this.findByIdAndUpdate(userId, {
            $set: { lockUntil: new Date(Date.now() + LOCK_DURATION_MS) },
        });
    }
};

/**
 *
 * @param {string|ObjectId} userId
 * @param {string}          ip    - IP real del cliente (ver nota sobre trust proxy).
 */
userSchema.statics.registerSuccessfulLogin = function (userId, ip = '') {
    return this.findByIdAndUpdate(
        userId,
        {
            $set:   { loginAttempts: 0, lastLoginAt: new Date(), lastLoginIp: ip },
            $unset: { lockUntil: '' },
        },
        { new: true }
    );
};

/**
 * Soft-delete atómico. No carga el documento completo — más eficiente.
 */
userSchema.statics.softDeleteById = function (userId) {
    return this.findByIdAndUpdate(
        userId,
        { $set: { isDeleted: true, isActive: false, deletedAt: new Date() } },
        { new: true }
    );
};

module.exports = mongoose.model('User', userSchema);