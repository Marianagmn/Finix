/**
 * BusinessFinance Model
 * Enterprise-grade business financial transaction management
 *
 * Key extensions over PersonalFinance:
 *  - Fiscal/Tax engine: IVA, retefuente, reteIVA, reteICA, withholding matrix
 *  - DIAN e-invoicing: CUFE, QR, resolution range, document numbering sequences
 *  - Approval workflow: multi-level approval chains with role-based gates
 *  - Cost centers, departments, projects for management reporting
 *  - PUC (Plan Único de Cuentas) double-entry accounting integration
 *  - Accounts payable / receivable aging buckets
 *  - Recurring transactions with full schedule engine
 *  - Budget variance tracking per period
 *  - Multi-branch / multi-company support
 *  - Fixed-asset lifecycle (acquisition → depreciation → disposal)
 *  - Vendor / client (terceros) linkage
 *  - Full audit trail (capped at 100 entries) with change-reason codes
 *
 * Money convention: stored in cents (integer), exposed as decimal via getters/setters.
 * @module models/BusinessFinance
 */

'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

// ─── Enumeration Constants ────────────────────────────────────────────────────

/** Core transaction types */
const TIPOS = [
    'ingreso',              // Revenue / income
    'gasto',                // Expense / cost
    'transferencia',        // Inter-account transfer
    'factura_venta',        // Sales invoice (triggers DIAN e-invoice flow)
    'factura_compra',       // Purchase invoice
    'nota_credito',         // Credit note
    'nota_debito',          // Debit note
    'nomina',               // Payroll
    'activo_fijo',          // Fixed-asset acquisition / disposal
    'provision',            // Accounting provision / accrual
    'ajuste_contable',      // Manual journal entry / adjustment
    'anticipo',             // Advance payment (A/R or A/P)
    'devolucion',           // Return
];

/** Transaction lifecycle states */
const ESTADOS = [
    'borrador',             // Draft – not posted
    'pendiente_aprobacion', // Awaiting approval
    'aprobado',             // Approved but not yet posted
    'rechazado',            // Rejected in approval flow
    'contabilizado',        // Posted to ledger
    'anulado',              // Voided / reversed
    'en_disputa',           // Under dispute (A/P or A/R)
];

/** Payment methods */
const METODOS_PAGO = [
    'efectivo',
    'tarjeta_credito',
    'tarjeta_debito',
    'transferencia_bancaria',
    'cheque',
    'pse',
    'wallet',
    'credito_comercial',    // Net-30/60/90 trade credit
    'compensacion',         // Offset / netting
];

/** Supported currencies */
const MONEDAS = ['COP', 'USD', 'EUR', 'GBP', 'MXN', 'BRL'];

/** IVA tariff rates (Colombian tax law) */
const TARIFAS_IVA = [0, 5, 19];

/** Retefuente percentage base values (most common; extendable) */
const TARIFAS_RETEFUENTE = [0, 0.1, 1, 1.5, 2, 2.5, 3.5, 4, 6, 7, 10, 11, 15, 20, 33];

/** Recurrence frequencies for scheduled transactions */
const FRECUENCIAS = ['diaria', 'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'];

/** Reason codes tracked in audit history */
const RAZONES_CAMBIO = [
    'correccion_manual',
    'ajuste_fiscal',
    'aprobacion',
    'rechazo',
    'renegociacion',
    'error_sistema',
    'actualizacion_tasa',
    'importacion',
    'otro',
];

/** Asset lifecycle phases */
const FASES_ACTIVO = ['adquisicion', 'en_uso', 'depreciando', 'dado_de_baja'];

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

/**
 * DIAN e-invoicing metadata (applies to factura_venta / nota_credito / nota_debito).
 * https://www.dian.gov.co/impuestos/factura-electronica
 */
const dianSchema = new Schema({
    // Unique Invoice / Credit-Note ID issued by DIAN upon validation
    cufe: { type: String, sparse: true },
    // QR code data-string (encoded URL pointing to DIAN consultation portal)
    qr: String,
    // Resolution number granted by DIAN for the invoice range
    numeroResolucion: String,
    // Date resolution was granted
    fechaResolucion: Date,
    // First valid consecutive number in the resolution range
    rangoInicial: Number,
    // Last valid consecutive number in the resolution range
    rangoFinal: Number,
    // Prefix (e.g. 'FV', 'FE', 'NC')
    prefijo: { type: String, uppercase: true },
    // Consecutive number within the authorised range
    consecutivo: Number,
    // Technical key issued by DIAN (used for CUFE hash)
    claveTecnica: String,
    // Status returned by DIAN validation service
    estadoDIAN: {
        type: String,
        enum: ['pendiente', 'aceptada', 'rechazada', 'contingencia'],
        default: 'pendiente',
    },
    // Full DIAN XML response payload (store compressed or reference S3 key)
    xmlRespuesta: String,
    // Timestamp of last DIAN sync
    ultimaSincronizacion: Date,
}, { _id: false });

