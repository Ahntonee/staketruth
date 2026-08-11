const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/statistics');

router.get('/teams/highest-scoring', ctrl.highestScoringTeams);
router.get('/teams/lowest-scoring', ctrl.lowestScoringTeams);
router.get('/teams/reliable', ctrl.reliableTeams);
router.get('/teams/effective', ctrl.effectiveByTeam);
router.get('/leagues/highest-scoring', ctrl.highestScoringLeagues);
router.get('/leagues/lowest-scoring', ctrl.lowestScoringLeagues);
router.get('/leagues/reliable', ctrl.reliableLeagues);
router.get('/leagues/effective', ctrl.effectiveByLeague);
router.get('/markets/reliable', ctrl.reliableMarkets);
router.get('/markets/cross', ctrl.crossMarketLeague);
router.get('/summary', ctrl.summary);

module.exports = router;
