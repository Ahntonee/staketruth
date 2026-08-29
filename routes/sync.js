const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { successResponse, asyncHandler, errorResponse } = require('../utils/helpers');
const { pool } = require('../config/db');
const apiFootball = require('../services/apiFootball');
const oddsApi = require('../services/oddsApi');
const intelligence = require('../services/intelligence');
const accuracy = require('../services/accuracy');
const statistics = require('../services/statistics');

router.use(requireAdmin);

async function setLastRun(key) {
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE setting_value = NOW()`,
    [key]
  );
}

router.post('/fixtures', asyncHandler(async (req, res) => {
  const result = await apiFootball.syncTodayAndTomorrow();
  await setLastRun('last_sync_fixtures');
  return successResponse(res, result);
}));

// Sync a single arbitrary date (past or future) — reuses the same per-date
// sync the daily 6am job already calls internally for "today"/"tomorrow",
// just exposed directly so the admin can target any date on demand.
router.post('/fixtures-by-date', asyncHandler(async (req, res) => {
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse(res, 'date is required in YYYY-MM-DD format', 400);
  const target = new Date(`${date}T12:00:00`); // noon avoids UTC-offset rollover to the wrong calendar day
  const result = await apiFootball.syncFixturesForDate(target);
  await setLastRun('last_sync_fixtures');
  return successResponse(res, { date, ...result });
}));

// Bulk future sync: pulls fixtures one day at a time out to `days` days ahead.
// syncFixturesForDate is a single API call per date regardless of league count,
// so even 60+ days is cheap against a normal daily budget. Sequential and
// error-tolerant per-date so one bad day doesn't kill the whole run.
router.post('/fixtures-range', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.body.days) || 60, 1), 180);
  const results = [];
  for (let i = 0; i < days; i++) {
    const target = new Date();
    target.setDate(target.getDate() + i);
    const dateStr = target.toISOString().slice(0, 10);
    try {
      const result = await apiFootball.syncFixturesForDate(target);
      results.push({ date: dateStr, ...result });
      if (result.skipped) break; // budget/config exhausted — no point continuing
    } catch (err) {
      results.push({ date: dateStr, skipped: true, reason: err.message });
    }
  }
  await setLastRun('last_sync_fixtures');
  const totalCreated = results.reduce((sum, r) => sum + (r.created || 0), 0);

  // Score everything just synced (widened window matches the sync range,
  // not the usual 2-day default) so a bulk range sync doesn't need a separate
  // manual "Run Auto-Predict" click afterward. NOTE: confidence scores are
  // computed from today's team form/H2H data -- for fixtures weeks or months
  // out, form will drift before the match actually happens, so scores this
  // far ahead are a snapshot, not a final read. Re-running auto-predict closer
  // to match day will naturally refresh anything not yet scored, but already-
  // scored rows are not re-evaluated automatically.
  const scoring = await intelligence.runForAllToday(days);

  return successResponse(res, { daysProcessed: results.length, totalCreated, results, scoring });
}));

router.post('/results', asyncHandler(async (req, res) => {
  const result = await apiFootball.syncResults();
  await setLastRun('last_sync_results');
  return successResponse(res, result);
}));

router.post('/live', asyncHandler(async (req, res) => successResponse(res, await apiFootball.syncLiveScores())));

router.post('/scores', asyncHandler(async (req, res) => successResponse(res, await apiFootball.syncResults())));

router.post('/auto-predict', asyncHandler(async (req, res) => successResponse(res, await intelligence.runForAllToday())));

router.post('/auto-predict/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, home_team, away_team, league_id, match_date FROM predictions WHERE id = ?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Prediction not found', 404);
  const result = await intelligence.runForPrediction(rows[0]);
  return successResponse(res, result);
}));

router.post('/odds', asyncHandler(async (req, res) => successResponse(res, await oddsApi.syncOddsForTodayFixtures())));

// Broader than /odds: every pending prediction still missing odds, not just
// the next 2 days -- still only one Odds API call total per run (see
// oddsApi.syncOddsForAllPendingFixtures), just applied against a wider set
// of predictions already sitting in the database.
router.post('/odds-backfill', asyncHandler(async (req, res) => successResponse(res, await oddsApi.syncOddsForAllPendingFixtures())));

router.post('/statistics', asyncHandler(async (req, res) => {
  const team = await statistics.refreshTeamStatistics();
  const league = await statistics.refreshLeagueStatistics();
  const market = await statistics.refreshMarketStats();
  return successResponse(res, { team, league, market });
}));

router.post('/accuracy', asyncHandler(async (req, res) => {
  const logged = await accuracy.logUntracked();
  const stats = await accuracy.recalculateStats();
  return successResponse(res, { logged, stats });
}));

router.post('/profitability', asyncHandler(async (req, res) => successResponse(res, await statistics.computeProfitability())));

router.post('/historical', asyncHandler(async (req, res) => {
  const { api_league_id, seasons_back } = req.body;
  if (!api_league_id) return errorResponse(res, 'api_league_id is required', 400);
  const result = await apiFootball.syncHistoricalFixtures(api_league_id, seasons_back || 3);
  return successResponse(res, result);
}));

// Bulk variant: backfills every league flagged is_popular in one go, sequentially
// (so a single slow/rate-limited call can't stampede the API-Football budget).
// API-Football's free/basic tiers cap historical depth at ~2 seasons back, hence
// the default of 2 here rather than the single-league route's default of 3.
router.post('/historical-bulk', asyncHandler(async (req, res) => {
  const seasonsBack = req.body.seasons_back || 2;
  const [leagues] = await pool.query('SELECT api_league_id, name FROM leagues WHERE is_popular = 1 AND api_league_id IS NOT NULL');
  const results = [];
  for (const league of leagues) {
    try {
      const result = await apiFootball.syncHistoricalFixtures(league.api_league_id, seasonsBack);
      results.push({ league: league.name, api_league_id: league.api_league_id, ...result });
      if (result.skipped) break; // budget exhausted — no point continuing the loop
    } catch (err) {
      results.push({ league: league.name, api_league_id: league.api_league_id, skipped: true, reason: err.message });
    }
  }
  return successResponse(res, { leaguesProcessed: results.length, results });
}));

router.get('/status', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key LIKE 'last_%'`
  );
  const apiBudget = await apiFootball.getRemainingCount();
  const oddsCallsToday = await oddsApi.getCallsToday();
  return successResponse(res, {
    lastRuns: Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])),
    apiFootballBudget: apiBudget,
    oddsApiCallsToday: oddsCallsToday,
  });
}));

module.exports = router;
