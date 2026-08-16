const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/backlinks');
const { requireAdmin } = require('../middleware/auth');

router.get('/active', ctrl.getActive);
router.get('/admin/list', requireAdmin, ctrl.adminList);
router.post('/', requireAdmin, ctrl.create);
router.put('/:id', requireAdmin, ctrl.update);
router.post('/:id/renew', requireAdmin, ctrl.renew);
router.put('/:id/toggle', requireAdmin, ctrl.toggle);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
