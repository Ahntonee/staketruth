const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/betBuilder');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.get('/', ctrl.listMySlips);
router.post('/', ctrl.createSlip);
router.delete('/:id', ctrl.deleteSlip);

module.exports = router;
