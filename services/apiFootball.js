const axios = require('axios');
const { pool } = require('../config/db');
const { generatePredictionSlug } = require('../utils/helpers');

const BASE_URL = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';

function isConfigured() {
  return !!process.env.API_FOOTBALL_KEY && process.env.API_FOOTBALL_KEY !== 'YOUR_API_FOOTBALL_KEY';
}

function client() {
  return axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
  });
}

// ---- Self-imposed daily call cap -------------------------------------------
// Independent of API-Football's own plan quota (see getRemainingCount, which
// reads the PROVIDER's real remaining count) -- this is a hard ceiling WE
// enforce ourselves so the app can never spend more than DAILY_CAP calls in a
// day, no matter what triggers the work (cron backlog, an admin bulk backfill,
// etc.). Persisted in site_settings so it survives restarts; getCallsToday()
// self-heals across the UTC day boundary by checking the stored date, so a
// missed midnight reset can't leave a stale count stuck for the next day.
const DAILY_CAP = 2500;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getCallsToday() {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('api_football_calls_today', 'api_football_calls_date')`
  );
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  if (map.api_football_calls_date !== todayStr()) return 0; // count belongs to a previous day
  return Number(map.api_football_calls_today) || 0;
}

async function incrementCallsToday(by = 1) {
  const next = (await getCallsToday()) + by;
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('api_football_calls_today', ?)
     ON DUPLICATE KEY UPDATE setting_value = ?`,
    [String(next), String(next)]
  );
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('api_football_calls_date', ?)
     ON DUPLICATE KEY UPDATE setting_value = ?`,
    [todayStr(), todayStr()]
  );
  return next;
}

async function resetCallsToday() {
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('api_football_calls_today', '0')
     ON DUPLICATE KEY UPDATE setting_value = '0'`
  );
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('api_football_calls_date', ?)
     ON DUPLICATE KEY UPDATE setting_value = ?`,
    [todayStr(), todayStr()]
  );
}

// Call this immediately before every real (non-/status) API-Football request.
// Reserves the call by incrementing the counter BEFORE the request goes out,
// so a crash mid-request still counts it -- undercounting is how a cap gets
// blown, overcounting by one on a rare crash is harmless. Returns false
// without making any network call once the cap is hit; every call site below
// treats that exactly like their existing "budget exhausted" skip path.
async function reserveCall() {
  const used = await getCallsToday();
  if (used >= DAILY_CAP) return false;
  await incrementCallsToday(1);
  return true;
}

async function getRemainingCount() {
  if (!isConfigured()) return { configured: false, remaining: 0, limit: 0 };
  try {
    const { data } = await client().get('/status');
    const reqs = data?.response?.requests;
    return {
      configured: true,
      remaining: reqs ? reqs.limit_day - reqs.current : null,
      limit: reqs?.limit_day ?? null,
      used: reqs?.current ?? null,
    };
  } catch (err) {
    return { configured: true, remaining: null, error: err.message };
  }
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function getActiveLeagueIds() {
  const [rows] = await pool.query('SELECT api_league_id FROM leagues WHERE is_active = 1');
  return rows.map((r) => r.api_league_id);
}

// Excludes youth/reserve/amateur competitions by name pattern -- API-Football's
// compact fixture payload doesn't carry an age-group flag, so the league name
// is the only reliable signal available without an extra lookup call per league.
// Deliberately does NOT exclude women's leagues -- those are senior professional
// football, just not the same competition as the men's equivalent.
const NON_SENIOR_LEAGUE_RE = /\b(U1[0-9]|U2[0-3]|U-1[0-9]|U-2[0-3]|Youth|Junior|Academy|Reserve|II$|B-Team|Development)\b/i;
function isSeniorProfessionalLeague(league) {
  return !NON_SENIOR_LEAGUE_RE.test(league.name || '');
}

// Looks up a league by its API id, auto-creating a row (unpopular, active,
// continent left as 'World' since we don't have a reliable country->continent
// map) the first time we see a fixture from a league not yet in our table.
async function ensureLeague(league) {
  const [existing] = await pool.query('SELECT id FROM leagues WHERE api_league_id = ?', [league.id]);
  if (existing.length) return existing[0].id;
  const [result] = await pool.query(
    `INSERT INTO leagues (api_league_id, name, country, continent, is_popular, is_active) VALUES (?, ?, ?, 'World', 0, 1)`,
    [league.id, league.name, league.country || null]
  );
  return result.insertId;
}

/**
 * Syncs fixtures for a given date across every senior professional league
 * worldwide (not just the leagues already seeded in our table) into
 * `predictions` as un-scored placeholders ready for the Intelligence Engine.
 * One API call covers the whole day, regardless of league count.
 */
async function syncFixturesForDate(date) {
  if (!isConfigured()) return { skipped: true, reason: 'API_FOOTBALL_KEY not configured' };
  if (!(await reserveCall())) return { skipped: true, reason: `Daily API-Football cap (${DAILY_CAP} calls) reached` };
  let created = 0;

  try {
    const { data } = await client().get('/fixtures', { params: { date: dateStr(date) } });

    for (const fx of data.response || []) {
      if (!isSeniorProfessionalLeague(fx.league)) continue;

      const [existing] = await pool.query('SELECT id FROM predictions WHERE api_fixture_id = ?', [fx.fixture.id]);
      if (existing.length) continue;

      const leagueId = await ensureLeague(fx.league);
      const matchDate = new Date(fx.fixture.date).toISOString().slice(0, 19).replace('T', ' ');
      const slug = generatePredictionSlug(fx.teams.home.name, fx.teams.away.name, matchDate);

      await pool.query(
        `INSERT INTO predictions
         (slug, league_id, home_team, away_team, home_team_logo, away_team_logo, match_date,
          tip, market, category, api_fixture_id, source, is_published, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Analysis', '1X2', 'free', ?, 'auto_sync', 0, 'pending')`,
        [slug, leagueId, fx.teams.home.name, fx.teams.away.name, fx.teams.home.logo, fx.teams.away.logo,
          matchDate, fx.fixture.id]
      );
      created++;
    }
  } catch (err) {
    console.error(`[apiFootball] syncFixturesForDate date=${dateStr(date)} failed:`, err.message);
  }
  return { skipped: false, created };
}

