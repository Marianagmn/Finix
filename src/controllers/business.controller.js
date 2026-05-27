/**
 * @file business.controller.js
 * @description Controllers para gestión de empresas/negocios.
 * Solo parsea request → llama service → formatea response.
 */

'use strict';

const BusinessService = require('../services/business.service');
const ApiResponse = require('../utils/response.utils');
const Pagination = require('../utils/pagination.utils');

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function create(req, res, next) {
  try {
    const business = await BusinessService.create(req.body, req.user.userId);
    ApiResponse.created(res, business);
  } catch (err) { next(err); }
}

async function list(req, res, next) {
  try {
    const pager = Pagination.offset(req.query, {
      allowedSortFields: ['nombre', 'nit', 'createdAt', 'estado'],
      defaultSort: '-createdAt',
    });

    const { items, total } = await BusinessService.list(
      req.query,
      { skip: pager.skip, limit: pager.limit },
      pager.sort,
      req.user.userId
    );
    ApiResponse.paginated(res, items, pager.buildMeta(total));
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const business = await BusinessService.getOne(req.params.id, req.user.userId);
    ApiResponse.success(res, business);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const business = await BusinessService.update(
      req.params.id,
      req.body,
      req.user.userId
    );
    ApiResponse.success(res, business, { message: 'Negocio actualizado' });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await BusinessService.softDelete(req.params.id, req.user.userId);
    ApiResponse.noContent(res);
  } catch (err) { next(err); }
}

// ─── Consultas especializadas ─────────────────────────────────────────────────

async function findByNit(req, res, next) {
  try {
    const business = await BusinessService.findByNit(req.params.nit);
    ApiResponse.success(res, business);
  } catch (err) { next(err); }
}

async function listActive(req, res, next) {
  try {
    const businesses = await BusinessService.listActive(req.user.userId);
    ApiResponse.success(res, businesses);
  } catch (err) { next(err); }
}

module.exports = {
  create,
  list,
  getOne,
  update,
  remove,
  findByNit,
  listActive,
};
