/**
 * @file user.js
 * @description Mongoose User model.
 *
 * Responsibilities:
 *  - Define the user schema with security-oriented defaults.
 *  - Hash the password automatically before every save (via pre-save hook).
 *  - Expose instance helpers: comparePassword(), generateTokenPair(), softDelete().
 *  - Exclude sensitive fields from JSON serialisation.
 *
 * Depends on:
 *  - bcrypt.middleware.js  — password hashing & comparison
 *  - auth.middleware.js    — JWT generation
 *  - error.middleware.js   — AppError
 */

'use strict';

const mongoose        = require('mongoose');
const { Schema }      = mongoose;
const BcryptMiddleware = require('./bcrypt.middleware');
const AuthMiddleware   = require('./auth.middleware');
const { AppError }     = require('./error.middleware');

// ─── Enumerations ─────────────────────────────────────────────────────────────

const ROLES = ['user', 'admin', 'superadmin'];
const PROVIDERS = ['local', 'google', 'github'];  // OAuth extensibility

// ─── Schema ───────────────────────────────────────────────────────────────────

const userSchema = new Schema({

    // ── Identity ──────────────────────────────────────────────────────────────

    nombre: {
        type:     String,
        trim:     true,
        maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },

    email: {
        type:      String,
        required:  [true, 'El email es obligatorio'],
        unique:    true,
        lowercase: true,
        trim:      true,
        match:     [/^\S+@\S+\.\S+$/, 'El formato del email es inválido'],
        index:     true,
    },

    // ── Auth ──────────────────────────────────────────────────────────────────

    password: {
        type:     String,
        required: [true, 'La contraseña es obligatoria'],
        minlength: [8, 'La contraseña debe tener al menos 8 caracteres'],
        select:   false, // NEVER returned in queries unless explicitly requested
    },

    /** OAuth provider (local = username/password) */
    provider: {
        type:    String,
        enum:    PROVIDERS,
        default: 'local',
    },

    /** OAuth provider's user ID (only for non-local accounts) */
    providerId: {
        type:   String,
        select: false,
    },

    // ── Authorisation ─────────────────────────────────────────────────────────

    roles: {
        type:    [{ type: String, enum: ROLES }],
        default: ['user'],
    },

    // ── Status & Security ─────────────────────────────────────────────────────

    isActive: {
        type:    Boolean,
        default: true,
        index:   true,
    },

    isEmailVerified: {
        type:    Boolean,
        default: false,
    },

    /**
     * Hashed email-verification / password-reset token.
     * Stored hashed so that a DB breach doesn't expose valid tokens.
     */
    verificationToken: {
        type:   String,
        select: false,
    },

    verificationTokenExpires: {
        type:   Date,
        select: false,
    },

    passwordResetToken: {
        type:   String,
        select: false,
    },

    passwordResetExpires: {
        type:   Date,
        select: false,
    },

    /** Epoch of the last password change — used to invalidate old JWTs */
    passwordChangedAt: {
        type:   Date,
        select: false,
    },

    // ── Rate-limiting / Brute-force protection ────────────────────────────────

    /** Consecutive failed login attempts */
    loginAttempts: {
        type:    Number,
        default: 0,
        select:  false,
    },

    /** Account locked until this timestamp (null = not locked) */
    lockUntil: {
        type:   Date,
        select: false,
    },

    lastLoginAt: Date,
    lastLoginIp: { type: String, select: false },

    // ── Soft Delete ───────────────────────────────────────────────────────────

    isDeleted: {
        type:    Boolean,
        default: false,
        index:   true,
    },

    deletedAt: Date,

}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform(_doc, ret) {
            // Strip all sensitive fields from any JSON response
            delete ret.password;
            delete ret.verificationToken;
            delete ret.verificationTokenExpires;
            delete ret.passwordResetToken;
            delete ret.passwordResetExpires;
            delete ret.passwordChangedAt;
            delete ret.loginAttempts;
            delete ret.lockUntil;
            delete ret.providerId;
            delete ret.lastLoginIp;
            delete ret.__v;
            return ret;
        },
    },
    toObject: { virtuals: true },
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