/**
 * Tax breakdown — individual tax line (supports multiple taxes per transaction).
 */
const impuestoSchema = new Schema({
    tipo: {
        type: String,
        enum: ['iva', 'retefuente', 'reteiva', 'reteica', 'ica', 'cree', 'otro'],
        required: true,
    },
    tarifa: { type: Number, required: true },         // Percentage (e.g. 19 for 19%)
    base: { type: Number, required: true, min: 0 },   // Taxable base in cents
    valor: { type: Number, required: true, min: 0 },  // Computed tax amount in cents
    concepto: String,                                  // Free-text description (DIAN codes)
    cuentaContable: String,                            // PUC account code for this tax line
}, { _id: false });

/**
 * Approval step — one node in the multi-level approval chain.
 */
const aprobacionSchema = new Schema({
    nivel: { type: Number, required: true },
    aprobadorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rol: String,                                        // e.g. 'gerente_financiero'
    estado: {
        type: String,
        enum: ['pendiente', 'aprobado', 'rechazado', 'delegado'],
        default: 'pendiente',
    },
    comentario: { type: String, maxlength: 500 },
    fecha: Date,
    // If delegated, who took over
    delegadoA: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: true });

/**
 * Recurrence configuration for scheduled / standing transactions.
 */
const recurrenciaSchema = new Schema({
    frecuencia: { type: String, enum: FRECUENCIAS, required: true },
    // Day-of-month (1-31) or day-of-week (0=Sun…6=Sat) depending on frequency
    diaCiclo: Number,
    fechaInicio: { type: Date, required: true },
    fechaFin: Date,                                     // null = indefinite
    totalOcurrencias: Number,                           // null = indefinite
    ocurrenciasEjecutadas: { type: Number, default: 0 },
    proximaEjecucion: Date,
    activa: { type: Boolean, default: true },
    // Array of child transaction IDs generated by this schedule
    transaccionesGeneradas: [{ type: Schema.Types.ObjectId, ref: 'BusinessFinance' }],
}, { _id: false });

/**
 * Budget variance — links the transaction to an approved budget line.
 */
const presupuestoSchema = new Schema({
    presupuestoId: { type: Schema.Types.ObjectId, ref: 'Budget', required: true },
    lineaPresupuestalId: Schema.Types.ObjectId,
    montoPresupuestado: Number,                         // In cents
    montoEjecutado: Number,                             // Running total in cents
    variacion: Number,                                  // montoEjecutado - montoPresupuestado
    porcentajeEjecucion: Number,                        // 0-100
}, { _id: false });

/**
 * Fixed-asset metadata (populated only when tipo === 'activo_fijo').
 */
const activoFijoSchema = new Schema({
    fase: { type: String, enum: FASES_ACTIVO, default: 'adquisicion' },
    codigoActivo: { type: String, unique: true, sparse: true },
    vidaUtilAnios: Number,
    metodoDepreciacion: {
        type: String,
        enum: ['linea_recta', 'saldo_decreciente', 'unidades_produccion'],
        default: 'linea_recta',
    },
    valorResidual: Number,                              // In cents
    depreciacionAcumulada: { type: Number, default: 0 },
    fechaAdquisicion: Date,
    fechaBajaActivo: Date,
    valorBaja: Number,
    proveedorId: { type: Schema.Types.ObjectId, ref: 'Tercero' },
    ubicacion: String,
    numeroSerie: String,
}, { _id: false });

/**
 * Accounts receivable / payable aging bucket snapshot (denormalised for performance).
 */
const vencimientoSchema = new Schema({
    fechaVencimiento: Date,
    montoPendiente: Number,                             // In cents
    diasVencido: Number,                                // Negative = not yet due
    bucket: {
        type: String,
        enum: ['corriente', 'vencido_30', 'vencido_60', 'vencido_90', 'vencido_mas_90'],
    },
    recordatoriosEnviados: { type: Number, default: 0 },
    ultimoRecordatorio: Date,
}, { _id: false });

/**
 * Accounting entry line (PUC double-entry).
 */
