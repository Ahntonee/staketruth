const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/intelligence');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin); // every intelligence endpoint is admin-only

router.get('/status', ctrl.getStatus);
router.get('/weights', ctrl.getWeights);
router.put('/weights', ctrl.putWeights);
router.get('/queue', ctrl.getQueue);
router.put('/queue/:id/approve', ctrl.approveQueueItem);
router.put('/queue/:id/reject', ctrl.rejectQueueItem);
router.get('/patterns', ctrl.getPatterns);
router.get('/performance', ctrl.getPerformance);
router.get('/profitability', ctrl.getProfitability);
router.post('/run', ctrl.runNow);

module.exports = router;
