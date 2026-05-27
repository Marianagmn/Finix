/**
 * @file business.service.js
 * @description Lógica de negocio para gestión de empresas/negocios.
 *
 * Orquesta operaciones sobre el modelo Business:
 *  - CRUD básico
 *  - Validaciones de negocio
 */

'use strict';

const mongoose = require('mongoose');
const Business = require('../models/Business');
const { AppError } = require('../middlewares/error.middleware');
const Pagination = require('../utils/pagination.utils');

class BusinessService {

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Crea un nuevo negocio.
   *
   * @param {object} data - Datos del negocio
   * @param {string} userId - ID del usuario que crea el negocio
   * @returns {Promise<object>}
   */
  static async create(data, userId) {
    // Verificar si ya existe un negocio con el mismo NIT
    const existing = await Business.findOne({ nit: data.nit });
    if (existing) {
      throw AppError.badRequest('Ya existe un negocio con este NIT');
    }

    const business = new Business({
      ...data,
      createdBy: userId,
      updatedBy: userId,
    });

    await business.save();
    return business.toObject();
  }

  /**
   * Lista todos los negocios con filtros y paginación.
   * Solo devuelve negocios creados por el usuario autenticado.
   *
   * @param {object} filters - { estado, tipoEmpresa, sector, regimenTributario }
   * @param {object} pagination - { skip, limit }
   * @param {object} sort - { createdAt: -1 }
   * @param {string} userId - ID del usuario para filtrar
   * @returns {Promise<{ items: object[], total: number }>}
   */
  static async list(filters = {}, pagination = {}, sort = { createdAt: -1 }, userId = null) {
    const { skip = 0, limit = 20 } = pagination;

    const query = { createdBy: userId };

    if (filters.estado) query.estado = filters.estado;
    if (filters.tipoEmpresa) query.tipoEmpresa = filters.tipoEmpresa;
    if (filters.sector) query.sector = filters.sector;
    if (filters.regimenTributario) query.regimenTributario = filters.regimenTributario;

    const [items, total] = await Promise.all([
      Business.find(query)
        .skip(skip)
        .limit(limit)
        .sort(sort)
        .lean(),
      Business.countDocuments(query),
    ]);

    return { items, total };
  }

  /**
   * Obtiene un negocio por ID.
   * Valida que el usuario sea el propietario.
   *
   * @param {string} id
   * @param {string} userId - ID del usuario autenticado
   * @returns {Promise<object>}
   */
  static async getOne(id, userId = null) {
    const business = await Business.findById(id).lean();
    
    if (!business) {
      throw AppError.notFound('Negocio no encontrado');
    }

    // Si se proporciona userId, verificar que sea el propietario
    if (userId && business.createdBy.toString() !== userId) {
      throw AppError.forbidden('No tienes permisos para acceder a este negocio');
    }

    return business;
  }

  /**
   * Actualiza un negocio.
   * Valida que el usuario sea el propietario.
   *
   * @param {string} id
   * @param {object} data
   * @param {string} userId
   * @returns {Promise<object>}
   */
  static async update(id, data, userId) {
    const business = await Business.findById(id);
    
    if (!business) {
      throw AppError.notFound('Negocio no encontrado');
    }

    // Validar que el usuario sea el propietario
    if (business.createdBy.toString() !== userId) {
      throw AppError.forbidden('No tienes permisos para actualizar este negocio');
    }

    // Si se está actualizando el NIT, verificar que no exista otro negocio con ese NIT
    if (data.nit && data.nit !== business.nit) {
      const existing = await Business.findOne({ nit: data.nit });
      if (existing) {
        throw AppError.badRequest('Ya existe un negocio con este NIT');
      }
    }

    Object.assign(business, data);
    business.updatedBy = userId;
    
    await business.save();
    return business.toObject();
  }

  /**
   * Soft-delete de un negocio.
   * Valida que el usuario sea el propietario.
   *
   * @param {string} id
   * @param {string} userId
   */
  static async softDelete(id, userId) {
    const business = await Business.findById(id);
    
    if (!business) {
      throw AppError.notFound('Negocio no encontrado');
    }

    // Validar que el usuario sea el propietario
    if (business.createdBy.toString() !== userId) {
      throw AppError.forbidden('No tienes permisos para eliminar este negocio');
    }

    // Verificar que no haya usuarios asociados a este negocio
    const User = require('../models/User');
    const usersWithBusiness = await User.countDocuments({ businessId: id });
    
    if (usersWithBusiness > 0) {
      throw AppError.badRequest('No se puede eliminar un negocio que tiene usuarios asociados');
    }

    await Business.softDeleteById(id, userId);
  }

  // ─── Consultas especializadas ─────────────────────────────────────────────────

  /**
   * Busca negocios por NIT.
   *
   * @param {string} nit
   * @returns {Promise<object>}
   */
  static async findByNit(nit) {
    const business = await Business.findOne({ nit }).lean();
    
    if (!business) {
      throw AppError.notFound('Negocio no encontrado');
    }

    return business;
  }

  /**
   * Lista negocios activos del usuario autenticado (para selectores en el frontend).
   * Solo devuelve negocios creados por el usuario autenticado que están activos.
   *
   * @param {string} userId - ID del usuario para filtrar
   * @returns {Promise<object[]>}
   */
  static async listActive(userId) {
    return Business.find({ 
      estado: 'activo',
      createdBy: userId,
      isDeleted: false 
    })
      .select('nombre nit tipoEmpresa sector ciudad')
      .sort({ nombre: 1 })
      .lean();
  }
}

module.exports = BusinessService;
