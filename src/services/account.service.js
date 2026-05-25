'use strict';

/**
 * @file account.service.js
 * @description Capa de negocio para cuentas financieras.
 */

const Account      = require('../models/Account');
const { AppError } = require('../middlewares/error.middleware');

// Campos permitidos en create (mass assignment protection)
const ALLOWED_CREATE = ['nombre', 'tipo', 'moneda', 'balance'];
// Campos permitidos en update
const ALLOWED_UPDATE = ['nombre', 'tipo', 'moneda', 'balance', 'isActive'];

class AccountService {

    static _pick(obj, fields) {
        return Object.fromEntries(
            Object.entries(obj).filter(([k]) => fields.includes(k) && obj[k] !== undefined)
        );
    }

    /**
     * Lista todas las cuentas activas del usuario.
     */
    static async list(userId) {
        return Account.find({ userId })
            .select('-__v')
            .sort({ createdAt: -1 })
            .lean();
    }

    /**
     * Crea una nueva cuenta.
     */
    static async create(body, userId) {
        const data = AccountService._pick(body, ALLOWED_CREATE);
        const account = await Account.create({ ...data, userId });
        return account.toObject();
    }

    /**
     * Obtiene una cuenta por ID verificando ownership.
     */
    static async getById(id, userId) {
        const account = await Account.findOne({ _id: id, userId }).select('-__v').lean();
        if (!account) throw AppError.notFound('Cuenta no encontrada');
        return account;
    }

    /**
     * Actualiza una cuenta.
     */
    static async update(id, userId, body) {
        const data = AccountService._pick(body, ALLOWED_UPDATE);
        const account = await Account.findOneAndUpdate(
            { _id: id, userId },
            { $set: data },
            { new: true, runValidators: true }
        ).select('-__v');

        if (!account) throw AppError.notFound('Cuenta no encontrada');
        return account.toObject();
    }

    /**
     * Soft-delete de una cuenta.
     * Usa el método del plugin softDelete.
     */
    static async softDelete(id, userId) {
        const account = await Account.findOne({ _id: id, userId });
        if (!account) throw AppError.notFound('Cuenta no encontrada');
        await account.softDelete(userId);
    }

    /**
     * Actualiza el balance de una cuenta.
     * @param {string} accountId - ID de la cuenta
     * @param {string} userId - ID del usuario
     * @param {number} amount - Cantidad a agregar (positivo) o restar (negativo)
     */
    static async updateBalance(accountId, userId, amount) {
        const account = await Account.findOne({ _id: accountId, userId });
        if (!account) throw AppError.notFound('Cuenta no encontrada');
        
        account.balance += amount;
        await account.save();
        return account.toObject();
    }
}

module.exports = AccountService;