const asientoLineaSchema = new Schema({
    cuentaPUC: { type: String, required: true },        // e.g. '130505'
    nombreCuenta: String,
    debito: { type: Number, default: 0 },               // In cents
    credito: { type: Number, default: 0 },              // In cents
    terceroId: { type: Schema.Types.ObjectId, ref: 'Tercero' },
    centroCostoId: { type: Schema.Types.ObjectId, ref: 'CostCenter' },
    descripcion: String,
}, { _id: false });

// ─── Main Schema ──────────────────────────────────────────────────────────────

const businessFinanceSchema = new Schema({

    // ── Ownership & Organisation ─────────────────────────────────────────────

    /** Business / tenant identifier (multi-company support) */
    businessId: {
        type: Schema.Types.ObjectId,
        ref: 'Business',
        required: true,
        index: true,
    },

    /** Branch or physical location within the business */
    sucursalId: {
        type: Schema.Types.ObjectId,
        ref: 'Branch',
        index: true,
    },

    /** User who created / owns this record */
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },

    // ── Core Transaction Fields ──────────────────────────────────────────────

    tipo: {
        type: String,
        enum: TIPOS,
        required: true,
        index: true,
    },

    /**
     * Gross amount before taxes, stored in cents.
     * set/get handle decimal ↔ cent conversion transparently.
     */
    monto: {
        type: Number,
        required: true,
        min: [1, 'El monto debe ser mayor a 0'],
        set: v => Math.round(v * 100),
        get: v => v / 100,
    },

    /** Net amount (monto minus deductible taxes), stored in cents */
    montoNeto: {
        type: Number,
        min: 0,
        set: v => Math.round(v * 100),
        get: v => v / 100,
    },

    /** Total taxes sum, stored in cents */
    totalImpuestos: {
        type: Number,
        default: 0,
        set: v => Math.round(v * 100),
        get: v => v / 100,
    },

    moneda: {
        type: String,
        enum: MONEDAS,
        default: 'COP',
    },

    /** Exchange rate to COP at transaction date */
    tasaCambio: {
        type: Number,
        default: 1,
        min: [0.000001, 'La tasa de cambio debe ser positiva'],
    },

    /** Amount expressed in COP (monto × tasaCambio), stored in cents */
    montoCOP: {
        type: Number,
        set: v => Math.round(v * 100),
        get: v => v / 100,
    },

    categoria: {
        type: Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
        index: true,
    },

    /** PUC code for the main debit / credit account */
    cuentaContablePrincipal: {
        type: String,
        match: [/^\d{4,8}$/, 'Código PUC inválido'],
    },

    /** Full double-entry accounting lines for ledger posting */
    asientoContable: [asientoLineaSchema],

    /** Source / origin account (required for gastos, transferencias) */
    cuentaOrigenId: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: function () {
            return ['gasto', 'transferencia', 'factura_compra', 'nomina'].includes(this.tipo);
        },
    },

    /** Destination account (required for ingresos, transferencias) */
    cuentaDestinoId: {
        type: Schema.Types.ObjectId,
        ref: 'Account',
        required: function () {
            return ['ingreso', 'transferencia', 'factura_venta', 'anticipo'].includes(this.tipo);
        },
    },

    metodoPago: {
        type: String,
        enum: METODOS_PAGO,
        default: 'efectivo',
    },

    descripcion: {
        type: String,
        trim: true,
        maxlength: 500,
    },

    fecha: {
        type: Date,
        default: () => new Date(),
        index: true,
    },

    /** Accounting / posting date (may differ from transaction date) */
    fechaContabilizacion: {
        type: Date,
        index: true,
    },

    estado: {
        type: String,
        enum: ESTADOS,
        default: 'borrador',
        index: true,
    },

    // ── Fiscal Period ────────────────────────────────────────────────────────

    ejercicioFiscal: {
        type: Number,
        required: true,
        min: 2000,
        max: 2099,
        default: () => new Date().getFullYear(),
    },

    /** Accounting period (1–12) within the fiscal year */
    periodoContable: {
        type: Number,
        min: 1,
        max: 12,
        default: () => new Date().getMonth() + 1,
    },

    /** Flag to prevent modifications once the period is closed */
    periodoContableCerrado: {
        type: Boolean,
        default: false,
    },

    // ── Tax Engine ───────────────────────────────────────────────────────────

    /** Detailed tax breakdown — one entry per tax type applied */
    impuestos: [impuestoSchema],

    /** Convenience: IVA rate applied (0, 5, 19) */
    tarifaIVA: {
        type: Number,
        enum: TARIFAS_IVA,
        default: 0,
    },

    /** Whether this transaction is eligible for IVA input tax credit */
    ivaDescontable: {
        type: Boolean,
        default: false,
    },

    /** Retefuente withholding percentage */
    tarifaRetefuente: {
        type: Number,
        enum: TARIFAS_RETEFUENTE,
        default: 0,
    },

    /** ReteICA percentage (municipal industry & commerce withholding) */
    tarifaReteICA: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },

    /** ReteIVA percentage (4.14% by default for taxable goods/services) */
    tarifaReteIVA: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },

    // ── DIAN E-Invoicing ─────────────────────────────────────────────────────

    dian: dianSchema,

    /** Supporting document reference (factura soporte for informal vendors) */
    facturaElectronica: {
        type: Boolean,
        default: false,
    },

    // ── Document Reference ───────────────────────────────────────────────────

    /** External document number (invoice #, receipt #, etc.) */
    numeroDocumento: {
        type: String,
        trim: true,
        index: true,
    },

    tipoDocumento: {
        type: String,
        enum: [
            'factura',
            'nota_credito',
            'nota_debito',
            'recibo_caja',
            'comprobante_egreso',
            'orden_compra',
            'contrato',
            'otro',
        ],
    },

    /** File references (S3 keys or URLs) for attached supporting documents */
    documentosSoporte: [{
        nombre: String,
        url: String,
        tipo: String,                                   // MIME type
        fechaSubida: { type: Date, default: Date.now },
    }],

    // ── Vendor / Client (Terceros) ───────────────────────────────────────────

    terceroId: {
        type: Schema.Types.ObjectId,
        ref: 'Tercero',
        index: true,
    },

    tipoTercero: {
        type: String,
        enum: ['proveedor', 'cliente', 'empleado', 'accionista', 'entidad_publica', 'otro'],
    },

    // ── Cost Allocation ──────────────────────────────────────────────────────

    /** Cost center assignment */
    centroCostoId: {
        type: Schema.Types.ObjectId,
        ref: 'CostCenter',
        index: true,
    },

    /** Department */
    departamentoId: {
        type: Schema.Types.ObjectId,
        ref: 'Department',
        index: true,
    },

    /** Project allocation */
    proyectoId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        index: true,
    },

    /** Percentage of total amount allocated to above cost center (0-100) */
    porcentajeAsignacion: {
        type: Number,
        default: 100,
        min: 0,
        max: 100,
    },

    // ── Budget ───────────────────────────────────────────────────────────────

    presupuesto: presupuestoSchema,

    // ── Approval Workflow ────────────────────────────────────────────────────

    cadenaAprobacion: [aprobacionSchema],

    /** Required approval level to post this transaction (based on amount thresholds) */
    nivelAprobacionRequerido: {
        type: Number,
        default: 0,                                     // 0 = no approval needed
    },

    /** Current approval level reached */
    nivelAprobacionActual: {
        type: Number,
        default: 0,
    },

    // ── Recurrence ───────────────────────────────────────────────────────────

    esRecurrente: {
        type: Boolean,
        default: false,
        index: true,
    },

    recurrencia: recurrenciaSchema,

    /** Reference to parent recurrence template (if this is a generated child) */
    transaccionOrigenId: {
        type: Schema.Types.ObjectId,
        ref: 'BusinessFinance',
    },

    // ── A/R & A/P ────────────────────────────────────────────────────────────

    esCuentaPorCobrar: {
        type: Boolean,
        default: false,
        index: true,
    },

    esCuentaPorPagar: {
        type: Boolean,
        default: false,
        index: true,
    },

    vencimiento: vencimientoSchema,

    /** Partial payment tracking: array of payment application records */
    pagosAplicados: [{
        pagoId: { type: Schema.Types.ObjectId, ref: 'BusinessFinance' },
        monto: Number,                                  // In cents
        fecha: { type: Date, default: Date.now },
    }],

    /** Remaining open balance (for A/R or A/P), stored in cents */
    saldoPendiente: {
        type: Number,
        default: 0,
        set: v => Math.round(v * 100),
        get: v => v / 100,
    },

    // ── Fixed Assets ─────────────────────────────────────────────────────────

    activoFijo: activoFijoSchema,

    // ── Transfer & Internal Flags ────────────────────────────────────────────

    /** Excludes this transaction from P&L to avoid double-counting inter-account moves */
    esTransferenciaInterna: {
        type: Boolean,
        default: false,
    },

    transferenciaId: {
        type: Schema.Types.ObjectId,
        ref: 'BusinessFinance',
    },

    // ── Source & Savings ─────────────────────────────────────────────────────

    source: {
        type: String,
        enum: ['manual', 'ia', 'importado', 'api', 'recurrente', 'integracion_bancaria'],
        default: 'manual',
    },

    esAhorro: {
        type: Boolean,
        default: false,
    },

    // ── Location ─────────────────────────────────────────────────────────────

    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
        },
        coordinates: {
            type: [Number],
            validate: {
                validator: function (v) {
                    if (!v || v.length === 0) return true;
                    return v.length === 2 &&
                        v[0] >= -180 && v[0] <= 180 &&
                        v[1] >= -90 && v[1] <= 90;
                },
                message: 'Coordenadas inválidas',
            },
        },
        address: String,
    },

    // ── Tags ─────────────────────────────────────────────────────────────────

    tags: [{
        type: String,
        lowercase: true,
        trim: true,
    }],

    // ── AI Metadata ──────────────────────────────────────────────────────────

    aiMetadata: {
        clasificacion: {
            categoriaSugerida: String,
            confianza: Number,                          // 0-1
        },
        analisis: {
            patronDetectado: String,
            alerta: String,
            anomalia: Boolean,
        },
        predicciones: {
            gastoMensual: Number,
            riesgoLiquidez: Number,                     // 0-1 score
        },
        conciliacion: {
            matchBancario: Boolean,
            idExtractoId: String,
            fechaConciliacion: Date,
        },
    },

    // ── Reversal ─────────────────────────────────────────────────────────────

    /** Set when this transaction reverses / voids a previous one */
    transaccionReversadaId: {
        type: Schema.Types.ObjectId,
        ref: 'BusinessFinance',
    },

    esReverso: {
        type: Boolean,
        default: false,
    },

    motivoAnulacion: {
        type: String,
        maxlength: 500,
    },

    // ── Audit Trail ──────────────────────────────────────────────────────────

    historialCambios: [{
        campo: String,
        valorAnterior: Schema.Types.Mixed,
        valorNuevo: Schema.Types.Mixed,
        modificadoPor: { type: Schema.Types.ObjectId, ref: 'User' },
        razonCambio: { type: String, enum: RAZONES_CAMBIO, default: 'correccion_manual' },
        ipOrigen: String,
        fecha: { type: Date, default: Date.now },
    }],

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // ── Soft Delete ──────────────────────────────────────────────────────────

    /** Financial records must never be hard-deleted; use softDelete() instead */
    isDeleted: {
        type: Boolean,
        default: false,
        index: true,
    },

    deletedAt: Date,
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // ── Free-text Note ───────────────────────────────────────────────────────

    notaTransaccion: {
        type: String,
        maxlength: 1000,
    },

}, {
    timestamps: true,
    toJSON:   { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true },
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Core query patterns
businessFinanceSchema.index({ businessId: 1, estado: 1, fecha: -1 });
businessFinanceSchema.index({ businessId: 1, fecha: -1 });
businessFinanceSchema.index({ businessId: 1, tipo: 1, fecha: -1 });
businessFinanceSchema.index({ businessId: 1, categoria: 1, fecha: -1 });
businessFinanceSchema.index({ businessId: 1, terceroId: 1, fecha: -1 });
businessFinanceSchema.index({ businessId: 1, userId: 1, fecha: -1 });

// Fiscal / period queries
businessFinanceSchema.index({ businessId: 1, ejercicioFiscal: 1, periodoContable: 1 });

// Cost allocation reporting
businessFinanceSchema.index({ businessId: 1, centroCostoId: 1, fecha: -1 });
businessFinanceSchema.index({ businessId: 1, proyectoId: 1, fecha: -1 });

// A/R & A/P management
businessFinanceSchema.index({ businessId: 1, esCuentaPorCobrar: 1, 'vencimiento.fechaVencimiento': 1 });
businessFinanceSchema.index({ businessId: 1, esCuentaPorPagar: 1, 'vencimiento.fechaVencimiento': 1 });

// Approval workflow
businessFinanceSchema.index({ businessId: 1, estado: 1, nivelAprobacionActual: 1 });

// Recurrence engine
businessFinanceSchema.index({ esRecurrente: 1, 'recurrencia.proximaEjecucion': 1, 'recurrencia.activa': 1 });

// Internal-transfer exclusion for analytics
businessFinanceSchema.index({ businessId: 1, estado: 1, esTransferenciaInterna: 1, fecha: -1 });

// DIAN doc-number lookups
businessFinanceSchema.index({ businessId: 1, 'dian.prefijo': 1, 'dian.consecutivo': 1 }, { unique: true, sparse: true });
businessFinanceSchema.index({ numeroDocumento: 1, businessId: 1 });

// Geospatial
businessFinanceSchema.index({ location: '2dsphere' });

// ─── Static Helpers ───────────────────────────────────────────────────────────

/** Convert a decimal monetary value to cents (integer) */
businessFinanceSchema.statics.toCents = (value) => Math.round(value * 100);

/** Convert cents back to a decimal with 2dp */
businessFinanceSchema.statics.fromCents = (value) => value / 100;

/**
 * Determine the approval level required for a given amount in COP.
 * Thresholds should ideally live in a configurable collection; hardcoded here as sensible defaults.
 */
businessFinanceSchema.statics.nivelAprobacionPorMonto = (montoCOP) => {
    if (montoCOP < 500_000)         return 0; // No approval required
    if (montoCOP < 5_000_000)       return 1; // Supervisor
    if (montoCOP < 50_000_000)      return 2; // Manager
    if (montoCOP < 500_000_000)     return 3; // Director
    return 4;                                  // C-Suite / board
};

// ─── Virtuals ─────────────────────────────────────────────────────────────────

/** True if every required approval step has been completed */
businessFinanceSchema.virtual('estaAprobado').get(function () {
    if (this.nivelAprobacionRequerido === 0) return true;
    return this.cadenaAprobacion
        .filter(a => a.nivel <= this.nivelAprobacionRequerido)
        .every(a => a.estado === 'aprobado');
});

/** True if the document has been fully paid (saldoPendiente rounds to 0) */
businessFinanceSchema.virtual('estaPagado').get(function () {
    return Math.round((this.saldoPendiente || 0) * 100) === 0;
});

/** Human-readable display label combining type and document number */
businessFinanceSchema.virtual('etiqueta').get(function () {
    const prefix = this.dian?.prefijo || this.tipoDocumento || this.tipo;
    const consec = this.dian?.consecutivo || this.numeroDocumento || '';
    return consec ? `${prefix}-${consec}` : prefix;
});

// ─── Pre-validate Hook ────────────────────────────────────────────────────────

businessFinanceSchema.pre('validate', function (next) {

    // Transferencia integrity
    if (this.tipo === 'transferencia') {
        if (!this.descripcion)
            return next(new Error('Las transferencias requieren descripción'));
        if (!this.transferenciaId)
            return next(new Error('Transferencia debe estar vinculada'));
        if (this.cuentaOrigenId?.toString() === this.cuentaDestinoId?.toString())
            return next(new Error('Cuenta origen y destino no pueden ser iguales'));
    }

    // Basic account requirements
    const tiposGasto = ['gasto', 'factura_compra', 'nomina', 'activo_fijo'];
    if (tiposGasto.includes(this.tipo) && !this.cuentaOrigenId)
        return next(new Error(`${this.tipo} requiere cuenta origen`));

    const tiposIngreso = ['ingreso', 'factura_venta', 'anticipo'];
    if (tiposIngreso.includes(this.tipo) && !this.cuentaDestinoId)
        return next(new Error(`${this.tipo} requiere cuenta destino`));

    // Currency validation
    if (this.moneda !== 'COP' && (!this.tasaCambio || this.tasaCambio <= 0))
        return next(new Error('Tasa de cambio inválida para moneda extranjera'));

    // DIAN mandatory fields for electronic invoices
    if (this.facturaElectronica && this.tipo === 'factura_venta') {
        if (!this.terceroId)
            return next(new Error('Factura electrónica requiere tercero (cliente)'));
        if (!this.dian?.numeroResolucion)
            return next(new Error('Factura electrónica requiere resolución DIAN'));
    }

    // Prevent modifications on posted transactions (only reversals allowed)
    if (this.isModified() && this.estado === 'contabilizado' && !this.isNew) {
        const allowedFields = new Set(['historialCambios', 'updatedAt', 'updatedBy', 'aiMetadata']);
        const modifiedRestricted = this.modifiedPaths().some(p => !allowedFields.has(p));
        if (modifiedRestricted)
            return next(new Error('No se puede modificar una transacción contabilizada. Use un reverso.'));
    }

    // Closed period guard
    if (this.periodoContableCerrado && this.isModified('monto'))
        return next(new Error('El periodo contable está cerrado'));

    next();
});

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

businessFinanceSchema.pre('save', function (next) {
    if (!this.isModified()) return next();

    // ── Auto-compute derived monetary fields ─────────────────────────────────
    if (this.isModified('monto') || this.isModified('impuestos') || this.isModified('tasaCambio')) {
        const totalTaxCents = (this.impuestos || []).reduce((acc, t) => acc + (t.valor || 0), 0);
        this.totalImpuestos = totalTaxCents / 100;

        const brutoEnCents = Math.round((this.monto || 0) * 100);
        this.montoNeto = (brutoEnCents - totalTaxCents) / 100;

        // COP equivalent
        this.montoCOP = ((this.monto || 0) * (this.tasaCambio || 1));
    }

    // ── Set A/R or A/P flag based on type ────────────────────────────────────
    if (this.isNew) {
        if (['factura_venta', 'anticipo'].includes(this.tipo)) {
            this.esCuentaPorCobrar = true;
            if (!this.saldoPendiente) this.saldoPendiente = this.monto || 0;
        }
        if (['factura_compra', 'nomina'].includes(this.tipo)) {
            this.esCuentaPorPagar = true;
            if (!this.saldoPendiente) this.saldoPendiente = this.monto || 0;
        }
    }

    // ── Required approval level ───────────────────────────────────────────────
    if (this.isNew || this.isModified('monto')) {
        const montoCOP = (this.monto || 0) * (this.tasaCambio || 1);
        this.nivelAprobacionRequerido = this.constructor.nivelAprobacionPorMonto(montoCOP);
    }

    // ── Audit trail cap (MongoDB 16 MB doc limit) ─────────────────────────────
    if (this.historialCambios.length > 100) {
        this.historialCambios = this.historialCambios.slice(-100);
    }

    // ── Record field changes ──────────────────────────────────────────────────
    if (!this.$__.original) {
        this.$__.original = this.toObject({ depopulate: true });
    }
    const original = this.$__.original;

    this.modifiedPaths().forEach(field => {
        if (!['historialCambios', 'updatedAt', 'updatedBy'].includes(field)) {
            this.historialCambios.push({
                campo:          field,
                valorAnterior:  original[field],
                valorNuevo:     this.get(field),
                fecha:          new Date(),
            });
        }
    });

    next();
});

// ─── Query Middleware ─────────────────────────────────────────────────────────

/** Auto-exclude soft-deleted documents from all find queries */
businessFinanceSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

/** Auto-exclude soft-deleted documents from aggregation pipelines */
businessFinanceSchema.pre('aggregate', function (next) {
    const pipeline = this.pipeline();
    const isGeoNear = pipeline.length && pipeline[0].$geoNear;

    if (isGeoNear) {
        pipeline.splice(1, 0, { $match: { isDeleted: false } });
    } else {
        pipeline.unshift({ $match: { isDeleted: false } });
    }

    next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

/**
 * Soft-delete the record (financial records must never be hard-deleted).
 * @param {ObjectId} userId - Who is performing the deletion
 */
businessFinanceSchema.methods.softDelete = function (userId) {
    this.isDeleted  = true;
    this.deletedAt  = new Date();
    this.deletedBy  = userId;
    return this.save();
};

/**
 * Advance the approval chain by one level.
 * @param {ObjectId} aprobadorId
 * @param {String}  comentario
 * @returns {Promise<Document>}
 */
businessFinanceSchema.methods.aprobar = function (aprobadorId, comentario = '') {
    const siguiente = this.cadenaAprobacion.find(
        a => a.estado === 'pendiente' && a.nivel === this.nivelAprobacionActual + 1
    );

    if (!siguiente)
        throw new Error('No hay pasos de aprobación pendientes');

    siguiente.estado    = 'aprobado';
    siguiente.comentario = comentario;
    siguiente.fecha     = new Date();
    this.nivelAprobacionActual = siguiente.nivel;

    if (this.nivelAprobacionActual >= this.nivelAprobacionRequerido) {
        this.estado = 'aprobado';
    }

    return this.save();
};

/**
 * Reject the transaction at the current approval level.
 * @param {ObjectId} aprobadorId
 * @param {String}  motivo
 */
businessFinanceSchema.methods.rechazar = function (aprobadorId, motivo = '') {
    const pendiente = this.cadenaAprobacion.find(a => a.estado === 'pendiente');
    if (!pendiente)
        throw new Error('No hay aprobaciones pendientes para rechazar');

    pendiente.estado     = 'rechazado';
    pendiente.comentario = motivo;
    pendiente.fecha      = new Date();
    this.estado          = 'rechazado';

    return this.save();
};

/**
 * Post the transaction to the accounting ledger.
 * Validates approval state and sets fechaContabilizacion.
 */
businessFinanceSchema.methods.contabilizar = function () {
    if (!this.estaAprobado)
        throw new Error('La transacción debe estar aprobada antes de contabilizarse');

    if (this.estado === 'contabilizado')
        throw new Error('La transacción ya está contabilizada');

    if (this.periodoContableCerrado)
        throw new Error('El periodo contable está cerrado');

    this.estado                = 'contabilizado';
    this.fechaContabilizacion  = new Date();

    return this.save();
};

/**
 * Apply a partial or full payment against an open A/R or A/P document.
 * @param {ObjectId} pagoId    - ID of the payment transaction being applied
 * @param {Number}   monto     - Payment amount in decimal (e.g. 150000.00)
 * @returns {Promise<Document>}
 */
businessFinanceSchema.methods.aplicarPago = function (pagoId, monto) {
    const montoCents   = Math.round(monto * 100);
    const saldoCents   = Math.round((this.saldoPendiente || 0) * 100);

    if (montoCents > saldoCents)
        throw new Error('El monto del pago excede el saldo pendiente');

    this.pagosAplicados.push({ pagoId, monto: montoCents, fecha: new Date() });
    this.saldoPendiente = (saldoCents - montoCents) / 100;

    return this.save();
};

/**
 * Generate a reversal (counter-entry) transaction document (not saved automatically).
 * The caller is responsible for saving both the reversal and calling softDelete() on this one.
 * @param {ObjectId} userId
 * @param {String}   motivo
 * @returns {Document} unsaved reversal BusinessFinance document
 */
businessFinanceSchema.methods.generarReverso = function (userId, motivo = '') {
    const BusinessFinance = this.constructor;

    const datosReverso = this.toObject();
    delete datosReverso._id;
    delete datosReverso.createdAt;
    delete datosReverso.updatedAt;
    delete datosReverso.historialCambios;
    delete datosReverso.dian;

    datosReverso.esReverso              = true;
    datosReverso.transaccionReversadaId = this._id;
    datosReverso.estado                 = 'borrador';
    datosReverso.motivoAnulacion        = motivo;
    datosReverso.createdBy              = userId;
    datosReverso.fecha                  = new Date();
    datosReverso.fechaContabilizacion   = null;
    datosReverso.monto                  = this.monto;      // Getter already converts from cents

    // Swap debit/credit on accounting lines
    datosReverso.asientoContable = (datosReverso.asientoContable || []).map(linea => ({
        ...linea,
        debito:  linea.credito,
        credito: linea.debito,
    }));

    return new BusinessFinance(datosReverso);
};

/**
 * Calculate tax amounts and populate the impuestos array.
 * Call this before saving when fiscal fields change.
 *
 * @param {Number} baseImponible - Gross taxable base in decimal COP
 */
businessFinanceSchema.methods.calcularImpuestos = function (baseImponible) {
    const baseEnCents = Math.round(baseImponible * 100);
    this.impuestos = [];

    if (this.tarifaIVA > 0) {
        const valor = Math.round(baseEnCents * this.tarifaIVA / 100);
        this.impuestos.push({ tipo: 'iva', tarifa: this.tarifaIVA, base: baseEnCents, valor, cuentaContable: '240805' });
    }

    if (this.tarifaRetefuente > 0) {
        const valor = Math.round(baseEnCents * this.tarifaRetefuente / 100);
        this.impuestos.push({ tipo: 'retefuente', tarifa: this.tarifaRetefuente, base: baseEnCents, valor, cuentaContable: '236540' });
    }

    if (this.tarifaReteIVA > 0) {
        const baseIVA = Math.round(baseEnCents * this.tarifaIVA / 100);
        const valor   = Math.round(baseIVA * this.tarifaReteIVA / 100);
        this.impuestos.push({ tipo: 'reteiva', tarifa: this.tarifaReteIVA, base: baseIVA, valor, cuentaContable: '236701' });
    }

    if (this.tarifaReteICA > 0) {
        const valor = Math.round(baseEnCents * this.tarifaReteICA / 100);
        this.impuestos.push({ tipo: 'reteica', tarifa: this.tarifaReteICA, base: baseEnCents, valor, cuentaContable: '236801' });
    }

    return this;
};

module.exports = mongoose.model('BusinessFinance', businessFinanceSchema);