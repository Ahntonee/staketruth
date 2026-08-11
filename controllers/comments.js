const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, sanitiseText, parsePagination, paginate } = require('../utils/helpers');

const listForPrediction = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.content, c.created_at, u.name AS author_name
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.prediction_id = ? AND c.is_approved = 1 ORDER BY c.created_at DESC`,
    [req.params.predictionId]
  );
  return successResponse(res, rows);
});

const createComment = asyncHandler(async (req, res) => {
  if (req.user.is_comment_banned) return errorResponse(res, 'You are not permitted to comment', 403);
  const content = sanitiseText(req.body.content);
  const [result] = await pool.query(
    'INSERT INTO comments (prediction_id, user_id, content) VALUES (?, ?, ?)',
    [req.params.predictionId, req.user.id, content]
  );
  return successResponse(res, { id: result.insertId, content }, undefined, 201);
});

const deleteComment = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT user_id FROM comments WHERE id = ?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Comment not found', 404);
  if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') return errorResponse(res, 'Not authorised', 403);
  await pool.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Comment deleted' });
});

// ---- Admin moderation (Part 13) -------------------------------------------

const adminList = asyncHandler(async (req, res) => {
  const { prediction_id, is_approved } = req.query;
  const { page, limit, offset } = parsePagination(req.query, 25, 200);
  const where = [];
  const params = [];
  if (prediction_id) { where.push('c.prediction_id = ?'); params.push(prediction_id); }
  if (is_approved !== undefined) { where.push('c.is_approved = ?'); params.push(is_approved === 'true' ? 1 : 0); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM comments c ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT c.*, u.name AS author_name, u.email AS author_email, p.home_team, p.away_team, p.slug
     FROM comments c JOIN users u ON u.id = c.user_id JOIN predictions p ON p.id = c.prediction_id
     ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, rows, paginate(countRows[0].cnt, page, limit));
});

const adminApprove = asyncHandler(async (req, res) => {
  await pool.query('UPDATE comments SET is_approved = ? WHERE id = ?', [req.body.is_approved ? 1 : 0, req.params.id]);
  return successResponse(res, { message: 'Comment moderation updated' });
});

const adminDelete = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Comment deleted' });
});

module.exports = { listForPrediction, createComment, deleteComment, adminList, adminApprove, adminDelete };
