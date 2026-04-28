/**
 * Financial Simulation Service - Enterprise Grade
 * Modular architecture with financial scoring, risk analysis, and actionable insights
 * @module services/simulation.service
 */

const TIPOS = {
    INGRESO: 'ingreso',
    GASTO: 'gasto',
    TRANSFERENCIA: 'transferencia'
};

const ESTADOS = {
    COMPLETADO: 'completado'
};

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

// ============================================================================
// SECTION 1: Data Processing (Input sanitization & aggregation)
// ============================================================================

/**
 * Advanced category normalization with string cleaning
 * @param {*} cat - Raw category value
 * @returns {string} Normalized category string
 */
const normalizarCategoria = (cat) => {
    if (!cat) return 'sin_categoria';
    return cat.toString().toLowerCase().trim().replace(/\s+/g, '_') || 'sin_categoria';
};

/**
 * Analyzes temporal spending trend over months
 * Groups expenses by month and compares recent vs average
 * @param {Array} data - Transaction data
 * @returns {string} Trend: 'creciente', 'decreciente', 'estable', 'insuficiente'
 */
const analizarTendenciaTemporal = (data) => {
    const gastosPorMes = {};

    for (const item of data) {
        if (item.tipo !== TIPOS.GASTO || item.estado !== ESTADOS.COMPLETADO) continue;

        const fecha = new Date(item.fecha);
        if (isNaN(fecha.getTime())) continue;

        const mes = fecha.toISOString().slice(0, 7); // YYYY-MM
        const monto = Number(item.monto) || 0;
        gastosPorMes[mes] = (gastosPorMes[mes] || 0) + monto;
    }

    const valores = Object.values(gastosPorMes);
    if (valores.length < 2) return 'insuficiente';

    const ultimo = valores[valores.length - 1];
    const promedio = valores.reduce((a, b) => a + b, 0) / valores.length;

    const variacion = (ultimo - promedio) / promedio;
    if (variacion > 0.1) return 'creciente';
    if (variacion < -0.1) return 'decreciente';
    return 'estable';
};

/**
 * Processes raw transaction data into clean financial metrics
 * @param {Array} data - Raw transaction data
 * @returns {Object} Clean metrics with categories, income, and expenses
 */
const procesarDatos = (data) => {
    let ingresos = 0;
    let gastos = 0;
    const categorias = {};
    let gastosEsenciales = 0;
    let gastosDiscrecionales = 0;

    for (const item of data) {
        if (item.estado !== ESTADOS.COMPLETADO) continue;

        const monto = Number(item.monto);
        if (isNaN(monto) || monto <= 0) continue;

        if (item.tipo === TIPOS.INGRESO) {
            ingresos += monto;
        } else if (item.tipo === TIPOS.GASTO) {
            gastos += monto;
            const categoria = normalizarCategoria(item.categoria);
            categorias[categoria] = (categorias[categoria] || 0) + monto;

            // Classify expense type
            const tipo = CLASIFICACION_GASTOS[categoria] || 'otro';
            if (tipo === 'esencial') {
                gastosEsenciales += monto;
            } else if (tipo === 'discrecional') {
                gastosDiscrecionales += monto;
            }
        }
    }

    return { ingresos, gastos, categorias, gastosEsenciales, gastosDiscrecionales };
};

// ============================================================================
// SECTION 2: Financial Scoring (AI-powered assessment)
// ============================================================================

/**
 * Calculates financial health score (0-100)
 * Higher is better. Considers expense ratio and savings rate.
 * @param {number} ingresos - Total income
 * @param {number} gastos - Total expenses
 * @param {number} balance - Current balance
 * @returns {number} Financial health score (0-100)
 */
const calcularScoreFinanciero = (ingresos, gastos, balance) => {
    if (ingresos === 0) return 0;

    const ratioGastos = gastos / ingresos;
    const tasaAhorro = balance / ingresos;

    let score = 100;

    // Deduct for high expense ratio
    if (ratioGastos > 1) score -= 40;
    else if (ratioGastos > 0.9) score -= 30;
    else if (ratioGastos > 0.8) score -= 20;
    else if (ratioGastos > 0.7) score -= 10;
    else if (ratioGastos <= 0.5) score += 10;

    // Deduct for low/negative savings
    if (tasaAhorro < 0) score -= 30;
    else if (tasaAhorro < 0.05) score -= 15;
    else if (tasaAhorro < 0.1) score -= 5;
    else if (tasaAhorro >= 0.2) score += 10;

    return Math.max(0, Math.min(100, Math.round(score)));
};

