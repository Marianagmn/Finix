/**
 * Financial Analysis Service
 * Analyzes completed transactions for income/expense reporting
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
 * Analyzes financial data with defensive programming
 * Only processes 'completado' transactions, excludes transfers from calculations
 * @param {Array} data - Array of PersonalFinance documents (should be lean())
 * @returns {Object} Financial analysis results
 */
exports.analyze = (data) => {
    let totalIngresos = 0;
    let totalGastos = 0;
    const categorias = {};

    // Use for...of for better performance with large datasets
    for (const item of data) {
        // Skip non-completed transactions (pendiente, cancelado, etc.)
        if (!item.estado || item.estado !== ESTADOS.COMPLETADO) {
            continue;
        }

        // Defensive: ensure numeric value (handles null, undefined, string)
        const monto = Number(item.monto) || 0;

        // Only process valid transaction types
        if (item.tipo === TIPOS.INGRESO) {
            totalIngresos += monto;

        } else if (item.tipo === TIPOS.GASTO) {
            totalGastos += monto;

            // Normalize category (lowercase, fallback to 'sin_categoria')
            const categoria = item.categoria?.toString().toLowerCase() || 'sin_categoria';

            categorias[categoria] = (categorias[categoria] || 0) + monto;

        } // TRANSFERENCIA is intentionally excluded from income/expense calculations
    }

    const balance = totalIngresos - totalGastos;

    // Find highest spending category
    let categoriaMayor = null;
    let maxGasto = 0;

    for (const [cat, value] of Object.entries(categorias)) {
        if (value > maxGasto) {
            maxGasto = value;
            categoriaMayor = cat;
        }
    }

    return {
        totalIngresos,
        totalGastos,
        balance,
        categoriaMayorGasto: categoriaMayor,
        gastoPorCategoria: categorias,
        // Additional metrics for future expansion
        metricas: {
            totalTransacciones: data.length,
            ingresoPromedio: totalIngresos > 0 ? totalIngresos / Object.keys(categorias).length : 0,
            gastoPromedio: totalGastos > 0 ? totalGastos / Object.keys(categorias).length : 0
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