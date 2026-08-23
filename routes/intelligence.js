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

router.get('/league/:leagueId/overview', ctrl.getLeagueOverview);
router.get('/league/:leagueId/standings', ctrl.getLeagueStandings);
router.post('/league/:leagueId/standings/sync', ctrl.syncLeagueStandings);
router.get('/league/:leagueId/match-intel', ctrl.getMatchIntel);
router.get('/league/:leagueId/accuracy', ctrl.getLeagueAccuracy);

module.exports = router;
