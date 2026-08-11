const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const engine = require('../services/intelligence');
const weights = require('../services/weights');
const statistics = require('../services/statistics');

const getStatus = asyncHandler(async (req, res) => {
  const [[lastRun]] = await pool.query(`SELECT setting_value FROM site_settings WHERE setting_key = 'last_intelligence_run'`);
  const [[lastPush]] = await pool.query(`SELECT setting_value FROM site_settings WHERE setting_key = 'last_auto_push'`);
  const [[generatedToday]] = await pool.query(`SELECT COUNT(*) AS cnt FROM predictions WHERE source = 'intelligence' AND DATE(created_at) = CURDATE()`);
  const [[autoPublishedToday]] = await pool.query(`SELECT COUNT(*) AS cnt FROM predictions WHERE source = 'intelligence' AND is_published = 1 AND DATE(created_at) = CURDATE()`);
  const [[queueCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM predictions WHERE source = 'intelligence' AND is_published = 0`);
  const [[vipToday]] = await pool.query(`SELECT COUNT(*) AS cnt FROM predictions WHERE is_vip_pick_of_day = 1 AND DATE(match_date) = CURDATE()`);

  return successResponse(res, {
    lastRun: lastRun?.setting_value || null,
    lastAutoPush: lastPush?.setting_value || null,
    generatedToday: generatedToday.cnt,
    autoPublishedToday: autoPublishedToday.cnt,
    reviewQueueCount: queueCount.cnt,
    vipPicksToday: vipToday.cnt,
  });
});

const getWeights = asyncHandler(async (req, res) => {
  const { list } = await weights.getAllWeights();
  return successResponse(res, list);
});

const putWeights = asyncHandler(async (req, res) => {
  await weights.updateWeights(req.body);
  return successResponse(res, { message: 'Weights updated' });
});

const getQueue = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.source = 'intelligence' AND p.is_published = 0 ORDER BY p.intelligence_score DESC`
  );
  return successResponse(res, rows);
});

const approveQueueItem = asyncHandler(async (req, res) => {
  await pool.query('UPDATE predictions SET is_published = 1, published_at = NOW() WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Prediction published' });
});

const rejectQueueItem = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM predictions WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Prediction rejected' });
});

const getPatterns = asyncHandler(async (req, res) => {
  const data = await engine.getPatternInsights();
  return successResponse(res, data);
});

const getPerformance = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const data = await engine.getLearningPerformance(days);
  return successResponse(res, data);
});

// Admin-only, deliberately never exposed on any public endpoint (Part 7/9).
const getProfitability = asyncHandler(async (req, res) => {
  const { type = 'team', market } = req.query;
  const params = [type];
  let sql = 'SELECT * FROM profitability_stats WHERE entity_type = ?';
  if (market) { sql += ' AND market = ?'; params.push(market); }
  sql += ' ORDER BY profit_units DESC LIMIT 25';
  const [rows] = await pool.query(sql, params);
  return successResponse(res, rows);
});

const runNow = asyncHandler(async (req, res) => {
  const apiFootball = require('../services/apiFootball');
  await apiFootball.syncTodayAndTomorrow();
  const result = await engine.runForAllToday();
  return successResponse(res, result);
});

module.exports = {
  getStatus, getWeights, putWeights, getQueue, approveQueueItem, rejectQueueItem,
  getPatterns, getPerformance, getProfitability, runNow,
};
