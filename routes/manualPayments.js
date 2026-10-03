const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/manualPayments');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/details', ctrl.getPaymentDetails);
router.put('/details', requireAdmin, ctrl.adminUpdateDetails);

router.post('/upload-proof', authenticate, ctrl.uploadProof);
router.post('/', authenticate, ctrl.create);
router.get('/mine', authenticate, ctrl.myClaims);

router.get('/admin', requireAdmin, ctrl.adminList);
router.post('/:id/approve', requireAdmin, ctrl.adminApprove);
router.post('/:id/reject', requireAdmin, ctrl.adminReject);

module.exports = router;