/**
 * Classifies financial risk level
 * @param {number} ratioGastos - Expense to income ratio
 * @returns {Object} Risk classification with level and description
 */
const clasificarRiesgo = (ratioGastos) => {
    if (ratioGastos > 1) {
        return { nivel: 'critico', descripcion: 'Gastos exceden ingresos' };
    }
    if (ratioGastos > 0.9) {
        return { nivel: 'alto', descripcion: 'Margen de ahorro muy bajo' };
    }
    if (ratioGastos > 0.8) {
        return { nivel: 'medio', descripcion: 'Presupuesto ajustado' };
    }
    if (ratioGastos > 0.6) {
        return { nivel: 'bajo', descripcion: 'Situación estable' };
    }
    return { nivel: 'excelente', descripcion: 'Excelente manejo financiero' };
};

// ============================================================================
// SECTION 3: Category Analysis
// ============================================================================

/**
 * Ranks categories by spending amount
 * @param {Object} categorias - Category spending totals
 * @returns {Array} Ranked categories with percentages
 */
const analizarCategorias = (categorias, totalGastos) => {
    const ranking = Object.entries(categorias)
        .map(([categoria, gasto]) => ({
            categoria,
            gasto,
            porcentaje: totalGastos > 0 ? Math.round((gasto / totalGastos) * 100) : 0
        }))
        .sort((a, b) => b.gasto - a.gasto);

    return {
        ranking,
        totalCategorias: ranking.length,
        top3: ranking.slice(0, 3),
        categoriaMayor: ranking[0] || null
    };
};
// SECTION 4: Scenario Modeling
// ============================================================================

/**
 * Generates ADAPTIVE financial scenarios based on risk level
 * Higher risk = more aggressive targets
 * @param {number} balance - Current balance
 * @param {number} ingresos - Total income
 * @param {number} maxGasto - Highest category spending
 * @param {Object} riesgo - Risk classification
 * @returns {Object} Three scenarios with adaptive projections
 */
const generarEscenarios = (balance, ingresos, maxGasto, riesgo) => {
    // Adaptive percentages based on risk level
    let porcentajeReduccion = 0.2; // default 20%
    let porcentajeAumento = 0.1;   // default 10%

    if (riesgo.nivel === 'critico') {
        porcentajeReduccion = 0.3; // need aggressive 30%
        porcentajeAumento = 0.15;  // need aggressive 15%
    } else if (riesgo.nivel === 'alto') {
        porcentajeReduccion = 0.25;
        porcentajeAumento = 0.12;
    } else if (riesgo.nivel === 'excelente') {
        porcentajeReduccion = 0.15; // can be conservative
        porcentajeAumento = 0.05;
    }

    const reduccionInteligente = maxGasto * porcentajeReduccion;
    const aumentoRealista = ingresos * porcentajeAumento;

    return {
        optimizarCategoria: {
            nuevoBalance: balance + reduccionInteligente,
            ahorroMensual: reduccionInteligente,
            descripcion: `Reducir ${Math.round(porcentajeReduccion * 100)}% en categoría principal`,
            viabilidad: riesgo.nivel === 'critico' ? 'necesario' : 'alta',
            porcentajeAplicado: Math.round(porcentajeReduccion * 100)
        },
        aumentarIngresos: {
            nuevoBalance: balance + aumentoRealista,
            ahorroMensual: aumentoRealista,
            descripcion: `Aumentar ingresos ${Math.round(porcentajeAumento * 100)}%`,
            viabilidad: riesgo.nivel === 'critico' ? 'necesario' : 'media',
            porcentajeAplicado: Math.round(porcentajeAumento * 100)
        },
        combinado: {
            nuevoBalance: balance + reduccionInteligente + aumentoRealista,
            ahorroMensual: reduccionInteligente + aumentoRealista,
            descripcion: 'Optimizar + Aumentar ingresos',
            viabilidad: riesgo.nivel === 'critico' ? 'necesario' : 'optimo',
            porcentajeAplicado: {
                reduccion: Math.round(porcentajeReduccion * 100),
                aumento: Math.round(porcentajeAumento * 100)
            }
        }
    };
};

// ============================================================================
// SECTION 5: Recommendations Engine (AI Rules)
// ============================================================================

/**
 * Generates prioritized financial recommendations
 * @param {Object} metrics - Financial metrics
 * @param {Object} categoriaMayor - Top spending category
 * @returns {Array} Prioritized recommendations
 */
