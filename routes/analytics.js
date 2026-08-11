const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/analytics');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

// Mounted at /api/admin (see server.js) so these resolve to the paths the
// admin frontend actually calls: /api/admin/analytics/* and /api/admin/revenue/*
// as siblings, not revenue nested under analytics.
router.get('/analytics/overview', ctrl.overview);
router.get('/analytics/pages', ctrl.topPages);
router.get('/analytics/countries', ctrl.countries);
router.get('/analytics/devices', ctrl.devices);
router.get('/analytics/referrers', ctrl.referrers);
router.get('/analytics/peak-hours', ctrl.peakHours);
router.get('/revenue/overview', ctrl.revenueOverview);
router.get('/revenue/by-month', ctrl.revenueByMonth);
router.get('/revenue/plans', ctrl.revenuePlans);
router.get('/revenue/churn', ctrl.revenueChurn);

module.exports = router;
