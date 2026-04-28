'use strict';

/**
 * @file validateObjectId.middleware.js
 * @description Middleware compartido para validar ObjectIds en route params.
 * Reemplaza las 4 implementaciones duplicadas en account, category,
 * personalFinance y businessFinance routes.
 *
 * Uso:
 *   const { validateObjectId } = require('../middlewares/validateObjectId.middleware');
 *
 *   // Valida req.params.id
 *   router.get('/:id', validateObjectId(), ctrl.getOne);
 *
 *   // Valida múltiples params
 *   router.get('/:userId/:accountId', validateObjectId('userId', 'accountId'), ctrl.get);
 */

const mongoose    = require('mongoose');
const { AppError } = require('./error.middleware');

/**
 * Genera un middleware que valida que los params indicados sean ObjectIds válidos.
 * Si no se indica ningún param, valida 'id' por defecto.
 *
 * @param  {...string} params - Nombres de parámetros a validar (default: 'id')
 * @returns {Function} Express middleware
 */
function validateObjectId(...params) {
    const targets = params.length > 0 ? params : ['id'];

    return (req, res, next) => {
        for (const param of targets) {
            if (!mongoose.Types.ObjectId.isValid(req.params[param])) {
                return next(AppError.badRequest(`ID inválido: ${param}`));
            }
        }
        next();
    };
}

module.exports = { validateObjectId };
