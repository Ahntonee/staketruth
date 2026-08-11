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
 * Finds live bookmaker odds for a specific fixture by fuzzy team-name match
 * within ±1 day of the given kickoff.
 */
async function getLiveOddsForFixture(homeTeam, awayTeam, commenceDateISO) {
  const result = await fetchSoccerOdds();
  if (result.skipped || !Array.isArray(result.events)) return null;

  const home = normaliseName(homeTeam);
  const away = normaliseName(awayTeam);
  const target = new Date(commenceDateISO).getTime();

  const match = result.events.find((event) => {
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

async function syncOddsForTodayFixtures() {
  const [predictions] = await pool.query(
    `SELECT id, home_team, away_team, match_date FROM predictions
     WHERE result = 'pending' AND match_date >= NOW() AND match_date <= DATE_ADD(NOW(), INTERVAL 2 DAY)`
  );
  let updated = 0;
  for (const pred of predictions) {
    const odds = await getLiveOddsForFixture(pred.home_team, pred.away_team, pred.match_date);
    if (odds && odds.bookmakers.length) {
      await pool.query('UPDATE predictions SET bookies_available = ? WHERE id = ?', [
        JSON.stringify(odds.bookmakers), pred.id,
      ]);
      updated++;
    }
  }
  return { checked: predictions.length, updated };
}

module.exports = {
  getLiveOddsForFixture,
  getAvailableSports,
  syncOddsForTodayFixtures,
  getCallsToday,
  resetCallsToday,
};
