const { pool } = require('../config/db');
const { getWeight } = require('./weights');
const { computeConfidenceScore, getTeamPatternWinRate } = require('./confidence');
const apiFootball = require('./apiFootball');
const { generatePredictionSlug, clamp } = require('../utils/helpers');

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPMF(lambda, k) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/**
 * Builds the full score-probability matrix up to k=maxGoals and derives every
 * market probability from it (Part 7 Step 2-3).
 */
function buildProbabilityModel(lambdaHome, lambdaAway, maxGoals) {
  const matrix = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = poissonPMF(lambdaHome, h) * poissonPMF(lambdaAway, a);
    }
  }

  let pHome = 0, pDraw = 0, pAway = 0;
  const totalGoalsProb = {};
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];
      if (h > a) pHome += p;
      else if (h < a) pAway += p;
      else pDraw += p;
      const total = h + a;
      totalGoalsProb[total] = (totalGoalsProb[total] || 0) + p;
    }
  }

  const pZeroHome = poissonPMF(lambdaHome, 0);
  const pZeroAway = poissonPMF(lambdaAway, 0);
  const pBttsYes = (1 - pZeroHome) * (1 - pZeroAway);

  function pOver(line) {
    let cumulative = 0;
    for (let g = 0; g <= Math.floor(line); g++) cumulative += totalGoalsProb[g] || 0;
    return clamp(1 - cumulative, 0, 1);
  }

  return {
    home: pHome, draw: pDraw, away: pAway,
    bttsYes: pBttsYes, bttsNo: 1 - pBttsYes,
    over15: pOver(1.5), under15: 1 - pOver(1.5),
    over25: pOver(2.5), under25: 1 - pOver(2.5),
    over35: pOver(3.5), under35: 1 - pOver(3.5),
  };
}

/**
 * Evaluates every candidate market and returns the one with the highest
 * probability AND a value edge vs. the bookmaker's implied probability
 * (edge > 5%) when odds are available; otherwise picks by probability alone.
 */
function selectBestMarket(probModel, odds) {
  const candidates = [
    { tip: 'Home Win', market: '1X2', category: 'home_win', prob: probModel.home, odds: odds?.homeOdds },
    { tip: 'Draw', market: '1X2', category: 'draw', prob: probModel.draw, odds: odds?.drawOdds },
    { tip: 'Away Win', market: '1X2', category: 'away_win', prob: probModel.away, odds: odds?.awayOdds },
    { tip: 'Over 1.5 Goals', market: 'Over/Under', category: 'over_1_5', prob: probModel.over15 },
    { tip: 'Over 2.5 Goals', market: 'Over/Under', category: 'over_2_5', prob: probModel.over25, odds: odds?.over25Odds },
    { tip: 'Over 3.5 Goals', market: 'Over/Under', category: 'over_3_5', prob: probModel.over35 },
    { tip: 'Under 1.5 Goals', market: 'Over/Under', category: 'under_1_5', prob: probModel.under15 },
    { tip: 'Under 2.5 Goals', market: 'Over/Under', category: 'under_2_5', prob: probModel.under25, odds: odds?.under25Odds },
    { tip: 'Under 3.5 Goals', market: 'Over/Under', category: 'under_3_5', prob: probModel.under35 },
    { tip: 'BTTS Yes', market: 'BTTS', category: 'gg', prob: probModel.bttsYes },
    { tip: 'BTTS No', market: 'BTTS', category: 'gg', prob: probModel.bttsNo },
  ];

  let scored = candidates.map((c) => {
    let valueEdge = 0;
    if (c.odds && c.odds > 1) {
      const implied = 1 / c.odds;
      valueEdge = c.prob - implied;
    }
    return { ...c, valueEdge };
  });

  scored.sort((a, b) => (b.prob + Math.max(b.valueEdge, 0) * 0.5) - (a.prob + Math.max(a.valueEdge, 0) * 0.5));
  return scored[0];
}

