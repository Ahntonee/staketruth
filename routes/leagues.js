const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/leagues');
const { requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.listLeagues);
router.get('/:id', ctrl.getLeague);
router.post('/', requireAdmin, ctrl.createLeague);
router.put('/:id', requireAdmin, ctrl.updateLeague);
router.delete('/:id', requireAdmin, ctrl.deleteLeague);

module.exports = router;
