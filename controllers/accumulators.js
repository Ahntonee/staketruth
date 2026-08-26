const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { serializePrediction, getLockReason } = require('./predictions');
const { combinedOdds, combinedResult } = require('../services/accumulators');

function getRole(req) {
  return req.user ? req.user.role : 'guest';
}

async function legsForAccumulator(accumulatorId) {
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name, al.sort_order
     FROM accumulator_legs al
     JOIN predictions p ON p.id = al.prediction_id
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE al.accumulator_id = ? ORDER BY al.sort_order ASC, al.id ASC`,
    [accumulatorId]
  );
  return rows;
}

// Truth Safe Picks are gated exactly like an individual VIP pick -- guests and
// free users get a locked teaser, VIP/admin see the full leg-by-leg breakdown.
const listPublicAccumulators = asyncHandler(async (req, res) => {
  const role = getRole(req);
  const lockReason = getLockReason({ is_vip: 1, is_banker: 0, pushed_to_registered: 0 }, role);
  const [accas] = await pool.query(
    `SELECT * FROM accumulators WHERE is_published = 1 ORDER BY published_at DESC LIMIT 20`
  );
  const data = [];
  for (const acca of accas) {
    const legRows = lockReason ? [] : await legsForAccumulator(acca.id);
    data.push({
      id: acca.id,
      title: acca.title,
      lockReason,
      legCount: lockReason ? null : legRows.length,
      combined_odds: lockReason ? null : combinedOdds(legRows),
      result: lockReason ? null : combinedResult(legRows),
      legs: lockReason ? [] : legRows.map((r) => serializePrediction(r, role)),
      published_at: acca.published_at,
    });
  }
  return successResponse(res, data);
});

const adminListAccumulators = asyncHandler(async (req, res) => {
  const [accas] = await pool.query(`SELECT * FROM accumulators ORDER BY created_at DESC LIMIT 100`);
  const data = [];
  for (const acca of accas) {
    const legRows = await legsForAccumulator(acca.id);
    data.push({
      ...acca,
      legs: legRows,
      combined_odds: combinedOdds(legRows),
      result: combinedResult(legRows),
    });
  }
  return successResponse(res, data);
});

const createAccumulator = asyncHandler(async (req, res) => {
  const { title, prediction_ids } = req.body;
  if (!title || !Array.isArray(prediction_ids) || prediction_ids.length < 2) {
    return errorResponse(res, 'A title and at least 2 legs are required', 400);
  }
  const [result] = await pool.query(
    'INSERT INTO accumulators (title, is_published) VALUES (?, 0)', [title]
  );
  const accaId = result.insertId;
  let order = 0;
  for (const predictionId of prediction_ids) {
    await pool.query(
      'INSERT INTO accumulator_legs (accumulator_id, prediction_id, sort_order) VALUES (?, ?, ?)',
      [accaId, predictionId, order++]
    );
  }
  return successResponse(res, { id: accaId }, null, 201);
});

const updateAccumulator = asyncHandler(async (req, res) => {
  const { title, prediction_ids, is_published } = req.body;
  const { id } = req.params;
  if (title !== undefined) await pool.query('UPDATE accumulators SET title = ? WHERE id = ?', [title, id]);
  if (Array.isArray(prediction_ids)) {
    await pool.query('DELETE FROM accumulator_legs WHERE accumulator_id = ?', [id]);
    let order = 0;
    for (const predictionId of prediction_ids) {
      await pool.query(
        'INSERT INTO accumulator_legs (accumulator_id, prediction_id, sort_order) VALUES (?, ?, ?)',
        [id, predictionId, order++]
      );
    }
  }
  if (is_published !== undefined) {
    await pool.query(
      'UPDATE accumulators SET is_published = ?, published_at = IF(? = 1 AND is_published = 0, NOW(), published_at) WHERE id = ?',
      [is_published ? 1 : 0, is_published ? 1 : 0, id]
    );
  }
  return successResponse(res, { message: 'Updated' });
});

const deleteAccumulator = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM accumulators WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Deleted' });
});

module.exports = {
  listPublicAccumulators, adminListAccumulators, createAccumulator, updateAccumulator, deleteAccumulator,
};