// Turns the compact "RH3-RA1-RD1|OH2-OA1-OD2" tally getH2hSummary produces
// (recent-5 home/away/draw wins, then the previous 5) into a readable
// sentence. Returns null if there's nothing to say yet.
function describeH2h(h2hSummary, homeTeam, awayTeam) {
  if (!h2hSummary) return null;
  const match = /^RH(\d+)-RA(\d+)-RD(\d+)/.exec(h2hSummary);
  if (!match) return null;
  const [, rh, ra, rd] = match.map(Number);
  const total = rh + ra + rd;
  if (!total) return null;
  if (rh === ra) return `${homeTeam} and ${awayTeam} have split their last ${total} meetings evenly (${rh}-${rd}-${ra}).`;
  const leader = rh > ra ? homeTeam : awayTeam;
  const leaderWins = Math.max(rh, ra);
  return `${leader} has the edge head-to-head, winning ${leaderWins} of the last ${total} meetings between these two.`;
}

function buildAnalysisText({ homeTeam, awayTeam, homeForm, awayForm, homeGoalsAvg, awayGoalsAvg,
  homeGoalsConcededAvg, awayGoalsConcededAvg, tip, probability,
  h2hSummary, intelligenceScore, bookmakers, teamPatternNote }) {
  const parts = [];
  parts.push(`${homeTeam} come in ${homeForm ? `on a run of ${homeForm}` : 'with a developing run of form'}, scoring ${homeGoalsAvg?.toFixed ? homeGoalsAvg.toFixed(2) : homeGoalsAvg} and conceding ${homeGoalsConcededAvg?.toFixed ? homeGoalsConcededAvg.toFixed(2) : homeGoalsConcededAvg} goals per game on average.`);
  parts.push(`${awayTeam} are ${awayForm ? `on ${awayForm}` : 'still building a form line'}, averaging ${awayGoalsAvg?.toFixed ? awayGoalsAvg.toFixed(2) : awayGoalsAvg} scored and ${awayGoalsConcededAvg?.toFixed ? awayGoalsConcededAvg.toFixed(2) : awayGoalsConcededAvg} conceded per game.`);
  const h2hText = describeH2h(h2hSummary, homeTeam, awayTeam);
  if (h2hText) parts.push(h2hText);
  parts.push(`Feeding both sides' scoring rates into our Poisson model projects a ${Math.round(probability * 100)}% probability for "${tip}".`);
  if (teamPatternNote) parts.push(teamPatternNote);
  parts.push(`Overall confidence: ${intelligenceScore}/100.`);
  if (bookmakers?.length) parts.push(`Live odds available on ${bookmakers.slice(0, 3).join(', ')}.`);
  return parts.join(' ');
}

/**
 * Runs the full Intelligence Engine pipeline for a single fixture-shaped
 * prediction row already stored in `predictions` (source='auto_sync' placeholder).
 */
