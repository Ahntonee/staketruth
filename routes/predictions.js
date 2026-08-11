const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/predictions');
const { requireAdmin, identifyGuest } = require('../middleware/auth');
const { validatePrediction, validateVoteChoice } = require('../middleware/validate');

const voteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Vote limit reached — try again later.' },
});

// Public
router.get('/', ctrl.listPredictions);
router.get('/stats', ctrl.getStats);
router.get('/bankers', ctrl.getBankers);
router.get('/vip-picks-of-day', ctrl.getVipPicksOfDay);
router.get('/recent-wins', ctrl.getRecentWins);
router.get('/featured', ctrl.getFeatured);
router.get('/:id/votes', identifyGuest, ctrl.getVotes);
router.post('/:id/votes', identifyGuest, voteLimiter, validateVoteChoice, ctrl.castVote);
router.get('/:slug', ctrl.getBySlug);

// Admin
router.get('/admin/list', requireAdmin, ctrl.adminListPredictions);
router.post('/', requireAdmin, validatePrediction, ctrl.createPrediction);
router.put('/:id', requireAdmin, ctrl.updatePrediction);
router.delete('/:id', requireAdmin, ctrl.deletePrediction);
router.put('/:id/result', requireAdmin, ctrl.setResult);
router.put('/:id/publish', requireAdmin, ctrl.togglePublish);
router.put('/:id/banker', requireAdmin, ctrl.toggleBanker);
router.put('/:id/category', requireAdmin, ctrl.changeCategory);
router.put('/:id/push', requireAdmin, ctrl.togglePush);
router.delete('/:id/votes', requireAdmin, ctrl.resetVotes);
router.put('/:id/voting', requireAdmin, ctrl.toggleVoting);
router.post('/bulk-publish', requireAdmin, ctrl.bulkPublish);
router.post('/bulk-unpublish', requireAdmin, ctrl.bulkUnpublish);
router.post('/bulk-delete', requireAdmin, ctrl.bulkDelete);
router.post('/bulk-push', requireAdmin, ctrl.bulkPush);

module.exports = router;
