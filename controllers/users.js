const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, sanitiseText } = require('../utils/helpers');

const getProfile = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, country, timezone, telegram_invited, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  return successResponse(res, rows[0]);
});

const updateProfile = asyncHandler(async (req, res) => {
  const name = req.body.name ? sanitiseText(req.body.name) : undefined;
  const country = req.body.country ? sanitiseText(req.body.country) : undefined;
  const fields = [];
  const values = [];
  if (name) { fields.push('name = ?'); values.push(name); }
  if (country) { fields.push('country = ?'); values.push(country); }
  if (!fields.length) return errorResponse(res, 'No valid fields to update', 400);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...values, req.user.id]);
  return successResponse(res, { message: 'Profile updated' });
});

const markTelegramInvited = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET telegram_invited = 1 WHERE id = ?', [req.user.id]);
  return successResponse(res, { message: 'Marked as invited' });
});

const getBookmarks = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.slug, p.home_team, p.away_team, p.match_date, p.tip, p.result
     FROM bookmarks b JOIN predictions p ON p.id = b.prediction_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  return successResponse(res, rows);
});

const addBookmark = asyncHandler(async (req, res) => {
  try {
    await pool.query('INSERT INTO bookmarks (user_id, prediction_id) VALUES (?, ?)', [req.user.id, req.params.predictionId]);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
  }
  return successResponse(res, { message: 'Bookmarked' }, undefined, 201);
});

const removeBookmark = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM bookmarks WHERE user_id = ? AND prediction_id = ?', [req.user.id, req.params.predictionId]);
  return successResponse(res, { message: 'Bookmark removed' });
});

const getBetHistory = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.*, p.home_team, p.away_team, p.tip FROM bet_history b
     LEFT JOIN predictions p ON p.id = b.prediction_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  const totalPnl = rows.reduce((sum, r) => sum + Number(r.profit_loss || 0), 0);
  return successResponse(res, rows, { totalPnl: totalPnl.toFixed(2) });
});

const addBetHistory = asyncHandler(async (req, res) => {
  const { prediction_id, stake, odds, result, notes } = req.body;
  let profitLoss = 0;
  if (result === 'won') profitLoss = stake * (odds - 1);
  else if (result === 'lost') profitLoss = -stake;
  const [inserted] = await pool.query(
    'INSERT INTO bet_history (user_id, prediction_id, stake, odds, result, profit_loss, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, prediction_id || null, stake, odds || null, result || 'void', profitLoss, notes || null]
  );
  return successResponse(res, { id: inserted.insertId }, undefined, 201);
});

const deleteBetHistory = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM bet_history WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  return successResponse(res, { message: 'Deleted' });
});

const deleteAccount = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = ?', [req.user.id]);
  const { clearTokenCookie } = require('../utils/jwt');
  clearTokenCookie(res);
  return successResponse(res, { message: 'Account deleted' });
});

module.exports = {
  getProfile, updateProfile, markTelegramInvited, getBookmarks, addBookmark, removeBookmark,
  getBetHistory, addBetHistory, deleteBetHistory, deleteAccount,
};