async function syncTodayAndTomorrow() {
  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const a = await syncFixturesForDate(today);
  const b = await syncFixturesForDate(tomorrow);
  return { today: a, tomorrow: b };
}

/**
 * Pulls final results for fixtures still marked pending, grades them, and appends
 * the finished match into historical_fixtures for permanent H2H/learning memory.
 */
// Batches up to 20 fixture IDs per API-Football request (their documented
// max for the ids= param, dash-separated) instead of one request per fixture.
// This used to be a plain for-loop making one /fixtures?id=X call per pending
// row -- with a backlog of even a few hundred unfinished fixtures (easy to
// reach once fixtures are synced weeks ahead), that meant hundreds of calls
// EVERY 20 minutes (this runs on a cron), which is what was actually burning
// through the whole daily API budget, not routine day-to-day usage.
const FIXTURE_BATCH_SIZE = 20;

async function syncResults() {
  if (!isConfigured()) return { skipped: true, reason: 'API_FOOTBALL_KEY not configured' };
  const [pending] = await pool.query(
    `SELECT id, api_fixture_id, home_team, away_team, tip, market, league_id, match_date
     FROM predictions WHERE result = 'pending' AND api_fixture_id IS NOT NULL AND match_date <= NOW()`
  );
  if (!pending.length) return { skipped: false, graded: 0 };

  const byFixtureId = new Map(pending.map((p) => [String(p.api_fixture_id), p]));
  let graded = 0;
  let apiCalls = 0;

  for (let i = 0; i < pending.length; i += FIXTURE_BATCH_SIZE) {
    const batch = pending.slice(i, i + FIXTURE_BATCH_SIZE);
    if (!(await reserveCall())) {
      console.warn(`[apiFootball] syncResults stopping early -- daily cap (${DAILY_CAP} calls) reached`);
      break;
    }
    try {
      apiCalls++;
      const { data } = await client().get('/fixtures', { params: { ids: batch.map((p) => p.api_fixture_id).join('-') } });
      for (const fx of data.response || []) {
        const pred = byFixtureId.get(String(fx.fixture.id));
        if (!pred || fx.fixture.status.short !== 'FT') continue;

        const homeScore = fx.goals.home;
        const awayScore = fx.goals.away;
        const isCorrect = evaluateTipOutcome(pred.tip, pred.market, homeScore, awayScore);

        await pool.query(
          `UPDATE predictions SET result = ?, home_score = ?, away_score = ? WHERE id = ?`,
          [isCorrect ? 'won' : 'lost', homeScore, awayScore, pred.id]
        );

        const [leagueRow] = await pool.query('SELECT api_league_id FROM leagues WHERE id = ?', [pred.league_id]);
        await pool.query(
          `INSERT INTO historical_fixtures
           (api_fixture_id, league_id, api_league_id, season, home_team, away_team, match_date,
            home_score, away_score, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FT')
           ON DUPLICATE KEY UPDATE home_score = VALUES(home_score), away_score = VALUES(away_score)`,
          [pred.api_fixture_id, pred.league_id, leagueRow[0]?.api_league_id || null,
            process.env.API_FOOTBALL_SEASON || new Date().getFullYear(),
            pred.home_team, pred.away_team, pred.match_date, homeScore, awayScore]
        );
        graded++;
      }
    } catch (err) {
      console.error(`[apiFootball] syncResults batch starting at ${i} failed:`, err.message);
      // A 429 means the whole day's budget is gone -- no point burning
      // further batches on it, they'll all fail the same way.
      if (err.response?.status === 429) break;
    }
  }
  return { skipped: false, graded, apiCalls };
}

