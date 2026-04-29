/**
 * Prediction Service - Senior Level (Fintech/AI Grade)
 * Predicts future spending with time-series analysis and linear regression
 * @module services/prediction.service
 */

const { TIPOS, ESTADOS } = require('../constants/transaction.constants');
const { normalizarCategoria } = require('../utils/category.utils');
const { esGastoValido, extraerMonto, extraerFecha } = require('../utils/filter.utils');

/**
 * Calculates linear regression slope using REAL TIME (timestamps)
 * More accurate than using array indices for irregularly-spaced transactions
 * @param {Array} values - Array of numeric values (montos)
 * @param {Array} timestamps - Array of timestamps in milliseconds
 * @returns {number} Slope: change in value per day (positive = increasing)
 */
const calcularTendenciaRegresion = (values, timestamps) => {
    const n = values.length;
    if (n < 2 || timestamps.length !== n) return 0;

    // Normalize timestamps to days from first transaction for numerical stability
    const baseTime = timestamps[0];
    const x = timestamps.map(t => (t - baseTime) / (1000 * 60 * 60 * 24)); // days

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * values[i], 0);
    const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

    const denominador = n * sumX2 - sumX * sumX;
    if (denominador === 0) return 0;

    // Returns change in value per day
    return (n * sumXY - sumX * sumY) / denominador;
};

/**
 * Calculates standard deviation (volatility)
 * @param {Array} values - Array of numeric values
 * @param {number} mean - Average value
 * @returns {number} Standard deviation
 */
const calcularDesviacion = (values, mean) => {
    const n = values.length;
    if (n === 0) return 0;

    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    return Math.sqrt(variance);
};

/**
 * Calculates median days between transactions (more robust than mean)
 * Median is resistant to large temporal gaps (outliers in time)
 * @param {Array} fechas - Array of Date objects
 * @returns {number} Median days between transactions
 */
const calcularFrecuenciaMediana = (fechas) => {
    if (fechas.length < 2) return 0;

    const diffs = [];
    for (let i = 1; i < fechas.length; i++) {
        const diff = (fechas[i] - fechas[i - 1]) / (1000 * 60 * 60 * 24);
        diffs.push(diff);
    }

    diffs.sort((a, b) => a - b);
    const mid = Math.floor(diffs.length / 2);

    // Median calculation
    return diffs.length % 2 !== 0
        ? diffs[mid]
        : (diffs[mid - 1] + diffs[mid]) / 2;
};

/**
 * Predicts next expense with time-series analysis
 * Uses linear regression for real trend detection
 * Considers transaction frequency and volatility
 * @param {Array} data - Array of PersonalFinance documents
 * @returns {Object} Prediction with trend analysis and volatility metrics
 */
/**
 * Predicts next expense with time-series analysis using MongoDB aggregation
 * Optimized for large datasets - processes only last 1000 transactions in DB
 * @param {string} userId - User ID for filtering
 * @returns {Object} Prediction with trend analysis and volatility metrics
 */
