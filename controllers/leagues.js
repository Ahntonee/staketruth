const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

const listLeagues = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM leagues WHERE is_active = 1 ORDER BY is_popular DESC, name ASC');
  if (req.query.grouped === 'true') {
    const grouped = {};
    for (const league of rows) {
      const key = league.continent || 'Other';
      grouped[key] = grouped[key] || [];
      grouped[key].push(league);
    }
    return successResponse(res, grouped);
  }
  return successResponse(res, rows);
});

const getLeague = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM leagues WHERE id = ?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'League not found', 404);
  return successResponse(res, rows[0]);
});

const createLeague = asyncHandler(async (req, res) => {
  const { api_league_id, name, country, continent, logo_url, is_popular } = req.body;
  const [result] = await pool.query(
    'INSERT INTO leagues (api_league_id, name, country, continent, logo_url, is_popular) VALUES (?, ?, ?, ?, ?, ?)',
    [api_league_id || null, name, country || null, continent || null, logo_url || null, is_popular ? 1 : 0]
  );
  return successResponse(res, { id: result.insertId }, undefined, 201);
});

const updateLeague = asyncHandler(async (req, res) => {
  const fields = ['name', 'country', 'continent', 'logo_url', 'is_active', 'is_popular'].filter((f) => f in req.body);
  if (!fields.length) return errorResponse(res, 'No valid fields to update', 400);
  const setSql = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]));
  await pool.query(`UPDATE leagues SET ${setSql} WHERE id = ?`, [...values, req.params.id]);
  return successResponse(res, { message: 'League updated' });
});

const deleteLeague = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM leagues WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'League deleted' });
});

module.exports = { listLeagues, getLeague, createLeague, updateLeague, deleteLeague };
