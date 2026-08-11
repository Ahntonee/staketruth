const { pool } = require('../config/db');
const { getWeight } = require('./weights');
const { clamp } = require('../utils/helpers');

const RECENCY_WEIGHTS = [1.5, 1.2, 1.0, 0.8, 0.5];
const TOP5_LEAGUE_IDS = new Set([39, 140, 135, 78, 61]); // EPL, La Liga, Serie A, Bundesliga, Ligue 1
const CONTINENTAL_LEAGUE_IDS = new Set([2, 3]); // UCL, UEL

const MARKET_COEFFICIENTS = {
  '1X2': 1.0,
  'Over/Under': 0.95,
  'BTTS': 0.90,
  'Draw No Bet': 0.88,
  'Correct Score': 0.55,
  'Accumulator': 0.40,
};

// ---- Factor 1: Form ----------------------------------------------------

function formWinRateSignal(formString) {
  if (!formString) return 0.5;
  const chars = formString.toUpperCase().split('').slice(0, 5);
  let weighted = 0;
  let totalWeight = 0;
  chars.forEach((c, i) => {
    const w = RECENCY_WEIGHTS[i] ?? 0.5;
    const val = c === 'W' ? 1 : c === 'D' ? 0.5 : 0;
    weighted += val * w;
    totalWeight += w;
  });
  return totalWeight ? weighted / totalWeight : 0.5;
}

function computeFormFactor(p) {
  const { market, tip, home_form, away_form, home_form_venue, away_form_venue,
    home_goals_avg, away_goals_avg, home_goals_conceded_avg, away_goals_conceded_avg } = p;

  const homeOverall = formWinRateSignal(home_form);
  const awayOverall = formWinRateSignal(away_form);

  if (market === '1X2' || market === 'Draw No Bet') {
    const homeVenue = formWinRateSignal(home_form_venue || home_form);
    const awayVenue = formWinRateSignal(away_form_venue || away_form);
    const homeScore = homeVenue * 0.65 + homeOverall * 0.35;
    const awayScore = awayVenue * 0.65 + awayOverall * 0.35;
    if (/home/i.test(tip)) return clamp(0.5 + (homeScore - awayScore), 0, 1);
    if (/away/i.test(tip)) return clamp(0.5 + (awayScore - homeScore), 0, 1);
    return clamp(1 - Math.abs(homeScore - awayScore) * 1.5, 0, 1); // draw: closer forms → more likely
  }

  const hGoals = Number(home_goals_avg) || 1.2;
  const aGoals = Number(away_goals_avg) || 1.1;

  if (market === 'BTTS') {
    const hConceded = Number(home_goals_conceded_avg) || 1.2;
    const aConceded = Number(away_goals_conceded_avg) || 1.2;
    const expHome = (hGoals + aConceded) / 2;
    const expAway = (aGoals + hConceded) / 2;
    const pHomeScores = 1 - Math.exp(-expHome);
    const pAwayScores = 1 - Math.exp(-expAway);
    const bttsProb = clamp(pHomeScores * pAwayScores, 0, 1);
    const formAvg = (homeOverall + awayOverall) / 2;
    const poissonSignal = /no/i.test(tip) ? 1 - bttsProb : bttsProb;
    return clamp(poissonSignal * 0.65 + formAvg * 0.35, 0, 1);
  }

  // Over/Under N
  const match = tip.match(/(\d+(\.\d+)?)/);
  const line = match ? Number(match[1]) : 2.5;
  const expectedTotal = hGoals + aGoals;
  const overSignal = clamp(0.5 + ((expectedTotal - line) / Math.max(line, 1.5)) * 0.45, 0, 1);
  const goalsSignal = /under/i.test(tip) ? 1 - overSignal : overSignal;
  const formAvg = (homeOverall + awayOverall) / 2;
  return clamp(goalsSignal * 0.65 + formAvg * 0.35, 0, 1);
}

// ---- Factor 2: H2H -------------------------------------------------------

// Parses "RH3-RA1-RD1|OH2-OA1-OD2" (Recent|Older, recent weighted 2x), or the
// legacy "H5-A2-D3" format. Returns { home, away, draw, sampleSize } win-rate shares.
function parseH2H(h2hSummary) {
  if (!h2hSummary) return { home: 0.34, away: 0.33, draw: 0.33, sampleSize: 0 };

  const newFormat = h2hSummary.match(/RH(\d+)-RA(\d+)-RD(\d+)\|OH(\d+)-OA(\d+)-OD(\d+)/i);
  if (newFormat) {
    const [, rh, ra, rd, oh, oa, od] = newFormat.map(Number);
    const wHome = rh * 2 + oh;
    const wAway = ra * 2 + oa;
    const wDraw = rd * 2 + od;
    const total = wHome + wAway + wDraw;
    const sampleSize = rh + ra + rd + oh + oa + od;
    if (!total) return { home: 0.34, away: 0.33, draw: 0.33, sampleSize };
    return { home: wHome / total, away: wAway / total, draw: wDraw / total, sampleSize };
  }

  const legacy = h2hSummary.match(/H(\d+)-A(\d+)-D(\d+)/i);
  if (legacy) {
    const [, h, a, d] = legacy.map(Number);
    const total = h + a + d;
    if (!total) return { home: 0.34, away: 0.33, draw: 0.33, sampleSize: 0 };
    return { home: h / total, away: a / total, draw: d / total, sampleSize: total };
  }

  return { home: 0.34, away: 0.33, draw: 0.33, sampleSize: 0 };
}