async function runForPrediction(prediction) {
  const [homeStats, awayStats, homeForm, awayForm, h2hSummary, leagueRow] = await Promise.all([
    apiFootball.getTeamGoalAverages(prediction.home_team),
    apiFootball.getTeamGoalAverages(prediction.away_team),
    apiFootball.getTeamFormStrings(prediction.home_team),
    apiFootball.getTeamFormStrings(prediction.away_team),
    apiFootball.getH2hSummary(prediction.home_team, prediction.away_team),
    pool.query('SELECT api_league_id FROM leagues WHERE id = ?', [prediction.league_id]).then((r) => r[0][0]),
  ]);

  const homeAdvantage = await getWeight('home_advantage', 1.15);
  const maxGoals = await getWeight('poisson_k', 6);

  const lambdaHome = clamp(homeStats.scoredAvg, 0.3, 4) * clamp(awayStats.concededAvg, 0.3, 4) / 1.2 * homeAdvantage;
  const lambdaAway = clamp(awayStats.scoredAvg, 0.3, 4) * clamp(homeStats.concededAvg, 0.3, 4) / 1.2;

  const probModel = buildProbabilityModel(lambdaHome, lambdaAway, Math.round(maxGoals));
  const best = selectBestMarket(probModel, null);

  const scoreInput = {
    market: best.market,
    tip: best.tip,
    category: best.category,
    home_team: prediction.home_team,
    away_team: prediction.away_team,
    api_league_id: leagueRow?.api_league_id,
    home_goals_avg: homeStats.scoredAvg,
    away_goals_avg: awayStats.scoredAvg,
    home_goals_conceded_avg: homeStats.concededAvg,
    away_goals_conceded_avg: awayStats.concededAvg,
    home_form: homeForm.overall,
    away_form: awayForm.overall,
    home_form_venue: homeForm.venue,
    away_form_venue: awayForm.venue,
    h2h_summary: h2hSummary,
    odds: null,
  };

  const intelligenceScore = await computeConfidenceScore(scoreInput);

  const vipPickThreshold = await getWeight('vip_pick_threshold', 85);
  const autoPublishThreshold = await getWeight('auto_publish_threshold', 78);

  // Every scored fixture is saved regardless of score -- low-confidence ones
  // just land in the admin Review Queue (is_published=0) instead of being
  // auto-published, rather than being silently discarded. Only score >=
  // auto_publish_threshold skips the queue and goes live automatically.
  const isVip = intelligenceScore >= vipPickThreshold;
  const isVipPickOfDay = intelligenceScore >= vipPickThreshold;
  const shouldAutoPublish = intelligenceScore >= autoPublishThreshold;

  const pattern = await getTeamPatternWinRate(/home/i.test(best.tip) ? prediction.home_team : prediction.away_team, best.market);
  const teamPatternNote = pattern !== null
    ? `${/home/i.test(best.tip) ? prediction.home_team : prediction.away_team} have hit this tip type in ${Math.round(pattern * 100)}% of similar picks on our platform.`
    : null;

  const analysis = buildAnalysisText({
    homeTeam: prediction.home_team,
    awayTeam: prediction.away_team,
    homeForm: homeForm.overall,
    awayForm: awayForm.overall,
    homeGoalsAvg: homeStats.scoredAvg,
    awayGoalsAvg: awayStats.scoredAvg,
    homeGoalsConcededAvg: homeStats.concededAvg,
    awayGoalsConcededAvg: awayStats.concededAvg,
    tip: best.tip,
    probability: best.prob,
    h2hSummary,
    intelligenceScore,
    bookmakers: [],
    teamPatternNote,
  });

  // GREATEST() means a rescore can only ever PROMOTE a prediction to published
  // (score improved enough to newly clear the threshold), never demote one
  // that's already live -- runForPrediction is shared by both first-time
  // scoring (is_published starts at 0, so this is a no-op) and periodic
  // rescoring of still-open predictions, and silently un-publishing something
  // a visitor may have already seen would be worse than leaving a stale score.
  await pool.query(
    `UPDATE predictions SET
       tip = ?, market = ?, category = ?, intelligence_score = ?, confidence_score = ?,
       analysis = ?, is_vip = ?, is_vip_pick_of_day = ?, source = 'intelligence',
       is_published = GREATEST(is_published, ?), published_at = IF(is_published = 0 AND ? = 1, NOW(), published_at),
       home_form = ?, away_form = ?, home_form_venue = ?, away_form_venue = ?, h2h_summary = ?,
       home_goals_avg = ?, away_goals_avg = ?, home_goals_conceded_avg = ?, away_goals_conceded_avg = ?
     WHERE id = ?`,
    [best.tip, best.market, isVip ? 'vip' : best.category, intelligenceScore, intelligenceScore,
      analysis, isVip ? 1 : 0, isVipPickOfDay ? 1 : 0,
      shouldAutoPublish ? 1 : 0, shouldAutoPublish ? 1 : 0,
      homeForm.overall, awayForm.overall, homeForm.venue, awayForm.venue, h2hSummary,
      homeStats.scoredAvg, awayStats.scoredAvg, homeStats.concededAvg, awayStats.concededAvg,
      prediction.id]
  );

  return { generated: true, intelligenceScore, autoPublished: shouldAutoPublish, isVipPickOfDay };
}

