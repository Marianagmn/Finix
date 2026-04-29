/**
 * @file prediction.service.test.js
 * @description Tests for prediction service
 */

const predictionService = require('../services/prediction.service');
const PersonalFinance = require('../models/personalFinance.model');

jest.mock('../models/personalFinance.model');

describe('PredictionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('predict', () => {
        it('should return insufficient data when no transactions', async () => {
            PersonalFinance.aggregate.mockResolvedValue([]);

            const result = await predictionService.predict('user123');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Datos insuficientes para predicción');
        });

        it('should return insufficient data when less than 2 transactions', async () => {
            PersonalFinance.aggregate.mockResolvedValue([{
                count: 1,
                transactions: [{ monto: 100, fecha: new Date() }]
            }]);

            const result = await predictionService.predict('user123');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Datos insuficientes para predicción');
        });

        it('should calculate prediction successfully', async () => {
            const mockData = {
                count: 3,
                promedio: 100,
                transactions: [
                    { monto: 80, fecha: new Date('2023-01-01') },
                    { monto: 100, fecha: new Date('2023-01-15') },
                    { monto: 120, fecha: new Date('2023-01-30') }
                ],
                firstDate: new Date('2023-01-01'),
                lastDate: new Date('2023-01-30')
            };

            PersonalFinance.aggregate.mockResolvedValue([mockData]);

            const result = await predictionService.predict('user123');

            expect(result.success).toBe(true);
            expect(result.data).toHaveProperty('promedioGasto');
            expect(result.data).toHaveProperty('tendencia');
            expect(result.data).toHaveProperty('proximoGastoEstimado');
        });
    });
});