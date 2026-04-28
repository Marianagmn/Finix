/**
 * Financial Analysis Service - Enterprise Grade
 * Analyzes completed transactions for income/expense reporting
 * Modular architecture with validation and correct calculations
 * @module services/financeAnalysis.service
 */

// Transaction type constants
const TIPOS = {
    INGRESO: 'ingreso',
    GASTO: 'gasto',
    TRANSFERENCIA: 'transferencia'
};

// Transaction status constants
const ESTADOS = {
    COMPLETADO: 'completado'
};

/**
 * Normalizes category strings consistently across all services
 * @param {*} cat - Raw category value
 * @returns {string} Normalized category
 */
const normalizarCategoria = (cat) => {
    if (!cat) return 'sin_categoria';
    return cat.toString().toLowerCase().trim().replace(/\s+/g, '_') || 'sin_categoria';
};

/**
 * Validates and filters transaction data
 * @param {Array} data - Raw transaction data
 * @returns {Object} Validated and separated transactions
 */
const procesarTransacciones = (data) => {
    const ingresos = [];
    const gastos = [];
    const categorias = {};

    for (const item of data) {
        // Skip non-completed transactions
        if (!item.estado || item.estado !== ESTADOS.COMPLETADO) {
            continue;
        }

        // Defensive: ensure numeric value
        const monto = Number(item.monto) || 0;
        if (monto <= 0) continue;

        // Process by transaction type
        if (item.tipo === TIPOS.INGRESO) {
            ingresos.push({ monto, item });
        } else if (item.tipo === TIPOS.GASTO) {
            gastos.push({ monto, item });

            // Normalize category consistently
            const categoria = normalizarCategoria(item.categoria);
            categorias[categoria] = (categorias[categoria] || 0) + monto;
        }
        // TRANSFERENCIA excluded from calculations
    }

    return { ingresos, gastos, categorias };
};

/**
 * Calculates category statistics
 * @param {Object} categorias - Category spending totals
 * @returns {Object} Category analysis results
 */
const analizarCategorias = (categorias) => {
    let categoriaMayor = null;
    let maxGasto = 0;

    for (const [cat, value] of Object.entries(categorias)) {
        if (value > maxGasto) {
            maxGasto = value;
            categoriaMayor = cat;
        }
    }

    return { categoriaMayor, maxGasto };
};

/**
 * Main analysis function with validation and correct calculations
 * FIX: Now correctly calculates averages by transaction count (not categories)
 * @param {Array} data - Array of PersonalFinance documents
 * @returns {Object} Financial analysis with consistent response format
 */
exports.analyze = (data) => {
    // FIX: Validate input
    if (!Array.isArray(data)) {
        return {
            success: false,
            message: 'Datos inválidos: se esperaba un array de transacciones'
        };
    }

    if (data.length === 0) {
        return {
            success: false,
            message: 'No hay datos para analizar'
        };
    }

    // Process transactions
    const { ingresos, gastos, categorias } = procesarTransacciones(data);

    // Calculate totals
    const totalIngresos = ingresos.reduce((sum, t) => sum + t.monto, 0);
    const totalGastos = gastos.reduce((sum, t) => sum + t.monto, 0);
    const balance = totalIngresos - totalGastos;

    // Analyze categories
    const { categoriaMayor } = analizarCategorias(categorias);

    // FIX: Correct average calculation by transaction count (not categories)
    const totalTransacciones = ingresos.length + gastos.length;

    return {
        success: true,
        data: {
            totalIngresos,
            totalGastos,
            balance,
            categoriaMayorGasto: categoriaMayor,
            gastoPorCategoria: categorias,
            conteos: {
                totalTransacciones,
                totalIngresos: ingresos.length,
                totalGastos: gastos.length,
                totalCategorias: Object.keys(categorias).length
            },
            // FIX: Calculate averages correctly by transaction count
            promedios: {
                ingresoPromedio: ingresos.length > 0 ? totalIngresos / ingresos.length : 0,
                gastoPromedio: gastos.length > 0 ? totalGastos / gastos.length : 0,
                transaccionPromedio: totalTransacciones > 0 ? (totalIngresos + totalGastos) / totalTransacciones : 0
            }
        }
    };
};

/**
 * MongoDB Aggregation Pipeline (recommended for production scale)
 * Moves computation to database for better performance with large datasets
 * 
 * Pipeline:
 * 1. Match only completed transactions for this user
 * 2. Group by type and sum amounts
 * 3. Group by category for expense breakdown
 * 
 * @example
 * const results = await PersonalFinance.aggregate([
 *   { $match: { userId: ObjectId(userId), estado: 'completado' } },
 *   { $group: { _id: '$tipo', total: { $sum: '$monto' } } }
 * ]);
 */
exports.aggregationPipeline = (userId) => [
    { $match: { userId: userId, estado: ESTADOS.COMPLETADO } },
    {
        $group: {
            _id: '$tipo',
            total: { $sum: '$monto' },
            count: { $sum: 1 }
        }
    }
];