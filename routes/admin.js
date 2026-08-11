const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/admin');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/dashboard', ctrl.getDashboardOverview);
router.get('/dashboard/trend', ctrl.getDashboardTrend);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.put('/users/:id/ban', ctrl.banUser);
router.put('/users/:id/unban', ctrl.unbanUser);
router.put('/users/:id/comment-ban', ctrl.commentBanUser);
router.put('/users/:id/comment-unban', ctrl.commentUnbanUser);
router.post('/users/:id/grant-vip', ctrl.grantVip);

router.get('/leaderboard', ctrl.getLeaderboard);

router.get('/settings', ctrl.getSettings);
router.put('/settings/:key', ctrl.putSetting);
router.get('/stat-overrides', ctrl.getStatOverrides);
router.put('/stat-overrides/:key', ctrl.putStatOverride);

module.exports = router;
