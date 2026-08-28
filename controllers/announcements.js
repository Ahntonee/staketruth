const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

// Public: active, non-expired announcements only, most recent first.
const listPublic = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, title, content, link_url, link_label, created_at FROM announcements
     WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT 5`
  );
  return successResponse(res, rows);
});

const listAdmin = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  return successResponse(res, rows);
});

const create = asyncHandler(async (req, res) => {
  const { title, content, link_url, link_label, is_active, expires_at } = req.body;
  if (!title) return errorResponse(res, 'Title is required', 400);
  const [result] = await pool.query(
    `INSERT INTO announcements (title, content, link_url, link_label, is_active, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [title, content || null, link_url || null, link_label || null, is_active === false ? 0 : 1, expires_at || null]
  );
  return successResponse(res, { id: result.insertId }, null, 201);
});

const update = asyncHandler(async (req, res) => {
  const { title, content, link_url, link_label, is_active, expires_at } = req.body;
  await pool.query(
    `UPDATE announcements SET title = ?, content = ?, link_url = ?, link_label = ?, is_active = ?, expires_at = ? WHERE id = ?`,
    [title, content || null, link_url || null, link_label || null, is_active ? 1 : 0, expires_at || null, req.params.id]
  );
  return successResponse(res, { message: 'Updated' });
});

const remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Deleted' });
});

module.exports = { listPublic, listAdmin, create, update, remove };
