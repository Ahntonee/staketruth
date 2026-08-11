const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adSlots');
const { requireAdmin } = require('../middleware/auth');

router.get('/active', ctrl.getActive);
router.get('/admin', requireAdmin, ctrl.adminList);
router.put('/admin/:id', requireAdmin, ctrl.adminUpdate);

module.exports = router;
