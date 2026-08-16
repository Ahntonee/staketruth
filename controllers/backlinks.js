const { pool } = require('../config/db');
const { successResponse, asyncHandler, errorResponse } = require('../utils/helpers');

const getActive = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, url FROM backlinks WHERE is_active = 1 AND expires_at > NOW() ORDER BY created_at DESC`
  );
  return successResponse(res, rows);
});

const adminList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM backlinks ORDER BY expires_at ASC`);
  return successResponse(res, rows);
});

const create = asyncHandler(async (req, res) => {
  const { name, url, duration_days } = req.body;
  if (!name || !url) return errorResponse(res, 'name and url are required', 400);
  const days = Number(duration_days) || 30;
  const [result] = await pool.query(
    `INSERT INTO backlinks (name, url, duration_days, expires_at, is_active)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 1)`,
    [name, url, days, days]
  );
  return successResponse(res, { id: result.insertId }, undefined, 201);
});

const update = asyncHandler(async (req, res) => {
  const { name, url } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (url !== undefined) { fields.push('url = ?'); values.push(url); }
  if (!fields.length) return errorResponse(res, 'No valid fields to update', 400);
  await pool.query(`UPDATE backlinks SET ${fields.join(', ')} WHERE id = ?`, [...values, req.params.id]);
  return successResponse(res, { message: 'Backlink updated' });
});

// Extends from the current expiry if still active, otherwise from now --
// renewing a lapsed link doesn't silently backdate its new expiry window.
const renew = asyncHandler(async (req, res) => {
  const days = Number(req.body.duration_days) || 30;
  await pool.query(
    `UPDATE backlinks SET expires_at = DATE_ADD(IF(expires_at > NOW(), expires_at, NOW()), INTERVAL ? DAY), is_active = 1 WHERE id = ?`,
    [days, req.params.id]
  );
  return successResponse(res, { message: 'Backlink renewed' });
});

const toggle = asyncHandler(async (req, res) => {
  await pool.query('UPDATE backlinks SET is_active = ? WHERE id = ?', [req.body.is_active ? 1 : 0, req.params.id]);
  return successResponse(res, { message: 'Status updated' });
});

const remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM backlinks WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Backlink deleted' });
});

module.exports = { getActive, adminList, create, update, renew, toggle, remove };
