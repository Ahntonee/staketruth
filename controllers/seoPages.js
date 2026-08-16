const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { serializePrediction } = require('./predictions');

const ALLOWED_FIELDS = ['slug', 'title', 'meta_description', 'h1', 'intro_content', 'league_id', 'category', 'is_published'];

const adminList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT sp.*, l.name AS league_name FROM seo_landing_pages sp
     LEFT JOIN leagues l ON l.id = sp.league_id ORDER BY sp.created_at DESC`
  );
  return successResponse(res, rows);
});

const adminGetById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_landing_pages WHERE id = ?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Not found', 404);
  return successResponse(res, rows[0]);
});

const create = asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.slug || !b.title) return errorResponse(res, 'slug and title are required', 400);
  const [result] = await pool.query(
    `INSERT INTO seo_landing_pages (slug, title, meta_description, h1, intro_content, league_id, category, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.slug, b.title, b.meta_description || null, b.h1 || b.title, b.intro_content || null,
      b.league_id || null, b.category || null, b.is_published === false ? 0 : 1]
  );
  return successResponse(res, { id: result.insertId }, undefined, 201);
});

const update = asyncHandler(async (req, res) => {
  const fields = Object.keys(req.body).filter((k) => ALLOWED_FIELDS.includes(k));
  if (!fields.length) return errorResponse(res, 'No valid fields to update', 400);
  const setSql = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]));
  await pool.query(`UPDATE seo_landing_pages SET ${setSql} WHERE id = ?`, [...values, req.params.id]);
  return successResponse(res, { message: 'Page updated' });
});

const remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM seo_landing_pages WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Page deleted' });
});

// Public route -- identical content for search engines and real visitors (no
// cloaking). Renders the page's own intro copy plus a live, real predictions
// list filtered by the page's league/category, gated by the same role-based
// lock rules as the main predictions page.
const getPublic = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT sp.*, l.name AS league_name FROM seo_landing_pages sp
     LEFT JOIN leagues l ON l.id = sp.league_id WHERE sp.slug = ? AND sp.is_published = 1`,
    [req.params.slug]
  );
  if (!rows.length) return errorResponse(res, 'Page not found', 404);
  const page = rows[0];

  const where = ['p.is_published = 1'];
  const params = [];
  if (page.league_id) { where.push('p.league_id = ?'); params.push(page.league_id); }
  if (page.category) { where.push('p.category = ?'); params.push(page.category); }
  const [predictionRows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE ${where.join(' AND ')} ORDER BY p.match_date ASC LIMIT 20`,
    params
  );
  const role = req.user ? req.user.role : 'guest';
  return successResponse(res, {
    page,
    predictions: predictionRows.map((r) => serializePrediction(r, role)),
  });
});

module.exports = { adminList, adminGetById, create, update, remove, getPublic };
