/**
 * @file Business.js
 * @description Mongoose Business model — schema para gestión de empresas/negocios.
 *
 * Este modelo representa una entidad empresarial que puede estar asociada a usuarios
 * para habilitar el módulo de finanzas empresariales.
 */

'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPOS_EMPRESA = ['persona_natural', 'persona_juridica', 'entidad_gubernamental'];
const SECTORES = ['comercio', 'servicios', 'manufactura', 'tecnologia', 'salud', 'educacion', 'construccion', 'otro'];
const REGIMENES_TRIBUTARIOS = ['simplificado', 'comun', 'gran_contribuyente'];
const ESTADOS_NEGOCIO = ['activo', 'inactivo', 'suspendido'];

// ─── Schema ───────────────────────────────────────────────────────────────────

const businessSchema = new Schema({

  // ── Identificación ─────────────────────────────────────────────────────────────

  nombre: {
    type: String,
    required: [true, 'El nombre del negocio es obligatorio'],
    trim: true,
    maxlength: [200, 'El nombre no puede superar 200 caracteres'],
    index: true,
  },

  nit: {
    type: String,
    required: [true, 'El NIT es obligatorio'],
    trim: true,
    unique: true,
    validate: {
      validator: function(v) {
        // Validación básica de NIT colombiano (9-11 dígitos)
        return /^\d{9,11}$/.test(v);
      },
      message: 'NIT inválido (debe tener entre 9 y 11 dígitos)',
    },
    index: true,
  },

  tipoEmpresa: {
    type: String,
    enum: TIPOS_EMPRESA,
    default: 'persona_juridica',
  },

  sector: {
    type: String,
    enum: SECTORES,
    default: 'servicios',
  },

  // ── Información Fiscal ─────────────────────────────────────────────────────────

  regimenTributario: {
    type: String,
    enum: REGIMENES_TRIBUTARIOS,
    default: 'comun',
  },

  responsableIva: {
    type: Boolean,
    default: false,
  },

  // ── Ubicación ─────────────────────────────────────────────────────────────────

  direccion: {
    type: String,
    trim: true,
    maxlength: [300, 'La dirección no puede superar 300 caracteres'],
  },

  ciudad: {
    type: String,
    trim: true,
    maxlength: [100, 'La ciudad no puede superar 100 caracteres'],
  },

  departamento: {
    type: String,
    trim: true,
    maxlength: [100, 'El departamento no puede superar 100 caracteres'],
  },

  pais: {
    type: String,
    trim: true,
    default: 'Colombia',
    maxlength: [100, 'El país no puede superar 100 caracteres'],
  },

  codigoPostal: {
    type: String,
    trim: true,
    maxlength: [20, 'El código postal no puede superar 20 caracteres'],
  },

  // ── Contacto ─────────────────────────────────────────────────────────────────

  telefono: {
    type: String,
    trim: true,
    maxlength: [20, 'El teléfono no puede superar 20 caracteres'],
  },

  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'],
  },

  sitioWeb: {
    type: String,
    trim: true,
  },

  // ── Estado ───────────────────────────────────────────────────────────────────

  estado: {
    type: String,
    enum: ESTADOS_NEGOCIO,
    default: 'activo',
    index: true,
  },

  // ── Metadatos ───────────────────────────────────────────────────────────────

  descripcion: {
    type: String,
    trim: true,
    maxlength: [500, 'La descripción no puede superar 500 caracteres'],
  },

  logoUrl: {
    type: String,
    trim: true,
  },

  // ── Auditoría ───────────────────────────────────────────────────────────────

  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },

  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },

  // ── Soft Delete ───────────────────────────────────────────────────────────────

  isDeleted: {
    type: Boolean,
    default: false,
    index: true,
  },

  deletedAt: Date,

  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },

}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(_doc, ret) {
      return {
        id: ret._id,
        nombre: ret.nombre,
        nit: ret.nit,
        tipoEmpresa: ret.tipoEmpresa,
        sector: ret.sector,
        regimenTributario: ret.regimenTributario,
        responsableIva: ret.responsableIva,
        direccion: ret.direccion,
        ciudad: ret.ciudad,
        departamento: ret.departamento,
        pais: ret.pais,
        codigoPostal: ret.codigoPostal,
        telefono: ret.telefono,
        email: ret.email,
        sitioWeb: ret.sitioWeb,
        estado: ret.estado,
        descripcion: ret.descripcion,
        logoUrl: ret.logoUrl,
        createdAt: ret.createdAt,
        updatedAt: ret.updatedAt,
      };
    },
  },
  toObject: { virtuals: true },
});

// ─── Índices ──────────────────────────────────────────────────────────────────

// Índice compuesto para búsquedas por NIT con soft delete
businessSchema.index(
  { nit: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: 'nit_unique_active' }
);

// Índice para búsquedas por estado
businessSchema.index({ estado: 1, isDeleted: 1 });

// ─── Query middleware ─────────────────────────────────────────────────────────

businessSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

// ─── Statics ───────────────────────────────────────────────────────────────────

/**
 * Soft-delete atómico.
 */
businessSchema.statics.softDeleteById = function(businessId, userId) {
  return this.findByIdAndUpdate(
    businessId,
    { 
      $set: { 
        isDeleted: true, 
        estado: 'inactivo',
        deletedAt: new Date(),
        deletedBy: userId
      } 
    },
    { new: true }
  );
};

module.exports = mongoose.model('Business', businessSchema);
