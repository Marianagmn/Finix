/**
 * @file analytics.aggregation.service.js
 * @description Aggregation pipelines de MongoDB para análisis financiero escalable.
 * Mueve el procesamiento de datos a la base de datos para grandes volúmenes.
 */

'use strict';

const mongoose = require('mongoose');
const PersonalFinance = require('../models/personalFinance.model');
const { ESTADOS, TIPOS } = require('../constants/transaction.constants');

class AnalyticsAggregationService {

    /**
     * Análisis financiero usando aggregation pipeline.
     * Más eficiente que cargar todos los documentos en memoria.
     * @param {string} userId - ID del usuario
     * @param {Date} fechaDesde - Fecha inicial opcional
     * @param {Date} fechaHasta - Fecha final opcional
     * @returns {Promise<Object>} Resultados del análisis
     */
    static async analyzeWithAggregation(userId, fechaDesde = null, fechaHasta = null) {
        const matchStage = {
            userId: new mongoose.Types.ObjectId(userId),
            estado: ESTADOS.COMPLETADO,
            esTransferenciaInterna: false
        };

        if (fechaDesde) matchStage.fecha = { $gte: fechaDesde };
        if (fechaHasta) {
            matchStage.fecha = matchStage.fecha || {};
            matchStage.fecha.$lte = fechaHasta;
        }

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: '$tipo',
                    total: { $sum: '$monto' },
                    count: { $sum: 1 },
                    avg: { $avg: '$monto' },
                    min: { $min: '$monto' },
                    max: { $max: '$monto' }
                }
            }
        ];

        const resultados = await PersonalFinance.aggregate(pipeline);

        // Transformar a formato consistente con financeAnalysis.service
        const ingresos = resultados.find(r => r._id === TIPOS.INGRESO) || { total: 0, count: 0, avg: 0 };
        const gastos = resultados.find(r => r._id === TIPOS.GASTO) || { total: 0, count: 0, avg: 0 };

        return {
            success: true,
            data: {
                totalIngresos: ingresos.total / 100, // Convertir de centavos
                totalGastos: gastos.total / 100,
                balance: (ingresos.total - gastos.total) / 100,
                conteos: {
                    totalIngresos: ingresos.count,
                    totalGastos: gastos.count,
                    totalTransacciones: ingresos.count + gastos.count
                },
                promedios: {
                    ingresoPromedio: (ingresos.avg || 0) / 100,
                    gastoPromedio: (gastos.avg || 0) / 100
                },
                extremos: {
                    ingresoMin: (ingresos.min || 0) / 100,
                    ingresoMax: (ingresos.max || 0) / 100,
                    gastoMin: (gastos.min || 0) / 100,
                    gastoMax: (gastos.max || 0) / 100
                }
            }
        };
    }

    /**
     * Análisis por categorías usando aggregation.
     * @param {string} userId - ID del usuario
     * @param {number} limit - Número máximo de categorías
     * @returns {Promise<Object>} Ranking de categorías
     */
    static async analyzeCategories(userId, limit = 10) {
        const pipeline = [
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    estado: ESTADOS.COMPLETADO,
                    tipo: TIPOS.GASTO
                }
            },
            {
                $group: {
                    _id: '$categoria',
                    total: { $sum: '$monto' },
                    count: { $sum: 1 },
                    avg: { $avg: '$monto' }
                }
            },
            { $sort: { total: -1 } },
            { $limit: limit }
        ];

        const categorias = await PersonalFinance.aggregate(pipeline);
        const totalGastos = categorias.reduce((sum, cat) => sum + cat.total, 0);

        return {
            success: true,
            data: {
                categorias: categorias.map(cat => ({
                    categoria: cat._id,
                    gasto: cat.total / 100,
                    count: cat.count,
                    promedio: cat.avg / 100,
                    porcentaje: totalGastos > 0 ? Math.round((cat.total / totalGastos) * 100) : 0
                })),
                totalGastos: totalGastos / 100,
                totalCategorias: categorias.length
            }
        };
    }

    /**
     * Análisis temporal mensual para tendencias.
     * @param {string} userId - ID del usuario
     * @param {number} meses - Cuántos meses hacia atrás analizar
     * @returns {Promise<Object>} Datos mensuales
     */
    static async analyzeMonthlyTrends(userId, meses = 12) {
        const fechaInicio = new Date();
        fechaInicio.setMonth(fechaInicio.getMonth() - meses);

        const pipeline = [
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    estado: ESTADOS.COMPLETADO,
                    fecha: { $gte: fechaInicio }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$fecha' },
                        month: { $month: '$fecha' },
                        tipo: '$tipo'
                    },
                    total: { $sum: '$monto' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ];

        const resultados = await PersonalFinance.aggregate(pipeline);

        // Transformar a estructura más usable
        const mensual = {};
        resultados.forEach(r => {
            const key = `${r._id.year}-${String(r._id.month).padStart(2, '0')}`;
            if (!mensual[key]) {
                mensual[key] = { ingresos: 0, gastos: 0, balance: 0 };
            }
            if (r._id.tipo === TIPOS.INGRESO) {
                mensual[key].ingresos = r.total / 100;
            } else if (r._id.tipo === TIPOS.GASTO) {
                mensual[key].gastos = r.total / 100;
            }
            mensual[key].balance = mensual[key].ingresos - mensual[key].gastos;
        });

        return {
            success: true,
            data: {
                mensual: Object.entries(mensual).map(([mes, datos]) => ({
                    mes,
                    ...datos
                })),
                mesesAnalizados: Object.keys(mensual).length
            }
        };
    }

    /**
     * Obtiene estadísticas rápidas sin cargar documentos completos.
     * Útil para dashboards.
     * @param {string} userId - ID del usuario
     * @returns {Promise<Object>} Estadísticas resumidas
     */
    static async getQuickStats(userId) {
        const pipeline = [
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    estado: ESTADOS.COMPLETADO
                }
            },
            {
                $group: {
                    _id: '$tipo',
                    total: { $sum: '$monto' },
                    count: { $sum: 1 },
                    lastDate: { $max: '$fecha' }
                }
            }
        ];

        const stats = await PersonalFinance.aggregate(pipeline);
        
        const ingresos = stats.find(s => s._id === TIPOS.INGRESO) || { total: 0, count: 0 };
        const gastos = stats.find(s => s._id === TIPOS.GASTO) || { total: 0, count: 0 };

        return {
            success: true,
            data: {
                balance: (ingresos.total - gastos.total) / 100,
                totalIngresos: ingresos.total / 100,
                totalGastos: gastos.total / 100,
                transaccionesCount: ingresos.count + gastos.count,
                lastTransaction: ingresos.lastDate || gastos.lastDate || null
            }
        };
    }
}

module.exports = AnalyticsAggregationService;
