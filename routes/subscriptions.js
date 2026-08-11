const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/status', authenticate, ctrl.getStatus);
router.post('/paystack/verify', authenticate, ctrl.paystackVerify);
router.post('/cancel', authenticate, ctrl.cancel);
router.post('/admin/grant', requireAdmin, ctrl.adminGrant);

router.get('/admin/list', requireAdmin, ctrl.adminList);
router.put('/admin/:id/extend', requireAdmin, ctrl.adminExtend);
router.put('/admin/:id/cancel', requireAdmin, ctrl.adminCancel);
router.post('/admin/:id/notify-expiry', requireAdmin, ctrl.adminNotifyExpiry);

module.exports = router;