const generarRecomendaciones = (metrics, categoriaMayor) => {
    const { balance, ingresos, gastos, tasaAhorro, ratioGastos } = metrics;
    const recomendaciones = [];

    const addRec = (mensaje, prioridad, impacto, tipo) => {
        recomendaciones.push({ mensaje, prioridad, impacto, tipo });
    };

    // Critical recommendations
    if (balance < 0) {
        addRec(
            'Tu balance es negativo: prioriza reducir gastos urgentemente',
            'critica',
            'alto',
            'urgencia'
        );
    }

    if (ratioGastos > 0.95) {
        addRec(
            'Tus gastos consumen casi todo tu ingreso: revisa presupuesto inmediatamente',
            'alta',
            'alto',
            'presupuesto'
        );
    }

    // Category-specific
    if (categoriaMayor && categoriaMayor.porcentaje > 40) {
        addRec(
            `La categoría "${categoriaMayor.categoria}" consume ${categoriaMayor.porcentaje}% de gastos. Optimízala`,
            'alta',
            'alto',
            'categoria'
        );
    }

    // Anomaly: extreme concentration (>60% in one category)
    if (categoriaMayor && categoriaMayor.porcentaje > 60) {
        addRec(
            'Gasto extremadamente concentrado en una categoría. Diversifica tus gastos',
            'critica',
            'alto',
            'anomalia'
        );
    }

    // Savings recommendations
    if (tasaAhorro < 0) {
        addRec(
            'Estás gastando más de lo que ingresas. Crea un plan de reducción',
            'alta',
            'alto',
            'ahorro'
        );
    } else if (tasaAhorro < 0.1) {
        addRec(
            'Intenta destinar al menos el 10% de tus ingresos al ahorro',
            'media',
            'medio',
            'ahorro'
        );
    } else if (tasaAhorro >= 0.2) {
        addRec(
            `Excelente tasa de ahorro (${Math.round(tasaAhorro * 100)}%). Considera invertir el excedente`,
            'baja',
            'medio',
            'inversion'
        );
    }

    // General financial health
    if (gastos > ingresos * 0.8 && gastos <= ingresos * 0.95) {
        addRec(
            'Tus gastos son altos. Busca reducir gastos fijos o aumentar ingresos',
            'media',
            'medio',
            'presupuesto'
        );
    }

    return recomendaciones.sort((a, b) => {
        const prio = { critica: 4, alta: 3, media: 2, baja: 1 };
        return prio[b.prioridad] - prio[a.prioridad];
    });
};

/**
 * Generates automatic financial insight/summary
 * @param {Object} metrics - Financial metrics
 * @param {Object} riesgo - Risk classification
 * @returns {string} Human-readable financial summary
 */
const generarInsight = (metrics, riesgo) => {
    const { balance, tasaAhorro, ratioGastos } = metrics;

    if (balance < 0) {
        return 'Alerta: Estás en déficit financiero. Requiere acción inmediata.';
    }
    if (ratioGastos > 0.9) {
        return 'Precaución: Margen de ahorro muy limitado. Revisa gastos innecesarios.';
    }
    if (tasaAhorro >= 0.2) {
        return 'Excelente: Tienes buen margen de ahorro. Considera diversificar inversiones.';
    }
    if (riesgo.nivel === 'bajo' || riesgo.nivel === 'excelente') {
        return 'Estable: Tu situación financiera es saludable. Mantén el ritmo.';
    }
    return 'Atención: Tu presupuesto necesita ajustes para mejorar estabilidad.';
};

// ============================================================================
// SECTION 6: Goal Planning
// ============================================================================

/**
 * Generates achievable financial goals based on savings capacity
 * @param {number} ahorroMensual - Projected monthly savings
 * @returns {Array} Prioritized financial goals
 */
const generarMetas = (ahorroMensual) => {
    if (ahorroMensual <= 0) {
        return [{
            meta: 'Alcanzar balance positivo',
            descripcion: 'Prioridad: reducir gastos urgentemente',
            tiempo: 'inmediato',
            prioridad: 'critica'
        }];
    }

    return [
        {
            meta: 'Fondo de emergencia básico (3 meses)',
            monto: ahorroMensual * 3,
            tiempo: '3 meses',
            prioridad: 'alta',
            descripcion: 'Cubre gastos esenciales ante imprevistos'
        },
        {
            meta: 'Fondo de emergencia completo (6 meses)',
            monto: ahorroMensual * 6,
            tiempo: '6 meses',
            prioridad: 'media',
            descripcion: 'Seguridad financiera completa'
        },
        {
            meta: 'Inversión inicial diversificada',
            monto: ahorroMensual * 12,
            tiempo: '1 año',
            prioridad: 'baja',
            descripcion: 'Comenzar a generar rendimientos pasivos'
        }
    ];
};

