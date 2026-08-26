const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { serializePrediction, getLockReason } = require('./predictions');
const { combinedOdds, combinedResult } = require('../services/accumulators');

// Personal planning tool: a logged-in user picks from currently-published
// predictions to build and save their own combo. No real transactions --
// purely informational, so no gating beyond "must be logged in" and no
// lockReason logic (a user viewing their own saved slip already had access
// to see each of those predictions when they picked them).
async function legsForSlip(slipId) {
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name, usl.sort_order
     FROM user_bet_slip_legs usl
     JOIN predictions p ON p.id = usl.prediction_id
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE usl.slip_id = ? ORDER BY usl.sort_order ASC, usl.id ASC`,
    [slipId]
  );
  return rows;
}

const listMySlips = asyncHandler(async (req, res) => {
  const [slips] = await pool.query(
    'SELECT * FROM user_bet_slips WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]
  );
  const data = [];
  for (const slip of slips) {
    const legRows = await legsForSlip(slip.id);
    data.push({
      id: slip.id,
      title: slip.title,
      created_at: slip.created_at,
      combined_odds: combinedOdds(legRows),
      result: combinedResult(legRows),
      legs: legRows.map((r) => serializePrediction(r, req.user.role)),
    });
  }
  return successResponse(res, data);
});

const createSlip = asyncHandler(async (req, res) => {
  const { title, prediction_ids } = req.body;
  if (!Array.isArray(prediction_ids) || prediction_ids.length < 2) {
    return errorResponse(res, 'Pick at least 2 predictions to build a slip', 400);
  }
  // Only allow legs the user could actually see -- currently published picks
  // they're not locked out of. Prevents saving a slip full of VIP picks a
  // free user only ever saw the locked/teaser version of.
  const [rows] = await pool.query(
    `SELECT id, is_vip, is_banker, pushed_to_registered FROM predictions WHERE id IN (?) AND is_published = 1`,
    [prediction_ids]
  );
  const viewable = rows.filter((r) => !getLockReason(r, req.user.role)).map((r) => r.id);
  if (viewable.length < 2) return errorResponse(res, 'Not enough viewable predictions among your selection', 400);

  const [result] = await pool.query(
    'INSERT INTO user_bet_slips (user_id, title) VALUES (?, ?)', [req.user.id, title || null]
  );
  const slipId = result.insertId;
  let order = 0;
  for (const predictionId of viewable) {
    await pool.query(
      'INSERT INTO user_bet_slip_legs (slip_id, prediction_id, sort_order) VALUES (?, ?, ?)',
      [slipId, predictionId, order++]
    );
  }
  return successResponse(res, { id: slipId }, null, 201);
});

const deleteSlip = asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    'DELETE FROM user_bet_slips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Slip not found', 404);
  return successResponse(res, { message: 'Deleted' });
});

module.exports = { listMySlips, createSlip, deleteSlip };