userSchema.index({ email: 1, isDeleted: 1 });
userSchema.index({ isActive: 1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

/** True when the account is temporarily locked due to failed logins */
userSchema.virtual('isLocked').get(function () {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ─── Pre-save Hook: hash password ────────────────────────────────────────────

/**
 * Hash the password whenever it is new or has been modified.
 * This is the single source of truth — plain passwords never reach the DB.
 */
userSchema.pre('save', async function (next) {
    try {
        if (!this.isModified('password')) return next();

        this.password          = await BcryptMiddleware.hash(this.password);
        this.passwordChangedAt = new Date();

        // Reset brute-force counters on password change
        this.loginAttempts = 0;
        this.lockUntil     = undefined;

        next();
    } catch (err) {
        next(err);
    }
});

// ─── Query Middleware: exclude soft-deleted ───────────────────────────────────

userSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

/**
 * Compare a plain-text password against the stored hash.
 * Always call this with the document fetched using .select('+password').
 *
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = function (plainPassword) {
    return BcryptMiddleware.compare(plainPassword, this.password);
};

/**
 * Generate an access + refresh token pair for this user.
 *
 * @returns {{ accessToken: string, refreshToken: string }}
 */
userSchema.methods.generateTokenPair = function () {
    const payload = {
        userId: this._id.toString(),
        email:  this.email,
        roles:  this.roles,
    };
    return AuthMiddleware.generateTokenPair(payload);
};

/**
 * Check whether a JWT was issued before the last password change.
 * Call this inside AuthMiddleware.protect if extra security is needed.
 *
 * @param {number} jwtIssuedAt - iat field from the decoded token (seconds).
 * @returns {boolean} true if the token is still valid.
 */
userSchema.methods.isTokenValidAfterPasswordChange = function (jwtIssuedAt) {
    if (!this.passwordChangedAt) return true;
    const changedAtSeconds = Math.floor(this.passwordChangedAt.getTime() / 1000);
    return jwtIssuedAt >= changedAtSeconds;
};

/**
 * Record a failed login attempt and lock the account after 5 consecutive failures.
 * @returns {Promise<void>}
 */
userSchema.methods.registerFailedLogin = async function () {
    const MAX_ATTEMPTS = 5;
    const LOCK_MINUTES = 15;

    this.loginAttempts = (this.loginAttempts || 0) + 1;

    if (this.loginAttempts >= MAX_ATTEMPTS) {
        this.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    }

    await this.save({ validateBeforeSave: false });
};

/**
 * Clear login failure counters on successful authentication.
 * @param {string} ip - Client IP address for audit.
 */
userSchema.methods.registerSuccessfulLogin = async function (ip = '') {
    this.loginAttempts = 0;
    this.lockUntil     = undefined;
    this.lastLoginAt   = new Date();
    this.lastLoginIp   = ip;
    await this.save({ validateBeforeSave: false });
};

/**
 * Soft-delete: deactivate the account without removing the record.
 * @returns {Promise<Document>}
 */
userSchema.methods.softDelete = function () {
    this.isDeleted  = true;
    this.isActive   = false;
    this.deletedAt  = new Date();
    return this.save({ validateBeforeSave: false });
};

// ─── Static Helpers ───────────────────────────────────────────────────────────

/**
 * Find an active user by email and include the password field for comparison.
 * Centralises the select('+password') pattern so controllers stay clean.
 *
 * @param {string} email
 * @returns {Promise<Document|null>}
 */
userSchema.statics.findByEmailWithPassword = function (email) {
    return this.findOne({ email: email.toLowerCase() })
               .select('+password +loginAttempts +lockUntil +passwordChangedAt');
};

module.exports = mongoose.model('User', userSchema);