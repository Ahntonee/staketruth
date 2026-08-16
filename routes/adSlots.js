const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adSlots');
const { requireAdmin } = require('../middleware/auth');

router.get('/active', ctrl.getActive);
router.get('/admin', requireAdmin, ctrl.adminList);
router.post('/admin', requireAdmin, ctrl.create);
router.put('/admin/:id', requireAdmin, ctrl.adminUpdate);
router.delete('/admin/:id', requireAdmin, ctrl.remove);

module.exports = router;
