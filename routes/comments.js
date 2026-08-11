const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/comments');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateComment } = require('../middleware/validate');

router.get('/admin', requireAdmin, ctrl.adminList);
router.put('/admin/:id/approve', requireAdmin, ctrl.adminApprove);
router.delete('/admin/:id', requireAdmin, ctrl.adminDelete);

router.get('/:predictionId', ctrl.listForPrediction);
router.post('/:predictionId', authenticate, validateComment, ctrl.createComment);
router.delete('/:id', authenticate, ctrl.deleteComment);

module.exports = router;