function evaluateTipOutcome(tip, market, homeScore, awayScore) {
  const total = homeScore + awayScore;
  const t = (tip || '').toLowerCase();
  if (market === 'BTTS') {
    const btts = homeScore > 0 && awayScore > 0;
    return /no/.test(t) ? !btts : btts;
  }
  if (market === 'Over/Under') {
    const line = Number((t.match(/(\d+(\.\d+)?)/) || [])[1] || 2.5);
    return /under/.test(t) ? total < line : total > line;
  }
  // 1X2 / Draw No Bet
  if (/home/.test(t)) return homeScore > awayScore;
  if (/away/.test(t)) return awayScore > homeScore;
  if (/draw/.test(t)) return homeScore === awayScore;
  return false;
}

async function syncLiveScores() {
  if (!isConfigured()) return { skipped: true, reason: 'API_FOOTBALL_KEY not configured' };
  if (!(await reserveCall())) return { skipped: true, reason: `Daily API-Football cap (${DAILY_CAP} calls) reached` };
  try {
    const { data } = await client().get('/fixtures', { params: { live: 'all' } });
    let updated = 0;
    for (const fx of data.response || []) {
      const [rows] = await pool.query('UPDATE predictions SET home_score = ?, away_score = ? WHERE api_fixture_id = ? AND result = "pending"', [
        fx.goals.home, fx.goals.away, fx.fixture.id,
      ]);
      if (rows.affectedRows) updated++;
    }
    return { skipped: false, updated };
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

/**
 * H2H, sourced first from historical_fixtures (DB); falls back to a live
 * API-Football H2H call only when fewer than 3 matching rows exist locally.
 */
async function getH2hSummary(homeTeam, awayTeam) {
  const [rows] = await pool.query(
    `SELECT home_team, away_team, home_score, away_score, match_date FROM historical_fixtures
     WHERE (home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?)
     ORDER BY match_date DESC LIMIT 10`,
    [homeTeam, awayTeam, awayTeam, homeTeam]
  );

  let matches = rows;
  if (matches.length < 3 && isConfigured()) {
    try {
      // live fallback omitted from free-tier default calls; DB-first is the primary path
    } catch (err) {
      // ignore — degrade to whatever local data exists
    }
  }

  if (!matches.length) return null;

  const recent = matches.slice(0, 5);
  const older = matches.slice(5, 10);
  const tally = (list) => {
    let h = 0, a = 0, d = 0;
    for (const m of list) {
      const homeWasHome = m.home_team === homeTeam;
      const hs = homeWasHome ? m.home_score : m.away_score;
      const as = homeWasHome ? m.away_score : m.home_score;
      if (hs > as) h++; else if (as > hs) a++; else d++;
    }
    return { h, a, d };
  };
  const r = tally(recent);
  const o = tally(older);
  return `RH${r.h}-RA${r.a}-RD${r.d}|OH${o.h}-OA${o.a}-OD${o.d}`;
}

async function getTeamFormStrings(teamName) {
  const [homeRows] = await pool.query(
    `SELECT home_score, away_score FROM historical_fixtures WHERE home_team = ? ORDER BY match_date DESC LIMIT 5`,
    [teamName]
  );
  const [allRows] = await pool.query(
    `SELECT home_team, home_score, away_score FROM historical_fixtures
     WHERE home_team = ? OR away_team = ? ORDER BY match_date DESC LIMIT 5`,
    [teamName, teamName]
  );
  const toForm = (rows, venueOnly) => rows.map((r) => {
    const isHome = venueOnly ? true : r.home_team === teamName;
    const gf = isHome ? r.home_score : r.away_score;
    const ga = isHome ? r.away_score : r.home_score;
    if (gf > ga) return 'W';
    if (gf < ga) return 'L';
    return 'D';
  }).join('');
  return { overall: toForm(allRows, false), venue: toForm(homeRows, true) };
}

async function getTeamGoalAverages(teamName) {
  const [rows] = await pool.query(
    `SELECT AVG(CASE WHEN home_team = ? THEN home_score ELSE away_score END) AS scored_avg,
            AVG(CASE WHEN home_team = ? THEN away_score ELSE home_score END) AS conceded_avg
     FROM historical_fixtures WHERE home_team = ? OR away_team = ?`,
    [teamName, teamName, teamName, teamName]
  );
  return {
    scoredAvg: Number(rows[0].scored_avg) || 1.2,
    concededAvg: Number(rows[0].conceded_avg) || 1.2,
  };
}

/**
 * One-time / on-demand backfill: paginates API-Football fixtures for the last
 * `seasonsBack` seasons of a league and upserts finished matches into
 * historical_fixtures. Budget-aware — reports remaining calls before running.
 */
async function syncHistoricalFixtures(apiLeagueId, seasonsBack = 3) {
  if (!isConfigured()) return { skipped: true, reason: 'API_FOOTBALL_KEY not configured' };
  const budget = await getRemainingCount();
  if (budget.remaining !== null && budget.remaining < seasonsBack) {
    return { skipped: true, reason: `insufficient API budget (${budget.remaining} calls remaining)` };
  }

  const currentSeason = Number(process.env.API_FOOTBALL_SEASON) || new Date().getFullYear();
  const [leagueRow] = await pool.query('SELECT id FROM leagues WHERE api_league_id = ?', [apiLeagueId]);
  const leagueId = leagueRow[0]?.id || null;
  let inserted = 0;

  for (let s = 0; s < seasonsBack; s++) {
    const season = currentSeason - s;
    if (!(await reserveCall())) {
      console.warn(`[apiFootball] syncHistoricalFixtures stopping early -- daily cap (${DAILY_CAP} calls) reached`);
      break;
    }
    try {
      const { data } = await client().get('/fixtures', { params: { league: apiLeagueId, season } });
      for (const fx of data.response || []) {
        if (fx.fixture.status.short !== 'FT') continue;
        const [result] = await pool.query(
          `INSERT INTO historical_fixtures
           (api_fixture_id, league_id, api_league_id, season, home_team, away_team,
            api_home_team_id, api_away_team_id, match_date, home_score, away_score,
            home_score_ht, away_score_ht, venue, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FT')
           ON DUPLICATE KEY UPDATE home_score = VALUES(home_score), away_score = VALUES(away_score)`,
          [fx.fixture.id, leagueId, apiLeagueId, season, fx.teams.home.name, fx.teams.away.name,
            fx.teams.home.id, fx.teams.away.id,
            new Date(fx.fixture.date).toISOString().slice(0, 19).replace('T', ' '),
            fx.goals.home, fx.goals.away, fx.score.halftime.home, fx.score.halftime.away,
            fx.fixture.venue?.name || null]
        );
        if (result.affectedRows) inserted++;
      }
    } catch (err) {
      console.error(`[apiFootball] syncHistoricalFixtures league=${apiLeagueId} season=${season} failed:`, err.message);
    }
  }
  return { skipped: false, inserted, seasons: seasonsBack };
}

/**
 * Pulls the current standings table for one league from API-Football and
 * upserts it into league_standings. On-demand (called when an admin picks a
 * league on the Intelligence page and clicks Load Data), not scheduled --
 * standings only change a few times a week, so there's no need to poll it.
 */
async function syncStandingsForLeague(leagueId) {
  if (!isConfigured()) return { skipped: true, reason: 'API_FOOTBALL_KEY not configured' };
  const [leagueRows] = await pool.query('SELECT id, api_league_id FROM leagues WHERE id = ?', [leagueId]);
  const league = leagueRows[0];
  if (!league || !league.api_league_id) return { skipped: true, reason: 'League not found or missing api_league_id' };
  if (!(await reserveCall())) return { skipped: true, reason: `Daily API-Football cap (${DAILY_CAP} calls) reached` };

  const season = Number(process.env.API_FOOTBALL_SEASON) || new Date().getFullYear();
  try {
    const { data } = await client().get('/standings', { params: { league: league.api_league_id, season } });
    const table = data.response?.[0]?.league?.standings?.[0] || [];
    for (const row of table) {
      await pool.query(
        `INSERT INTO league_standings
           (league_id, season, api_team_id, team_name, team_logo, \`rank\`, played, won, drawn, lost, goals_for, goals_against, goal_diff, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           api_team_id = VALUES(api_team_id), team_logo = VALUES(team_logo), \`rank\` = VALUES(\`rank\`),
           played = VALUES(played), won = VALUES(won), drawn = VALUES(drawn), lost = VALUES(lost),
           goals_for = VALUES(goals_for), goals_against = VALUES(goals_against),
           goal_diff = VALUES(goal_diff), points = VALUES(points)`,
        [league.id, season, row.team.id, row.team.name, row.team.logo, row.rank,
          row.all.played, row.all.win, row.all.draw, row.all.lose,
          row.all.goals.for, row.all.goals.against, row.goalsDiff, row.points]
      );
    }
    return { skipped: false, teams: table.length, season };
  } catch (err) {
    return { skipped: true, reason: err.response?.data?.message || err.message };
  }
}

module.exports = {
  isConfigured,
  getRemainingCount,
  syncFixturesForDate,
  syncTodayAndTomorrow,
  syncResults,
  syncLiveScores,
  evaluateTipOutcome,
  getH2hSummary,
  getTeamFormStrings,
  getTeamGoalAverages,
  syncHistoricalFixtures,
  syncStandingsForLeague,
  DAILY_CAP,
  getCallsToday,
  resetCallsToday,
};
