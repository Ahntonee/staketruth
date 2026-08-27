const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/pages');
const { requireAdmin } = require('../middleware/auth');

router.get('/social-links', ctrl.getSocialLinks);
router.get('/affiliate-config', ctrl.getAffiliateConfig);
router.get('/seo', requireAdmin, ctrl.getAllSeo);
router.get('/seo/:pageKey', ctrl.getSeoForPage);
router.put('/seo/:pageKey', requireAdmin, ctrl.updateSeo);
router.get('/:slug', ctrl.getPage);
router.put('/:slug', requireAdmin, ctrl.updatePage);

module.exports = router;
