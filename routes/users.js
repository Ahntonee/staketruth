const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/users');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/profile', ctrl.getProfile);
router.put('/profile', ctrl.updateProfile);
router.put('/telegram-invited', ctrl.markTelegramInvited);
router.get('/bookmarks', ctrl.getBookmarks);
router.post('/bookmarks/:predictionId', ctrl.addBookmark);
router.delete('/bookmarks/:predictionId', ctrl.removeBookmark);
router.get('/bet-history', ctrl.getBetHistory);
router.post('/bet-history', ctrl.addBetHistory);
router.delete('/bet-history/:id', ctrl.deleteBetHistory);
router.delete('/account', ctrl.deleteAccount);

module.exports = router;
