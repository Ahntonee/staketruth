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
  const canPublish = await engine.tryReservePublishSlot(req.params.id);
  if (!canPublish) {
    return errorResponse(res, `Published predictions are at the cap (${engine.PUBLISHED_CAP}) -- wait for a graded pick to free up a slot, or unpublish one manually.`, 409);
  }
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

// ---- Per-league browser: League Overview / Standings / Match Intel / Accuracy ----

const getLeagueOverview = asyncHandler(async (req, res) => {
  const leagueId = req.params.leagueId;
  const [[league]] = await pool.query('SELECT id, name, country FROM leagues WHERE id = ?', [leagueId]);
  if (!league) return errorResponse(res, 'League not found', 404);
  const [[stats]] = await pool.query(
    `SELECT matches_played, goals_per_game, btts_percentage, over_1_5_percentage, over_2_5_percentage,
            over_3_5_percentage, home_win_percentage, away_win_percentage, draw_percentage, season
     FROM league_statistics WHERE league_id = ? ORDER BY season DESC LIMIT 1`,
    [leagueId]
  );
  const [[predCounts]] = await pool.query(
    `SELECT COUNT(*) AS total_predictions, SUM(result = 'pending') AS upcoming, SUM(result IN ('won','lost')) AS settled
     FROM predictions WHERE league_id = ?`,
    [leagueId]
  );
  return successResponse(res, { league, stats: stats || null, predictions: predCounts });
});

const getLeagueStandings = asyncHandler(async (req, res) => {
  const leagueId = req.params.leagueId;
  const [rows] = await pool.query(
    `SELECT * FROM league_standings WHERE league_id = ? AND season = (
       SELECT MAX(season) FROM league_standings WHERE league_id = ?
     ) ORDER BY \`rank\` ASC`,
    [leagueId, leagueId]
  );
  return successResponse(res, rows);
});

const syncLeagueStandings = asyncHandler(async (req, res) => {
  const apiFootball = require('../services/apiFootball');
  const result = await apiFootball.syncStandingsForLeague(req.params.leagueId);
  return successResponse(res, result);
});

const getMatchIntel = asyncHandler(async (req, res) => {
  const leagueId = req.params.leagueId;
  const [rows] = await pool.query(
    `SELECT id, home_team, away_team, match_date, tip, category, intelligence_score, analysis, is_published, result
     FROM predictions WHERE league_id = ? AND match_date >= DATE_SUB(NOW(), INTERVAL 3 DAY)
     ORDER BY match_date ASC LIMIT 50`,
    [leagueId]
  );
  return successResponse(res, rows);
});

const getLeagueAccuracy = asyncHandler(async (req, res) => {
  const leagueId = req.params.leagueId;
  const [rows] = await pool.query(
    `SELECT p.category AS group_label, COUNT(*) AS total,
            SUM(p.result = 'won') AS wins, SUM(p.result = 'lost') AS losses
     FROM predictions p
     WHERE p.league_id = ? AND p.result IN ('won','lost')
     GROUP BY p.category HAVING total >= 1
     ORDER BY wins DESC`,
    [leagueId]
  );
  const data = rows.map((r) => ({ ...r, win_rate: r.total ? ((r.wins / r.total) * 100).toFixed(1) : '0.0' }));
  return successResponse(res, data);
});

module.exports = {
  getStatus, getWeights, putWeights, getQueue, approveQueueItem, rejectQueueItem,
  getPatterns, getPerformance, getProfitability, runNow,
  getLeagueOverview, getLeagueStandings, syncLeagueStandings, getMatchIntel, getLeagueAccuracy,
};
