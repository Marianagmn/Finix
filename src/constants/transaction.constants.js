/**
 * @file transaction.constants.js
 * @description Constantes compartidas para transacciones financieras.
 * Usadas por PersonalFinance y BusinessFinance para mantener consistencia.
 */

'use strict';

/**
 * Tipos de transacción base (compartidos entre PersonalFinance y BusinessFinance)
 */
const TIPOS_BASE = {
    INGRESO: 'ingreso',
    GASTO: 'gasto',
    TRANSFERENCIA: 'transferencia'
};

/**
 * Tipos de transacción extendidos (BusinessFinance específicos)
 */
const TIPOS_EMPRESARIALES = {
    FACTURA_VENTA: 'factura_venta',
    FACTURA_COMPRA: 'factura_compra',
    NOTA_CREDITO: 'nota_credito',
    NOTA_DEBITO: 'nota_debito',
    NOMINA: 'nomina',
    ACTIVO_FIJO: 'activo_fijo',
    PROVISION: 'provision',
    AJUSTE_CONTABLE: 'ajuste_contable',
    ANTICIPO: 'anticipo',
    DEVOLUCION: 'devolucion'
};

/**
 * Todos los tipos de transacción (unión de base + empresariales)
 */
const TIPOS = {
    ...TIPOS_BASE,
    ...TIPOS_EMPRESARIALES
};

/**
 * Estados de transacción (empresarial completo)
 */
const ESTADOS = {
    BORRADOR: 'borrador',
    PENDIENTE_APROBACION: 'pendiente_aprobacion',
    APROBADO: 'aprobado',
    RECHAZADO: 'rechazado',
    CONTABILIZADO: 'contabilizado',
    COMPLETADO: 'completado',
    REVERTIDO: 'revertido'
};

/**
 * Estados de transacción para finanzas personales (subconjunto simplificado)
 */
const ESTADOS_PERSONALES = {
    PENDIENTE:  'pendiente',
    COMPLETADO: 'completado',
    CANCELADO:  'cancelado'
};

/**
 * Métodos de pago soportados
 */
const METODOS_PAGO = {
    EFECTIVO: 'efectivo',
    TRANSFERENCIA: 'transferencia',
    TARJETA_CREDITO: 'tarjeta_credito',
    TARJETA_DEBITO: 'tarjeta_debito',
    CHEQUE: 'cheque',
    OTRO: 'otro'
};

/**
 * Monedas soportadas
 */
const MONEDAS = {
    COP: 'COP',
    USD: 'USD',
    EUR: 'EUR'
};

/**
 * Clasificación de gastos para análisis de IA
 */
const CLASIFICACION_GASTOS = {
    vivienda: 'esencial',
    comida: 'esencial',
    alimentacion: 'esencial',
    transporte: 'esencial',
    servicios: 'esencial',
    salud: 'esencial',
    educacion: 'esencial',
    entretenimiento: 'discrecional',
    ocio: 'discrecional',
    compras: 'discrecional',
    shopping: 'discrecional',
    lujo: 'discrecional',
    restaurantes: 'discrecional',
    hobbies: 'discrecional'
};

/**
 * Frecuencias de recurrencia para transacciones programadas
 */
const FRECUENCIAS = {
    DIARIA: 'diaria',
    SEMANAL: 'semanal',
    QUINCENAL: 'quincenal',
    MENSUAL: 'mensual',
    BIMESTRAL: 'bimestral',
    TRIMESTRAL: 'trimestral',
    SEMESTRAL: 'semestral',
    ANUAL: 'anual'
};

/**
 * Razones de cambio para auditoría (audit trail)
 */
const RAZONES_CAMBIO = {
    CORRECCION_MANUAL: 'correccion_manual',
    AJUSTE_FISCAL: 'ajuste_fiscal',
    APROBACION: 'aprobacion',
    RECHAZO: 'rechazo',
    RENEGOCIACION: 'renegociacion',
    ERROR_SISTEMA: 'error_sistema',
    ACTUALIZACION_TASA: 'actualizacion_tasa',
    IMPORTACION: 'importacion',
    OTRO: 'otro'
};

/**
 * Fases del ciclo de vida de activos fijos
 */
const FASES_ACTIVO = {
    ADQUISICION: 'adquisicion',
    EN_USO: 'en_uso',
    DEPRECIANDO: 'depreciando',
    DADO_DE_BAJA: 'dado_de_baja'
};

/**
 * Array de tipos base para validaciones Mongoose (PersonalFinance, Category)
 */
const TIPOS_BASE_ARRAY = Object.values(TIPOS_BASE);

/**
 * Array de todos los tipos para validaciones Mongoose (BusinessFinance)
 */
const TIPOS_ARRAY = Object.values(TIPOS);

/**
 * Array de estados para validaciones Mongoose
 */
const ESTADOS_ARRAY = Object.values(ESTADOS);

/**
 * Array de estados personales para validaciones Mongoose
 */
const ESTADOS_PERSONALES_ARRAY = Object.values(ESTADOS_PERSONALES);

module.exports = {
    TIPOS,
    TIPOS_BASE,
    TIPOS_EMPRESARIALES,
    TIPOS_BASE_ARRAY,
    TIPOS_ARRAY,
    ESTADOS,
    ESTADOS_ARRAY,
    ESTADOS_PERSONALES,
    ESTADOS_PERSONALES_ARRAY,
    METODOS_PAGO,
    MONEDAS,
    CLASIFICACION_GASTOS,
    FRECUENCIAS,
    RAZONES_CAMBIO,
    FASES_ACTIVO
};
