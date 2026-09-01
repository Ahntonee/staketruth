const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/announcements');
const { requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.listPublic);
router.get('/admin', requireAdmin, ctrl.listAdmin);
router.post('/', requireAdmin, ctrl.create);
router.put('/:id', requireAdmin, ctrl.update);
router.post('/:id/publish', requireAdmin, ctrl.publish);
router.post('/:id/send-email', requireAdmin, ctrl.sendEmailNow);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
