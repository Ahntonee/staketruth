const axios = require('axios');
const { pool } = require('../config/db');

const BASE_URL = process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4';
const DAILY_BUDGET = 500; // free tier req/month ≈ ~16/day safety-budgeted here per-day

function client() {
  return axios.create({ baseURL: BASE_URL, timeout: 10000 });
}

async function getCallsToday() {
  const [rows] = await pool.query(`SELECT setting_value FROM site_settings WHERE setting_key = 'odds_api_calls_today'`);
  return rows.length ? Number(rows[0].setting_value) || 0 : 0;
}

async function incrementCallsToday(by = 1) {
  const current = await getCallsToday();
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('odds_api_calls_today', ?)
     ON DUPLICATE KEY UPDATE setting_value = ?`,
    [String(current + by), String(current + by)]
  );
}

async function resetCallsToday() {
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('odds_api_calls_today', '0')
     ON DUPLICATE KEY UPDATE setting_value = '0'`
  );
}

function normaliseName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchSoccerOdds() {
  if (!process.env.ODDS_API_KEY || process.env.ODDS_API_KEY === 'YOUR_ODDS_API_KEY') {
    return { skipped: true, reason: 'ODDS_API_KEY not configured' };
  }
  const callsToday = await getCallsToday();
  if (callsToday >= DAILY_BUDGET) {
    return { skipped: true, reason: 'daily Odds API budget exhausted' };
  }
  try {
    const { data } = await client().get('/sports/soccer/odds/', {
      params: { regions: 'uk,eu,us,af', markets: 'h2h,totals', apiKey: process.env.ODDS_API_KEY },
    });
    await incrementCallsToday(1);
    return { skipped: false, events: data };
  } catch (err) {
    console.error('[oddsApi] fetchSoccerOdds failed:', err.message);
    return { skipped: true, reason: err.message };
  }
}

/**
 * Matches a specific fixture against an already-fetched odds feed (see
 * fetchSoccerOdds) by fuzzy team-name match within ±1 day of kickoff. Takes
 * the feed as a parameter rather than fetching it itself -- fetchSoccerOdds
 * returns the ENTIRE soccer odds feed in one call regardless of which
 * fixture you're looking for, so calling it once per fixture inside a loop
 * (the previous shape of this function) burned one full-feed API call per
 * fixture for identical data every time.
 */
function matchOddsForFixture(events, homeTeam, awayTeam, commenceDateISO) {
  const home = normaliseName(homeTeam);
  const away = normaliseName(awayTeam);
  const target = new Date(commenceDateISO).getTime();

  const match = events.find((event) => {
    const eh = normaliseName(event.home_team);
    const ea = normaliseName(event.away_team);
    const sameFixture = (eh.includes(home) || home.includes(eh)) && (ea.includes(away) || away.includes(ea));
    if (!sameFixture) return false;
    const diffMs = Math.abs(new Date(event.commence_time).getTime() - target);
    return diffMs <= 24 * 60 * 60 * 1000;
  });

  if (!match) return null;

  const bookmakers = (match.bookmakers || []).map((b) => b.title);
  let homeOdds = null, drawOdds = null, awayOdds = null, over25Odds = null, under25Odds = null;

  for (const bm of match.bookmakers || []) {
    const h2h = bm.markets?.find((m) => m.key === 'h2h');
    if (h2h && !homeOdds) {
      for (const outcome of h2h.outcomes) {
        if (normaliseName(outcome.name) === home) homeOdds = outcome.price;
        else if (normaliseName(outcome.name) === away) awayOdds = outcome.price;
        else if (/draw/i.test(outcome.name)) drawOdds = outcome.price;
      }
    }
    const totals = bm.markets?.find((m) => m.key === 'totals');
    if (totals && !over25Odds) {
      for (const outcome of totals.outcomes) {
        if (outcome.point === 2.5 && /over/i.test(outcome.name)) over25Odds = outcome.price;
        if (outcome.point === 2.5 && /under/i.test(outcome.name)) under25Odds = outcome.price;
      }
    }
  }

  return { bookmakers, homeOdds, drawOdds, awayOdds, over25Odds, under25Odds };
}

async function getAvailableSports() {
  if (!process.env.ODDS_API_KEY || process.env.ODDS_API_KEY === 'YOUR_ODDS_API_KEY') return [];
  try {
    const { data } = await client().get('/sports', { params: { apiKey: process.env.ODDS_API_KEY } });
    return data.filter((s) => /soccer/i.test(s.group));
  } catch (err) {
    console.error('[oddsApi] getAvailableSports failed:', err.message);
    return [];
  }
}

// Applies one already-fetched odds feed against a list of predictions,
// in-memory only -- shared by both sync functions below so neither makes
// more than the single fetchSoccerOdds() call the whole run needs.
async function applyOddsToPredictions(predictions, events) {
  let updated = 0;
  for (const pred of predictions) {
    const odds = matchOddsForFixture(events, pred.home_team, pred.away_team, pred.match_date);
    if (odds && odds.bookmakers.length) {
      await pool.query('UPDATE predictions SET bookies_available = ? WHERE id = ?', [
        JSON.stringify(odds.bookmakers), pred.id,
      ]);
      updated++;
    }
  }
  return updated;
}

async function syncOddsForTodayFixtures() {
  const [predictions] = await pool.query(
    `SELECT id, home_team, away_team, match_date FROM predictions
     WHERE result = 'pending' AND match_date >= NOW() AND match_date <= DATE_ADD(NOW(), INTERVAL 2 DAY)`
  );
  if (!predictions.length) return { checked: 0, updated: 0 };
  const result = await fetchSoccerOdds();
  if (result.skipped) return { checked: predictions.length, updated: 0, skipped: true, reason: result.reason };
  const updated = await applyOddsToPredictions(predictions, result.events);
  return { checked: predictions.length, updated };
}

// Broader than the above: every pending prediction still missing odds,
// regardless of date, not just the next 2 days. The-odds-api itself only
// carries odds for near-term matches, so anything far in the future simply
// won't find a match and is skipped -- harmless, not an extra API cost,
// since this still only ever calls fetchSoccerOdds() once for the whole run.
async function syncOddsForAllPendingFixtures() {
  const [predictions] = await pool.query(
    `SELECT id, home_team, away_team, match_date FROM predictions
     WHERE result = 'pending' AND (bookies_available IS NULL OR bookies_available = '[]')`
  );
  if (!predictions.length) return { checked: 0, updated: 0 };
  const result = await fetchSoccerOdds();
  if (result.skipped) return { checked: predictions.length, updated: 0, skipped: true, reason: result.reason };
  const updated = await applyOddsToPredictions(predictions, result.events);
  return { checked: predictions.length, updated };
}

module.exports = {
  getAvailableSports,
  syncOddsForTodayFixtures,
  syncOddsForAllPendingFixtures,
  getCallsToday,
  resetCallsToday,
};
