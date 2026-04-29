'use strict';

/**
 * @file category.service.js
 * @description Capa de negocio para categorías de transacciones.
 *
 * FIX [C-06/R-08]: Extrae la lógica inline de category.routes.js.
 */

const Category     = require('../models/Category');
const { AppError } = require('../middlewares/error.middleware');

const ALLOWED_CREATE = ['nombre', 'tipo', 'color', 'icono'];
const ALLOWED_UPDATE = ['nombre', 'tipo', 'color', 'icono'];

class CategoryService {

    static _pick(obj, fields) {
        return Object.fromEntries(
            Object.entries(obj).filter(([k]) => fields.includes(k) && obj[k] !== undefined)
        );
    }

    /**
     * Lista categorías del usuario, con filtro opcional por tipo.
     */
    static async list(userId, tipo = null) {
        const filter = { userId };
        if (tipo) filter.tipo = tipo;
        return Category.find(filter)
            .select('-__v')
            .sort({ nombre: 1 })
            .lean();
    }

    /**
     * Crea una nueva categoría.
     * Normaliza el nombre a lowercase.
     */
    static async create(body, userId) {
        const data = CategoryService._pick(body, ALLOWED_CREATE);
        if (data.nombre) data.nombre = data.nombre.toLowerCase().trim();

        try {
            const category = await Category.create({ ...data, userId });
            return category.toObject();
        } catch (err) {
            if (err.code === 11000) {
                throw new AppError('Ya existe una categoría con ese nombre', 409, 'DUPLICATE_CATEGORY');
            }
            throw err;
        }
    }

    /**
     * Obtiene una categoría por ID verificando ownership.
     */
    static async getById(id, userId) {
        const category = await Category.findOne({ _id: id, userId }).select('-__v').lean();
        if (!category) throw AppError.notFound('Categoría no encontrada');
        return category;
    }

    /**
     * Actualiza una categoría.
     */
    static async update(id, userId, body) {
        const data = CategoryService._pick(body, ALLOWED_UPDATE);
        if (data.nombre) data.nombre = data.nombre.toLowerCase().trim();

        try {
            const category = await Category.findOneAndUpdate(
                { _id: id, userId },
                { $set: data },
                { new: true, runValidators: true }
            ).select('-__v');

            if (!category) throw AppError.notFound('Categoría no encontrada');
            return category.toObject();
        } catch (err) {
            if (err.code === 11000) {
                throw new AppError('Ya existe una categoría con ese nombre', 409, 'DUPLICATE_CATEGORY');
            }
            throw err;
        }
    }

    /**
     * Soft-delete de una categoría.
     */
    static async softDelete(id, userId) {
        const category = await Category.findOne({ _id: id, userId });
        if (!category) throw AppError.notFound('Categoría no encontrada');
        await category.softDelete(userId);
    }
}

module.exports = CategoryService;
