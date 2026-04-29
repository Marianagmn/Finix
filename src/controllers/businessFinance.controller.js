/**
 * @file businessFinance.controller.js
 * @description Controllers para transacciones empresariales.
 * Solo parsea request → llama service → formatea response.
 */

'use strict';

const BusinessFinanceService = require('../services/businessFinance.service');
const ApiResponse            = require('../utils/response.utils');
const Pagination             = require('../utils/pagination.utils');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Valida que el usuario tenga un businessId asignado
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @returns {boolean} True si es válido, false si respondió con error
 */
function validateBusinessId(req, res) {
    if (!req.user?.businessId) {
        ApiResponse.error(res, 'Usuario no tiene un negocio asignado', {
            statusCode: 403,
            code: 'BUSINESS_REQUIRED'
        });
        return false;
    }
    return true;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function create(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.create(
            { ...req.body, businessId: req.user.businessId },
            req.user.userId
        );
        ApiResponse.created(res, txn);
    } catch (err) { next(err); }
}

async function list(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        // FIX [C-01]: Pagination.parse/parseSort/meta no existen.
        // La API correcta es Pagination.offset() que retorna {skip, limit, sort, buildMeta()}.
        const pager = Pagination.offset(req.query, {
            allowedSortFields: ['fecha', 'monto', 'createdAt', 'estado'],
            defaultSort: '-fecha',
        });

        const { items, total } = await BusinessFinanceService.list(
            req.user.businessId,
            req.query,
            { skip: pager.skip, limit: pager.limit },
            pager.sort
        );
        ApiResponse.paginated(res, items, pager.buildMeta(total));
    } catch (err) { next(err); }
}

async function getOne(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.getOne(req.params.id, req.user.businessId);
        ApiResponse.success(res, txn.toObject());
    } catch (err) { next(err); }
}

async function update(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.update(
            req.params.id,
            req.user.businessId,
            req.body,
            req.user.userId
        );
        ApiResponse.success(res, txn, { message: 'Transacción actualizada' });
    } catch (err) { next(err); }
}

async function remove(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        await BusinessFinanceService.softDelete(req.params.id, req.user.businessId, req.user.userId);
        ApiResponse.noContent(res);
    } catch (err) { next(err); }
}

// ─── Flujo de aprobación ──────────────────────────────────────────────────────

async function submitForApproval(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.submitForApproval(
            req.params.id, req.user.businessId, req.user.userId
        );
        ApiResponse.success(res, txn, { message: 'Transacción enviada a aprobación' });
    } catch (err) { next(err); }
}

async function approve(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.approve(
            req.params.id,
            req.user.businessId,
            req.user.userId,
            req.body.comentario
        );
        ApiResponse.success(res, txn, { message: 'Transacción aprobada' });
    } catch (err) { next(err); }
}

async function reject(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.reject(
            req.params.id,
            req.user.businessId,
            req.user.userId,
            req.body.motivo
        );
        ApiResponse.success(res, txn, { message: 'Transacción rechazada' });
    } catch (err) { next(err); }
}

// ─── Contabilización y reverso ────────────────────────────────────────────────

async function post(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.post(
            req.params.id, req.user.businessId, req.user.userId
        );
        ApiResponse.success(res, txn, { message: 'Transacción contabilizada' });
    } catch (err) { next(err); }
}

async function reverse(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const reverso = await BusinessFinanceService.reverse(
            req.params.id,
            req.user.businessId,
            req.user.userId,
            req.body.motivo
        );
        ApiResponse.created(res, reverso, 'Reverso generado exitosamente');
    } catch (err) { next(err); }
}

// ─── Pagos ────────────────────────────────────────────────────────────────────

async function applyPayment(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.applyPayment(
            req.params.id,
            req.user.businessId,
            req.body.pagoId,
            req.body.monto,
            req.user.userId
        );
        ApiResponse.success(res, txn, { message: 'Pago aplicado' });
    } catch (err) { next(err); }
}

// ─── Impuestos ────────────────────────────────────────────────────────────────

async function recalculateTaxes(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const txn = await BusinessFinanceService.recalculateTaxes(
            req.params.id, req.user.businessId, req.user.userId
        );
        ApiResponse.success(res, txn, { message: 'Impuestos recalculados' });
    } catch (err) { next(err); }
}

// ─── Consultas especializadas ─────────────────────────────────────────────────

async function getPendingApprovals(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        // FIX [C-01]
        const pager = Pagination.offset(req.query);
        const { items, total } = await BusinessFinanceService.getPendingApprovals(
            req.user.businessId, req.user.userId, { skip: pager.skip, limit: pager.limit }
        );
        ApiResponse.paginated(res, items, pager.buildMeta(total));
    } catch (err) { next(err); }
}

async function getOverdue(req, res, next) {
    try {
        if (!validateBusinessId(req, res)) return;

        const tipo  = req.params.tipo; // 'cobrar' | 'pagar'
        const pager = Pagination.offset(req.query); // FIX [C-01]
        const { items, total } = await BusinessFinanceService.getOverdue(
            req.user.businessId, tipo, { skip: pager.skip, limit: pager.limit }
        );
        ApiResponse.paginated(res, items, pager.buildMeta(total));
    } catch (err) { next(err); }
}

module.exports = {
    create, list, getOne, update, remove,
    submitForApproval, approve, reject,
    post, reverse,
    applyPayment,
    recalculateTaxes,
    getPendingApprovals, getOverdue,
};