function computeH2hFactor(p) {
  const { market, tip, h2h_summary } = p;
  const h2h = parseH2H(h2h_summary);

  if (market === '1X2' || market === 'Draw No Bet') {
    if (/home/i.test(tip)) return clamp(0.4 + h2h.home * 0.6, 0, 1);
    if (/away/i.test(tip)) return clamp(0.4 + h2h.away * 0.6, 0, 1);
    return clamp(0.4 + h2h.draw * 0.6, 0, 1);
  }

  // For non-1X2 markets the compact H2H format doesn't carry goal data — use the
  // sample size as a confidence-in-precedent modifier rather than fabricating a
  // goals signal we don't have.
  return h2h.sampleSize >= 4 ? 0.65 : 0.5;
}

// ---- Factor 3: Odds -------------------------------------------------------

function computeOddsFactor(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!odds || odds <= 1) return 0.5;
  const implied = 1 / odds;
  if (implied >= 0.5 && implied <= 0.7) return 0.90;
  if (implied > 0.7) {
    const t = clamp((implied - 0.7) / 0.3, 0, 1);
    return 0.90 - t * 0.15; // down to 0.75 at implied=1.0
  }
  if (implied >= 0.3) {
    const t = (implied - 0.3) / 0.2;
    return 0.35 + t * 0.55; // up to 0.90 at implied=0.5
  }
  return 0.35;
}

// ---- Factor 4: Market coefficient -----------------------------------------

function computeMarketFactor(market) {
  return MARKET_COEFFICIENTS[market] ?? 0.7;
}

// ---- Factor 5: League reliability ------------------------------------------

function computeLeagueFactor(apiLeagueId) {
  if (CONTINENTAL_LEAGUE_IDS.has(Number(apiLeagueId))) return 1.0;
  if (TOP5_LEAGUE_IDS.has(Number(apiLeagueId))) return 0.97;
  return 0.70;
}

// ---- Learning adjustment (Bayesian, from intelligence_outcomes) -----------

async function getMarketHistoricalWinRate(market, category) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes WHERE market = ? AND category = ?`,
    [market, category]
  );
  const total = Number(rows[0].total) || 0;
  const correct = Number(rows[0].correct) || 0;
  if (total < 5) return null; // not enough sample size to trust
  return correct / total;
}

async function getTeamPatternWinRate(teamName, market) {
  if (!teamName) return null;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes WHERE market = ? AND (home_team = ? OR away_team = ?)`,
    [market, teamName, teamName]
  );
  const total = Number(rows[0].total) || 0;
  const correct = Number(rows[0].correct) || 0;
  if (total < 5) return null;
  return correct / total;
}

// ---- Public entry point -----------------------------------------------------

/**
 * Computes the full 1-99 confidence/intelligence score for a candidate tip.
 * @param {object} p - { market, tip, category, home_team, away_team, api_league_id,
 *   home_goals_avg, away_goals_avg, home_goals_conceded_avg, away_goals_conceded_avg,
 *   home_form, away_form, home_form_venue, away_form_venue, h2h_summary, odds }
 */
async function computeConfidenceScore(p) {
  const [wForm, wH2h, wOdds, wMarket, wLeague, learningRate, teamPatternWeight] = await Promise.all([
    getWeight('form_weight', 0.30),
    getWeight('h2h_weight', 0.20),
    getWeight('odds_weight', 0.20),
    getWeight('market_weight', 0.15),
    getWeight('league_weight', 0.15),
    getWeight('learning_rate', 0.10),
    getWeight('team_pattern_weight', 0.10),
  ]);

  const formFactor = computeFormFactor(p);
  const h2hFactor = computeH2hFactor(p);
  const oddsFactor = computeOddsFactor(p.odds);
  const marketFactor = computeMarketFactor(p.market);
  const leagueFactor = computeLeagueFactor(p.api_league_id);

  let rawScore =
    formFactor * wForm * 100 +
    h2hFactor * wH2h * 100 +
    oddsFactor * wOdds * 100 +
    marketFactor * wMarket * 100 +
    leagueFactor * wLeague * 100;

  const marketWinRate = await getMarketHistoricalWinRate(p.market, p.category);
  if (marketWinRate !== null) {
    rawScore = rawScore * (1 - learningRate) + marketWinRate * 100 * learningRate;
  }

  const homePattern = await getTeamPatternWinRate(p.home_team, p.market);
  const awayPattern = await getTeamPatternWinRate(p.away_team, p.market);
  const relevantPattern = /home/i.test(p.tip || '') ? homePattern : /away/i.test(p.tip || '') ? awayPattern : null;
  if (relevantPattern !== null) {
    rawScore = rawScore * (1 - teamPatternWeight) + relevantPattern * 100 * teamPatternWeight;
  }

  const regressed = rawScore * 0.90 + 50 * 0.10;
  return Math.round(clamp(regressed, 1, 99));
}

module.exports = {
  computeConfidenceScore,
  parseH2H,
  formWinRateSignal,
  computeFormFactor,
  computeH2hFactor,
  computeOddsFactor,
  computeMarketFactor,
  computeLeagueFactor,
  getMarketHistoricalWinRate,
  getTeamPatternWinRate,
};
