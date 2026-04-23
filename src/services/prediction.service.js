/**
 * Prediction Service - Senior Level (Fintech/AI Grade)
 * Predicts future spending with time-series analysis and linear regression
 * @module services/prediction.service
 */

const TIPOS = {
    INGRESO: 'ingreso',
    GASTO: 'gasto',
    TRANSFERENCIA: 'transferencia'
};

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
exports.predict = (data) => {
    // Defensive: validate input
    if (!Array.isArray(data) || data.length < 2) {
        return {
            success: false,
            message: 'Datos insuficientes para predicción'
        };
    }

    // Create copy to avoid mutating original array
    const sorted = [...data].sort(
        (a, b) => new Date(a.fecha) - new Date(b.fecha)
    );

    const gastos = [];

    for (const item of sorted) {
        // Filter: only completed expenses
        if (
            item.estado !== ESTADOS.COMPLETADO ||
            item.tipo !== TIPOS.GASTO
        ) {
            continue;
        }

        // Strict validation: reject non-numeric, negative, or zero amounts
        const monto = Number(item.monto);
        if (isNaN(monto) || monto <= 0) {
            continue;
        }

        // Validate date
        const fecha = new Date(item.fecha);
        if (isNaN(fecha.getTime())) {
            continue;
        }

        gastos.push({
            monto,
            fecha,
            timestamp: fecha.getTime()
        });
    }

    if (gastos.length === 0) {
        return {
            success: false,
            message: 'No hay gastos válidos para analizar'
        };
    }

    // Core metrics
    const montos = gastos.map(g => g.monto);
    const timestamps = gastos.map(g => g.timestamp);
    const fechas = gastos.map(g => g.fecha);
    const total = montos.reduce((acc, m) => acc + m, 0);
    const promedio = total / montos.length;
    const ultimo = montos[montos.length - 1];

    // Time-based analysis (using MEDIAN for robustness)
    const frecuenciaDias = calcularFrecuenciaMediana(fechas);
    const diasDesdeUltimo = (new Date() - fechas[fechas.length - 1]) / (1000 * 60 * 60 * 24);

    // Volatility for outlier detection
    const desviacion = calcularDesviacion(montos, promedio);
    const umbralOutlier = promedio + 2 * desviacion;

    // Filter outliers for robust regression (exclude extreme values)
    const indicesValidos = montos
        .map((m, i) => ({ monto: m, index: i }))
        .filter(item => item.monto <= umbralOutlier)
        .map(item => item.index);

    const montosFiltrados = indicesValidos.map(i => montos[i]);
    const timestampsFiltrados = indicesValidos.map(i => timestamps[i]);

    // Real trend using linear regression on filtered data (robust to outliers)
    const pendientePorDia = calcularTendenciaRegresion(montosFiltrados, timestampsFiltrados);

    // Epsilon prevents instability when promedio is very small
    const epsilon = 1e-6;
    const pendienteRelativa = pendientePorDia / (promedio + epsilon);

    // Trend classification based on regression slope
    let tendencia = 'estable';
    if (pendienteRelativa > 0.05) {
        tendencia = 'aumento';
    } else if (pendienteRelativa < -0.05) {
        tendencia = 'disminucion';
    }

    // Volatility (standard deviation)
    const coeficienteVariacion = promedio !== 0 ? (desviacion / promedio) * 100 : 0;

    // Hybrid prediction model (ensemble approach)
    // Combines: regression trend + moving average + recent value
    const factorRegresion = 0.5;
    const factorMedia = 0.3;
    const factorReciente = 0.2;

    // Moving average (simple)
    const mediaMovil = montos.length >= 3
        ? montos.slice(-3).reduce((a, b) => a + b, 0) / 3
        : promedio;

    // Base components
    const valorRegresion = promedio + (pendientePorDia * (frecuenciaDias || 1));
    const valorMedia = mediaMovil;
    const valorReciente = ultimo;

    // Weighted ensemble
    const estimado = 
        factorRegresion * valorRegresion +
        factorMedia * valorMedia +
        factorReciente * valorReciente;

    // Limit prediction growth to prevent absurd values (max 50% change from average)
    const maxCambio = promedio * 0.5;
    const estimadoLimitado = Math.max(
        promedio - maxCambio,
        Math.min(estimado, promedio + maxCambio)
    );

    // Predict when next expense will occur (based on median frequency)
    const diasHastaProximo = Math.max(0, frecuenciaDias - diasDesdeUltimo);

    // Stability indicator (not statistical confidence, but volatility-based reliability)
    const nivelEstabilidad = Math.max(0, 100 - coeficienteVariacion);

    // Anomaly detection: last expense unusually high (using original desviacion)
    const esAnomalia = ultimo > umbralOutlier;

    return {
        success: true,
        data: {
            promedioGasto: promedio,
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
                totalTransacciones: gastos.length
            },
            volatilidad: {
                desviacionEstandar: Math.round(desviacion * 100) / 100,
                coeficienteVariacion: Math.round(coeficienteVariacion * 100) / 100
            },
            analisisTendencia: {
                pendientePorDia: Math.round(pendientePorDia * 100) / 100,
                direccion: tendencia
            },
            alertas: generarAlertas(promedio, ultimo, tendencia, coeficienteVariacion, diasDesdeUltimo, esAnomalia)
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