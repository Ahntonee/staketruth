const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/seoPages');
const { requireAdmin } = require('../middleware/auth');

router.get('/admin/list', requireAdmin, ctrl.adminList);
router.get('/admin/:id', requireAdmin, ctrl.adminGetById);
router.post('/', requireAdmin, ctrl.create);
router.put('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);
router.get('/:slug', ctrl.getPublic);

module.exports = router;
