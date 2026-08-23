const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination, paginate, generateBlogSlug } = require('../utils/helpers');

const listPosts = asyncHandler(async (req, res) => {
  const { category, published } = req.query;
  const { page, limit, offset } = parsePagination(req.query, 12);
  const where = [];
  const params = [];
  if (published !== 'false') { where.push('is_published = 1'); }
  if (category) { where.push('category = ?'); params.push(category); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM blog_posts ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT id, slug, title, excerpt, featured_image, category, author_name, published_at, created_at
     FROM blog_posts ${whereSql} ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, rows, paginate(countRows[0].cnt, page, limit));
});

const getPost = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM blog_posts WHERE slug = ? AND is_published = 1', [req.params.slug]);
  if (!rows.length) return errorResponse(res, 'Post not found', 404);
  const post = rows[0];
  const [related] = await pool.query(
    'SELECT slug, title, featured_image FROM blog_posts WHERE category = ? AND slug != ? AND is_published = 1 ORDER BY published_at DESC LIMIT 3',
    [post.category, post.slug]
  );
  return successResponse(res, { ...post, related });
});

const createPost = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.meta_title && b.meta_title.length > 255) {
    return errorResponse(res, 'Meta Title is too long (max 255 characters) -- that field is for a short SEO title, not a full description.', 422);
  }
  const slug = generateBlogSlug(b.title);
  const scheduledAt = b.scheduled_publish_at || null;
  const [result] = await pool.query(
    `INSERT INTO blog_posts (slug, title, excerpt, content, featured_image, category, author_name,
      meta_title, meta_description, keywords, is_published, published_at, scheduled_publish_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 1, NOW(), NULL), ?)`,
    [slug, b.title, b.excerpt || null, b.content || '', b.featured_image || null, b.category || null,
      b.author_name || 'StakeTruth Team', b.meta_title || b.title, b.meta_description || b.excerpt || null,
      b.keywords || null, b.is_published ? 1 : 0, b.is_published ? 1 : 0, scheduledAt]
  );
  return successResponse(res, { id: result.insertId, slug }, undefined, 201);
});

const updatePost = asyncHandler(async (req, res) => {
  if (req.body.meta_title && req.body.meta_title.length > 255) {
    return errorResponse(res, 'Meta Title is too long (max 255 characters) -- that field is for a short SEO title, not a full description.', 422);
  }
  const fields = ['title', 'excerpt', 'content', 'featured_image', 'category', 'author_name',
    'meta_title', 'meta_description', 'keywords', 'is_published', 'scheduled_publish_at'].filter((f) => f in req.body);
  if (!fields.length) return errorResponse(res, 'No valid fields to update', 400);
  var setSql = fields.map((f) => `${f} = ?`).join(', ');
  var values = fields.map((f) => (typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]));
  // updatePost previously never touched published_at, so publishing a post
  // through the edit form (as opposed to the dedicated Publish button) left
  // it permanently NULL -- only backfill it, never overwrite an existing one.
  if ('is_published' in req.body && req.body.is_published) {
    setSql += `, published_at = IF(published_at IS NULL, NOW(), published_at)`;
  }
  await pool.query(`UPDATE blog_posts SET ${setSql} WHERE id = ?`, [...values, req.params.id]);
  return successResponse(res, { message: 'Post updated' });
});

const deletePost = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM blog_posts WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Post deleted' });
});

const togglePublish = asyncHandler(async (req, res) => {
  await pool.query('UPDATE blog_posts SET is_published = ?, published_at = IF(? = 1, NOW(), published_at) WHERE id = ?', [
    req.body.is_published ? 1 : 0, req.body.is_published ? 1 : 0, req.params.id,
  ]);
  return successResponse(res, { message: 'Publish state updated' });
});

const uploadImage = asyncHandler(async (req, res) => {
  // Images are pasted as base64 data URLs from EasyMDE's uploader and stored
  // inline in blog_posts.content / featured_image (LONGTEXT) — no filesystem writes.
  const { dataUrl } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return errorResponse(res, 'A valid image data URL is required', 400);
  return successResponse(res, { url: dataUrl });
});

const adminList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, slug, title, category, is_published, published_at, scheduled_publish_at, created_at FROM blog_posts ORDER BY created_at DESC');
  return successResponse(res, rows);
});

// Unlike getPost (public, published-only by slug), this returns a post by id
// regardless of publish state — the admin editor needs to open drafts too.
const adminGetById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM blog_posts WHERE id = ?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Post not found', 404);
  return successResponse(res, rows[0]);
});

module.exports = { listPosts, getPost, createPost, updatePost, deletePost, togglePublish, uploadImage, adminList, adminGetById };