exports.predict = async (userId) => {
    const PersonalFinance = require('../models/personalFinance.model');

    // Aggregation pipeline for efficient calculation
    const pipeline = [
        {
            $match: {
                userId,
                estado: ESTADOS.COMPLETADO,
                tipo: TIPOS.GASTO,
                monto: { $gt: 0 }
            }
        },
        {
            $sort: { fecha: -1 }
        },
        {
            $limit: 1000  // Only last 1000 transactions for performance
        },
        {
            $sort: { fecha: 1 }  // Re-sort ascending for time analysis
        },
        {
            $group: {
                _id: null,
                transactions: {
                    $push: {
                        monto: '$monto',
                        fecha: '$fecha'
                    }
                },
                total: { $sum: '$monto' },
                count: { $sum: 1 },
                minMonto: { $min: '$monto' },
                maxMonto: { $max: '$monto' },
                firstDate: { $first: '$fecha' },
                lastDate: { $last: '$fecha' }
            }
        },
        {
            $project: {
                transactions: 1,
                promedio: { $divide: ['$total', '$count'] },
                count: 1,
                minMonto: 1,
                maxMonto: 1,
                firstDate: 1,
                lastDate: 1
            }
        }
    ];

    const result = await PersonalFinance.aggregate(pipeline);

    if (!result || result.length === 0 || result[0].count < 2) {
        return {
            success: false,
            message: 'Datos insuficientes para predicción'
        };
    }

    const data = result[0];
    const transactions = data.transactions;

    // Calculate time-based metrics
    const timestamps = transactions.map(t => new Date(t.fecha).getTime());
    const montos = transactions.map(t => t.monto);

    const frecuenciaDias = calcularFrecuenciaMediana(transactions.map(t => new Date(t.fecha)));
    const diasDesdeUltimo = (new Date() - new Date(data.lastDate)) / (1000 * 60 * 60 * 24);

    // Volatility calculation
    const desviacion = calcularDesviacion(montos, data.promedio);
    const coeficienteVariacion = data.promedio !== 0 ? (desviacion / data.promedio) * 100 : 0;

    // Filter outliers for regression
    const umbralOutlier = data.promedio + 2 * desviacion;
    const validIndices = montos
        .map((m, i) => ({ monto: m, index: i }))
        .filter(item => item.monto <= umbralOutlier)
        .map(item => item.index);

    const montosFiltrados = validIndices.map(i => montos[i]);
    const timestampsFiltrados = validIndices.map(i => timestamps[i]);

    // Linear regression on filtered data
    const pendientePorDia = calcularTendenciaRegresion(montosFiltrados, timestampsFiltrados);
    const pendienteRelativa = pendientePorDia / (data.promedio + 1e-6);

    let tendencia = 'estable';
    if (pendienteRelativa > 0.05) tendencia = 'aumento';
    else if (pendienteRelativa < -0.05) tendencia = 'disminucion';

    // Ensemble prediction
    const ultimo = montos[montos.length - 1];
    const mediaMovil = montos.length >= 3
        ? montos.slice(-3).reduce((a, b) => a + b, 0) / 3
        : data.promedio;

    const valorRegresion = data.promedio + (pendientePorDia * (frecuenciaDias || 1));
    const estimado = 0.5 * valorRegresion + 0.3 * mediaMovil + 0.2 * ultimo;

    const maxCambio = data.promedio * 0.5;
    const estimadoLimitado = Math.max(
        data.promedio - maxCambio,
        Math.min(estimado, data.promedio + maxCambio)
    );

    const diasHastaProximo = Math.max(0, frecuenciaDias - diasDesdeUltimo);
    const nivelEstabilidad = Math.max(0, 100 - coeficienteVariacion);
    const esAnomalia = ultimo > umbralOutlier;

    return {
        success: true,
        data: {
            promedioGasto: data.promedio,
            ultimoGasto: ultimo,
            tendencia,
            proximoGastoEstimado: Math.max(0, estimadoLimitado),
            tiempoProximoGasto: {
                diasEstimados: Math.round(diasHastaProximo * 10) / 10,
                basadoEnFrecuenciaMediana: true
            },
            nivelEstabilidad: Math.round(nivelEstabilidad),
            esAnomalia,
            tiempo: {
                frecuenciaDias: Math.round(frecuenciaDias * 10) / 10,
                diasDesdeUltimo: Math.round(diasDesdeUltimo * 10) / 10,
                totalTransacciones: data.count
            },
            volatilidad: {
                desviacionEstandar: Math.round(desviacion * 100) / 100,
                coeficienteVariacion: Math.round(coeficienteVariacion * 100) / 100
            },
            analisisTendencia: {
                pendientePorDia: Math.round(pendientePorDia * 100) / 100,
                direccion: tendencia
            },
            alertas: generarAlertas(data.promedio, ultimo, tendencia, coeficienteVariacion, diasDesdeUltimo, esAnomalia)
        }
    };
};

/**
 * Generates smart financial alerts
 * @private
 */
const generarAlertas = (promedio, ultimo, tendencia, cv, diasDesdeUltimo, esAnomalia) => {
    const alertas = [];

    // Only calculate percentage if promedio > 0 to avoid division by zero
    if (promedio > 0 && tendencia === 'aumento') {
        const incremento = ((ultimo - promedio) / promedio) * 100;
        if (incremento > 20) {
            alertas.push(`Estás gastando ${Math.round(incremento)}% más que tu promedio`);
        }
    }

    if (cv > 50) {
        alertas.push('Tus gastos son muy irregulares (volatilidad alta)');
    }

    if (diasDesdeUltimo > 30) {
        alertas.push(`Hace ${Math.round(diasDesdeUltimo)} días que no registras gastos`);
    }

    if (esAnomalia) {
        alertas.push('Gasto inusualmente alto detectado');
    }

    return alertas;
};