async function runForAllToday(daysAhead = 2) {
  // Scoring is pure local computation (team stats/form/H2H all come from
  // historical_fixtures in our own DB, no live API calls per fixture -- see
  // getTeamGoalAverages/getTeamFormStrings/getH2hSummary), so this cap only
  // needs to comfortably exceed the window's fixture volume, not respect an
  // external rate limit. 800 covers a normal 2-day window; callers scoring a
  // wider bulk-synced range (e.g. 60 days) should raise it accordingly.
  const limit = Math.max(800, daysAhead * 400);
  const [pendingRows] = await pool.query(
    `SELECT id, home_team, away_team, league_id, match_date FROM predictions
     WHERE source = 'auto_sync' AND intelligence_score IS NULL
       AND match_date >= NOW() AND match_date <= DATE_ADD(NOW(), INTERVAL ? DAY)
     LIMIT ?`,
    [daysAhead, limit]
  );

  let generated = 0, autoPublished = 0, vipPicks = 0;
  for (const row of pendingRows) {
    try {
      const result = await runForPrediction(row);
      if (result.generated) {
        generated++;
        if (result.autoPublished) autoPublished++;
        if (result.isVipPickOfDay) vipPicks++;
      }
    } catch (err) {
      console.error(`[intelligence] runForPrediction id=${row.id} failed:`, err.message);
    }
  }

  // Cap VIP Picks of the Day at 5 for today — keep only the top 5 by score, demote the rest
  await pool.query(
    `UPDATE predictions p
     JOIN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY intelligence_score DESC) AS rn
         FROM predictions WHERE is_vip_pick_of_day = 1 AND DATE(match_date) = CURDATE()
       ) ranked WHERE rn > 5
     ) overflow ON p.id = overflow.id
     SET p.is_vip_pick_of_day = 0`
  );

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_intelligence_run', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );

  return { scanned: pendingRows.length, generated, autoPublished, vipPicks };
}

/**
 * 00:00 job: pushes today's top-scoring un-pushed, non-banker predictions to
 * registered users (up to 3), and finalises the VIP Picks of the Day rail.
 */
async function runDailyPush() {
  const autoPushThreshold = await getWeight('auto_push_threshold', 80);
  const [candidates] = await pool.query(
    `SELECT id FROM predictions
     WHERE DATE(match_date) = CURDATE() AND is_banker = 0 AND pushed_to_registered = 0
       AND intelligence_score >= ? AND is_published = 1
     ORDER BY intelligence_score DESC LIMIT 3`,
    [autoPushThreshold]
  );
  for (const c of candidates) {
    await pool.query('UPDATE predictions SET pushed_to_registered = 1, pushed_at = NOW() WHERE id = ?', [c.id]);
  }
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_auto_push', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  return { pushed: candidates.length };
}

async function getPatternInsights() {
  const [byMarket] = await pool.query(
    `SELECT market, category, COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes GROUP BY market, category HAVING total >= 3
     ORDER BY (SUM(is_correct)/COUNT(*)) DESC LIMIT 5`
  );
  const [byLeague] = await pool.query(
    `SELECT l.name AS league_name, COUNT(*) AS total, SUM(io.is_correct) AS correct
     FROM intelligence_outcomes io LEFT JOIN leagues l ON l.id = io.league_id
     GROUP BY io.league_id HAVING total >= 3
     ORDER BY (SUM(io.is_correct)/COUNT(*)) DESC LIMIT 5`
  );
  const [byTeam] = await pool.query(
    `SELECT home_team AS team, market, COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes GROUP BY home_team, market HAVING total >= 5
     ORDER BY (SUM(is_correct)/COUNT(*)) DESC LIMIT 5`
  );
  return { byMarket, byLeague, byTeam };
}

async function getLearningPerformance(days = 30) {
  const [rows] = await pool.query(
    `SELECT DATE(recorded_at) AS day, market, COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes WHERE recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY DATE(recorded_at), market ORDER BY day ASC`,
    [days]
  );
  return rows;
}

module.exports = {
  buildProbabilityModel,
  selectBestMarket,
  runForPrediction,
  runForAllToday,
  runDailyPush,
  getPatternInsights,
  getLearningPerformance,
  poissonPMF,
};
