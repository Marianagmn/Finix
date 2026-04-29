/**
 * @file user.js
 * @description Mongoose User model — schema, validaciones, hooks y helpers de instancia.
 *
 * Diseño de seguridad:
 *   - Hashing de contraseñas centralizado en el pre-save hook únicamente. El password
 *     llega como texto plano y se hashea una sola vez. Esto evita el double-hashing
 *     que ocurre cuando Mongoose marca isModified('password') === true en documentos nuevos.
 *   - Operaciones atómicas para contadores de login: se usan operadores $inc/$set
 *     en lugar de read-modify-save para evitar race conditions bajo carga concurrente.
 *   - Revocación de tokens: isTokenValidAfterPasswordChange invalida todos los tokens
 *     emitidos antes de un cambio de contraseña.
 *   - Validación de contraseñas: la política se aplica en PasswordUtils.validate()
 *     antes del hashing, ya que el schema almacena el hash (60 caracteres), no el texto plano.
 *   - Índice de email único optimizado: un solo índice compuesto con partialFilterExpression
 *     satisface todas las queries de autenticación sin duplicación.
 */

'use strict';

const mongoose       = require('mongoose');
const { Schema }     = mongoose;
const PasswordUtils  = require('../utils/password.utils');
// JwtUtils se usa en lugar de AuthMiddleware para evitar dependencia circular:
// User.js → AuthMiddleware → (lazy) User.js se convierte en User.js → JwtUtils (sin circular)
const JwtUtils       = require('../utils/jwt.utils');

// ─── Constantes ───────────────────────────────────────────────────────────────

// Roles extendidos para soportar flujos de aprobación empresarial
// (aprobador, contador) requeridos por el módulo businessFinance
const ROLES     = ['user', 'admin', 'superadmin', 'aprobador', 'contador'];
const PROVIDERS = ['local', 'google', 'github'];
// Número máximo de intentos fallidos de login antes de bloquear la cuenta
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5;
// Duración del bloqueo en milisegundos (15 minutos por defecto)
const LOCK_DURATION_MS   = (parseInt(process.env.LOCK_DURATION_MINUTES, 10) || 15) * 60_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

const userSchema = new Schema({

    // ── Identidad ─────────────────────────────────────────────────────────────

    name: {
        // Se usa 'name' en lugar de 'nombre' para mantener consistencia de idioma en el schema
        type:      String,
        trim:      true,
        maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },

    email: {
        type:      String,
        required:  [true, 'El email es obligatorio'],
        // El índice único se define a nivel de schema (ver userSchema.index abajo)
        // en lugar de usar unique: true en el campo, evitando índices duplicados
        lowercase: true,
        trim:      true,
        match:     [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Formato de email inválido'],
    },

    // ── Autenticación ─────────────────────────────────────────────────────────

    password: {
        type:   String,
        // No se usa 'required' porque usuarios OAuth no tienen password local
        // (la validación condicional está en el pre-validate hook).
        // No se usa 'minlength' porque el schema recibe el hash (60 caracteres), no
        // el texto plano. La política de contraseñas se aplica en PasswordUtils.validate().
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

/**
 * Índice optimizado de email: un único índice compuesto con partialFilterExpression
 * reemplaza múltiples índices separados que se creaban con index: true y unique: true
 * en el campo. Este índice satisface las queries más comunes (findOne por email,
 * findOne por email + isDeleted) y aplica unique constraint solo a documentos activos.
 */
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
 * Pre-save hook: centraliza el hashing de contraseñas en un único punto.
 *
 * La contraseña debe llegar como texto plano porque Mongoose.isModified() retorna
 * true para TODOS los campos en documentos nuevos. Si el password llegara pre-hasheado
 * desde un middleware de ruta, este hook lo volvería a hashear (double-hashing),
 * resultando en un hash inválido que bcrypt.compare() nunca verificaría correctamente.
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
    // Delegado a JwtUtils para evitar dependencia circular User ↔ AuthMiddleware
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
 * Registra intento fallido de login de forma atómica.
 *
 * Se usa $inc en lugar de read-modify-save (this.loginAttempts++ + this.save())
 * porque bajo carga concurrente, múltiples requests podrían leer el mismo valor
 * inicial, incrementarlo localmente a 1, y guardar, resultando en loginAttempts: 1
 * en lugar del valor correcto. Con $inc (operación atómica de MongoDB), cada
 * incremento se aplica secuencialmente sin race conditions.
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
 * Limpia contadores de fuerza bruta de forma atómica.
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