const express = require('express');
const router = express.Router();
const personalFinanceController = require('../controllers/personalFinance.controller');

const authMiddleware = require('../middlewares/auth.middleware');


router.post(
    '/',
    authMiddleware,
    personalFinanceController.createFinance
);


router.get(
    '/',
    authMiddleware,
    personalFinanceController.getAllFinances
);


router.get(
    '/:id',
    authMiddleware,
    personalFinanceController.getFinanceById
);


router.put(
    '/:id',
    authMiddleware,
    personalFinanceController.updateFinance
);


router.delete(
    '/:id',
    authMiddleware,
    personalFinanceController.deleteFinance
);


router.get(
    '/analysis',
    authMiddleware,
    personalFinanceController.getAnalysis
);


router.get(
    '/prediction',
    authMiddleware,
    personalFinanceController.getPrediction
);


router.get(
    '/simulation',
    authMiddleware,
    personalFinanceController.getSimulation
);


module.exports = router; 