// ============================================================================
// MAIN EXPORT: Orchestrated Simulation
// ============================================================================

/**
 * Main simulation orchestrator
 * Combines all modules into comprehensive financial analysis
 * @param {Array} data - PersonalFinance documents
 * @returns {Object} Complete financial simulation with AI insights
 */
exports.simulate = (data) => {
    // Validation
    if (!Array.isArray(data) || data.length === 0) {
        return {
            success: false,
            message: 'Datos insuficientes para simulación'
        };
    }

    // Data processing (includes expense classification)
    const { ingresos, gastos, categorias, gastosEsenciales, gastosDiscrecionales } = procesarDatos(data);
    const balanceActual = ingresos - gastos;

    // Edge case: no valid data
    if (ingresos === 0 && gastos === 0) {
        return {
            success: false,
            message: 'No hay transacciones válidas para analizar'
        };
    }

    // Core metrics
    const tasaAhorro = ingresos > 0 ? balanceActual / ingresos : 0;
    const ratioGastos = ingresos > 0 ? gastos / ingresos : 0;

    // Analysis modules
    const scoreFinanciero = calcularScoreFinanciero(ingresos, gastos, balanceActual);
    const riesgo = clasificarRiesgo(ratioGastos);
    const analisisCategorias = analizarCategorias(categorias, gastos);
    const tendenciaTemporal = analizarTendenciaTemporal(data);

    // Adaptive scenarios based on risk
    const escenarios = generarEscenarios(
        balanceActual,
        ingresos,
        analisisCategorias.categoriaMayor?.gasto || 0,
        riesgo
    );

    // AI outputs
    const metricasClave = {
        tasaAhorro: Math.round(tasaAhorro * 100),
        ratioGastos: Math.round(ratioGastos * 100),
        tendenciaGastos: tendenciaTemporal
    };

    const recomendaciones = generarRecomendaciones(
        { balance: balanceActual, ingresos, gastos, tasaAhorro, ratioGastos },
        analisisCategorias.categoriaMayor
    );

    const insight = generarInsight({ balance: balanceActual, tasaAhorro, ratioGastos }, riesgo);
    const metas = generarMetas(escenarios.combinado.ahorroMensual);

    // Explainability: structured reasoning
    const explicacion = {
        score: `Calculado basado en ratio de gastos (${Math.round(ratioGastos * 100)}%) y tasa de ahorro (${Math.round(tasaAhorro * 100)}%)`,
        riesgo: `Clasificado como "${riesgo.nivel}" porque los gastos representan el ${Math.round(ratioGastos * 100)}% de los ingresos`,
        categoria: analisisCategorias.categoriaMayor
            ? `Mayor gasto en "${analisisCategorias.categoriaMayor.categoria}" (${analisisCategorias.categoriaMayor.porcentaje}%)`
            : 'No hay datos de categorías suficientes',
        tendencia: tendenciaTemporal !== 'insuficiente'
            ? `Tendencia de gastos: ${tendenciaTemporal}`
            : 'Datos temporales insuficientes para análisis de tendencia',
        escenarios: `Ajustados dinámicamente basado en nivel de riesgo "${riesgo.nivel}"`
    };

    return {
        success: true,
        data: {
            // Core financials
            balanceActual,
            ingresos,
            gastos,

            // Expense classification
            clasificacionGastos: {
                esenciales: gastosEsenciales,
                discrecionales: gastosDiscrecionales,
                porcentajeEsencial: gastos > 0 ? Math.round((gastosEsenciales / gastos) * 100) : 0
            },

            // AI Scoring
            scoreFinanciero,
            riesgo,

            // Metrics
            metricasClave,

            // Category analysis
            categorias: {
                total: analisisCategorias.totalCategorias,
                ranking: analisisCategorias.ranking,
                top3: analisisCategorias.top3,
                principal: analisisCategorias.categoriaMayor
            },

            // Scenarios
            escenarios,

            // AI Insights
            insight,
            recomendaciones,
            metasPosibles: metas,

            // Explainability
            explicacion
        }
    };
};