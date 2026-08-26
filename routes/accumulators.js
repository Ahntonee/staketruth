const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accumulators');
const { requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.listPublicAccumulators);
router.get('/admin/list', requireAdmin, ctrl.adminListAccumulators);
router.post('/', requireAdmin, ctrl.createAccumulator);
router.put('/:id', requireAdmin, ctrl.updateAccumulator);
router.delete('/:id', requireAdmin, ctrl.deleteAccumulator);

module.exports = router;
