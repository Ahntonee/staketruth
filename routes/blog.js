const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/blog');
const { requireAdmin } = require('../middleware/auth');
const { validateBlog } = require('../middleware/validate');

router.get('/', ctrl.listPosts);
router.get('/admin/list', requireAdmin, ctrl.adminList);
router.get('/admin/:id', requireAdmin, ctrl.adminGetById);
router.get('/:slug', ctrl.getPost);
router.post('/', requireAdmin, validateBlog, ctrl.createPost);
router.put('/:id', requireAdmin, ctrl.updatePost);
router.delete('/:id', requireAdmin, ctrl.deletePost);
router.post('/:id/publish', requireAdmin, ctrl.togglePublish);
router.post('/upload-image', requireAdmin, ctrl.uploadImage);

module.exports = router;
