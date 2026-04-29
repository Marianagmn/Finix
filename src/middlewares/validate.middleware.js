/**
 * @file validate.middleware.js
 * @description Validación y sanitización de inputs con Zod.
 *
 * Por qué Zod en lugar de express-validator:
 *  - Type inference en TypeScript (y autocompletado en JS con JSDoc).
 *  - Schema reutilizable entre frontend y backend.
 *  - API declarativa más limpia que chains de .isEmail().isLength().
 * Instalación: npm install zod
 */

'use strict';

const { z }        = require('zod');
const { AppError } = require('./error.middleware');

// Importar constantes para enums
const {
    TIPOS_BASE_ARRAY,
    ESTADOS,
    ESTADOS_PERSONALES,
    METODOS_PAGO,
    MONEDAS
} = require('../constants/transaction.constants');

// ─── Schemas de validación ────────────────────────────────────────────────────

/**
 * Reglas de contraseña aplicadas ANTES del hashing.
 * Exportado para reutilizar en reset-password, change-password, etc.
 */
const passwordSchema = z
    .string({ required_error: 'La contraseña es requerida' })
    .min(8,  'La contraseña debe tener al menos 8 caracteres')
    .max(72, 'La contraseña no puede superar 72 caracteres (límite de bcrypt)')
    .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'La contraseña debe incluir mayúsculas, minúsculas y números'
    );

/**
 * Schema de registro.
 * strip() ignora campos extra — previene mass assignment de campos como 'roles'.
 */
const registerSchema = z.object({
    name:            z.string().trim().min(1).max(100).optional(),
    email:           z.string({ required_error: 'El email es requerido' })
                      .email('Formato de email inválido')
                      .toLowerCase()
                      .trim(),
    password:        passwordSchema,
    passwordConfirm: z.string({ required_error: 'Confirma la contraseña' }),
}).strip().refine(
    data => data.password === data.passwordConfirm,
    { message: 'Las contraseñas no coinciden', path: ['passwordConfirm'] }
);

/** Schema de login — solo email y password, nada más. */
const loginSchema = z.object({
    email:    z.string({ required_error: 'El email es requerido' })
               .email('Formato de email inválido')
               .toLowerCase()
               .trim(),
    password: z.string({ required_error: 'La contraseña es requerida' })
               .min(1, 'La contraseña no puede estar vacía'),
}).strip();

// ─── Schemas de Finanzas Personales ───────────────────────────────────────────

/** Schema para crear transacción personal */
const createPersonalFinanceSchema = z.object({
    tipo: z.enum(TIPOS_BASE_ARRAY, { required_error: 'Tipo de transacción requerido' }),
    monto: z.number({ required_error: 'Monto requerido' }).positive('El monto debe ser positivo'),
    moneda: z.enum(Object.values(MONEDAS)).default('COP'),
    tasaCambio: z.number().positive().optional(),
    categoria: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de categoría inválido').optional(),
    cuentaOrigenId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de cuenta inválido').optional(),
    cuentaDestinoId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de cuenta inválido').optional(),
    metodoPago: z.enum(Object.values(METODOS_PAGO)).default('efectivo'),
    descripcion: z.string().trim().max(500).optional(),
    fecha: z.string().datetime().or(z.date()).optional(),
    estado: z.enum(Object.values(ESTADOS)).default('completado'),
    esAhorro: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
    esTransferenciaInterna: z.boolean().default(false),
    transferenciaId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
}).strip();

/** Schema para actualizar transacción personal */
const updatePersonalFinanceSchema = createPersonalFinanceSchema.partial();

/** Schema de query params para paginación/filtros */
const financeQuerySchema = z.object({
    page: z.string().or(z.number()).transform(v => parseInt(v)).default('1'),
    limit: z.string().or(z.number()).transform(v => parseInt(v)).default('20'),
    sort: z.string().optional(),
    tipo: z.enum(TIPOS_BASE_ARRAY).optional(),
    estado: z.enum(Object.values(ESTADOS)).optional(),
    fechaDesde: z.string().datetime().optional(),
    fechaHasta: z.string().datetime().optional(),
}).strip();

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Genera un middleware Express que valida req.body contra un schema Zod.
 * Si la validación pasa, reemplaza req.body con el valor parseado (sanitizado).
 * Si falla, pasa un AppError 400 con los mensajes de error al error handler.
 *
 * @param {z.ZodSchema} schema - Schema Zod a aplicar.
 * @returns {Function} Express middleware.
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), authController.register);
 */
function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            // Formatea errores de Zod en un array legible
            const errors = result.error.errors.map(e => ({
                field:   e.path.join('.'),
                message: e.message,
            }));

            return next(
                new AppError(
                    errors.map(e => e.message).join('. '),
                    400,
                    'VALIDATION_ERROR'
                )
            );
        }

        // Reemplaza req.body con el valor parseado — garantiza tipos correctos
        // y elimina campos no declarados en el schema (previene mass assignment)
        req.body = result.data;
        next();
    };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    validate,
    schemas: {
        register: registerSchema,
        login:    loginSchema,
        password: passwordSchema,
        personalFinance: {
            create: createPersonalFinanceSchema,
            update: updatePersonalFinanceSchema,
            query:  financeQuerySchema,
        },
    },
};