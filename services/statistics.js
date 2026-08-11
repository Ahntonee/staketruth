const { pool } = require('../config/db');

// ---- Nightly refresh of pre-computed tables (public statistics reads these,
// never computes on demand, per Critical Note #8) --------------------------

async function refreshTeamStatistics() {
  const [rows] = await pool.query(
    `SELECT home_team AS team_name, api_home_team_id AS api_team_id, league_id, api_league_id, season,
            COUNT(*) AS matches_played,
            SUM(home_score) AS goals_scored, SUM(away_score) AS goals_conceded,
            SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) AS draws,
            SUM(CASE WHEN home_score < away_score THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN away_score = 0 THEN 1 ELSE 0 END) AS clean_sheets,
            SUM(CASE WHEN home_score > 0 AND away_score > 0 THEN 1 ELSE 0 END) AS btts_count,
            SUM(CASE WHEN home_score + away_score > 1.5 THEN 1 ELSE 0 END) AS over_1_5_count,
            SUM(CASE WHEN home_score + away_score > 2.5 THEN 1 ELSE 0 END) AS over_2_5_count,
            SUM(CASE WHEN home_score + away_score > 3.5 THEN 1 ELSE 0 END) AS over_3_5_count
     FROM historical_fixtures WHERE status = 'FT'
     GROUP BY home_team, api_home_team_id, league_id, api_league_id, season`
  );
  for (const r of rows) {
    const scoredAvg = r.matches_played ? r.goals_scored / r.matches_played : 0;
    const concededAvg = r.matches_played ? r.goals_conceded / r.matches_played : 0;
    await pool.query(
      `INSERT INTO team_statistics
       (team_name, api_team_id, league_id, api_league_id, season, matches_played, goals_scored, goals_conceded,
        goals_scored_avg, goals_conceded_avg, wins, draws, losses, clean_sheets, btts_count,
        over_1_5_count, over_2_5_count, over_3_5_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE matches_played=VALUES(matches_played), goals_scored=VALUES(goals_scored),
         goals_conceded=VALUES(goals_conceded), goals_scored_avg=VALUES(goals_scored_avg),
         goals_conceded_avg=VALUES(goals_conceded_avg), wins=VALUES(wins), draws=VALUES(draws),
         losses=VALUES(losses), clean_sheets=VALUES(clean_sheets), btts_count=VALUES(btts_count),
         over_1_5_count=VALUES(over_1_5_count), over_2_5_count=VALUES(over_2_5_count),
         over_3_5_count=VALUES(over_3_5_count)`,
      [r.team_name, r.api_team_id, r.league_id, r.api_league_id, r.season, r.matches_played,
        r.goals_scored, r.goals_conceded, scoredAvg, concededAvg, r.wins, r.draws, r.losses,
        r.clean_sheets, r.btts_count, r.over_1_5_count, r.over_2_5_count, r.over_3_5_count]
    );
  }
  return { teamsUpdated: rows.length };
}

async function refreshLeagueStatistics() {
  const [rows] = await pool.query(
    `SELECT league_id, api_league_id, season, COUNT(*) AS matches_played,
            SUM(home_score + away_score) AS total_goals,
            SUM(CASE WHEN home_score > 0 AND away_score > 0 THEN 1 ELSE 0 END) AS btts_count,
            SUM(CASE WHEN home_score + away_score > 1.5 THEN 1 ELSE 0 END) AS over15,
            SUM(CASE WHEN home_score + away_score > 2.5 THEN 1 ELSE 0 END) AS over25,
            SUM(CASE WHEN home_score + away_score > 3.5 THEN 1 ELSE 0 END) AS over35,
            SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END) AS home_wins,
            SUM(CASE WHEN home_score < away_score THEN 1 ELSE 0 END) AS away_wins,
            SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) AS draws
     FROM historical_fixtures WHERE status = 'FT' AND api_league_id IS NOT NULL
     GROUP BY league_id, api_league_id, season`
  );
  for (const r of rows) {
    const [leagueRow] = await pool.query('SELECT name FROM leagues WHERE api_league_id = ?', [r.api_league_id]);
    const gpg = r.matches_played ? r.total_goals / r.matches_played : 0;
    const pct = (n) => (r.matches_played ? (n / r.matches_played) * 100 : 0);
    await pool.query(
      `INSERT INTO league_statistics
       (league_id, api_league_id, league_name, season, matches_played, total_goals, goals_per_game,
        btts_percentage, over_1_5_percentage, over_2_5_percentage, over_3_5_percentage,
        home_win_percentage, away_win_percentage, draw_percentage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE matches_played=VALUES(matches_played), total_goals=VALUES(total_goals),
         goals_per_game=VALUES(goals_per_game), btts_percentage=VALUES(btts_percentage),
         over_1_5_percentage=VALUES(over_1_5_percentage), over_2_5_percentage=VALUES(over_2_5_percentage),
         over_3_5_percentage=VALUES(over_3_5_percentage), home_win_percentage=VALUES(home_win_percentage),
         away_win_percentage=VALUES(away_win_percentage), draw_percentage=VALUES(draw_percentage)`,
      [r.league_id, r.api_league_id, leagueRow[0]?.name || null, r.season, r.matches_played, r.total_goals,
        gpg, pct(r.btts_count), pct(r.over15), pct(r.over25), pct(r.over35), pct(r.home_wins), pct(r.away_wins), pct(r.draws)]
    );
  }
  return { leaguesUpdated: rows.length };
}

async function refreshMarketStats() {
  const [rows] = await pool.query(
    `SELECT market, category, league_id, COUNT(*) AS total, SUM(is_correct) AS correct, AVG(confidence_score) AS avg_conf
     FROM prediction_accuracy_log GROUP BY market, category, league_id`
  );
  for (const r of rows) {
    const winRate = r.total ? (Number(r.correct) / r.total) * 100 : 0;
    await pool.query(
      `INSERT INTO prediction_market_stats (market, category, league_id, total_predictions, correct_predictions, win_rate, avg_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.market, r.category, r.league_id, r.total, r.correct || 0, winRate, r.avg_conf || 0]
    );
  }
  return { rowsInserted: rows.length };
}

/**
 * Admin-only. Flat 1-unit staking model: win returns odds-1 units, loss costs 1
 * unit, void costs 0. Never exposed via any public endpoint.
 */
async function computeProfitability() {
  const [teamRows] = await pool.query(
    `SELECT p.home_team AS entity_name, p.league_id, p.market, p.category,
            COUNT(*) AS total_tips, SUM(p.result='won') AS wins, SUM(p.result='lost') AS losses,
            SUM(CASE WHEN p.result='won' THEN COALESCE(p.odds,2)-1 WHEN p.result='lost' THEN -1 ELSE 0 END) AS profit_units,
            SUM(CASE WHEN p.result IN ('won','lost') THEN 1 ELSE 0 END) AS units_staked
     FROM predictions p WHERE p.result IN ('won','lost')
     GROUP BY p.home_team, p.league_id, p.market, p.category`
  );
  for (const r of teamRows) {
    const roi = r.units_staked ? (r.profit_units / r.units_staked) * 100 : 0;
    await pool.query(
      `INSERT INTO profitability_stats
       (entity_type, entity_name, league_id, market, category, total_tips, wins, losses, units_staked, units_returned, profit_units, roi_percent)
       VALUES ('team', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE total_tips=VALUES(total_tips), wins=VALUES(wins), losses=VALUES(losses),
         units_staked=VALUES(units_staked), profit_units=VALUES(profit_units), roi_percent=VALUES(roi_percent)`,
      [r.entity_name, r.league_id, r.market, r.category, r.total_tips, r.wins, r.losses,
        r.units_staked, r.units_staked + r.profit_units, r.profit_units, roi]
    );
  }

  const [leagueRows] = await pool.query(
    `SELECT l.name AS entity_name, p.league_id, p.market, p.category,
            COUNT(*) AS total_tips, SUM(p.result='won') AS wins, SUM(p.result='lost') AS losses,
            SUM(CASE WHEN p.result='won' THEN COALESCE(p.odds,2)-1 WHEN p.result='lost' THEN -1 ELSE 0 END) AS profit_units,
            SUM(CASE WHEN p.result IN ('won','lost') THEN 1 ELSE 0 END) AS units_staked
     FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.result IN ('won','lost') AND l.name IS NOT NULL
     GROUP BY l.name, p.league_id, p.market, p.category`
  );
  for (const r of leagueRows) {
    const roi = r.units_staked ? (r.profit_units / r.units_staked) * 100 : 0;
    await pool.query(
      `INSERT INTO profitability_stats
       (entity_type, entity_name, league_id, market, category, total_tips, wins, losses, units_staked, units_returned, profit_units, roi_percent)
       VALUES ('league', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE total_tips=VALUES(total_tips), wins=VALUES(wins), losses=VALUES(losses),
         units_staked=VALUES(units_staked), profit_units=VALUES(profit_units), roi_percent=VALUES(roi_percent)`,
      [r.entity_name, r.league_id, r.market, r.category, r.total_tips, r.wins, r.losses,
        r.units_staked, r.units_staked + r.profit_units, r.profit_units, roi]
    );
  }

  return { teams: teamRows.length, leagues: leagueRows.length };
}

async function getHighestScoringTeams(limit = 20) {
  const [rows] = await pool.query(
    `SELECT team_name, league_id, goals_scored_avg FROM team_statistics ORDER BY goals_scored_avg DESC LIMIT ?`,
    [limit]
  );
  return rows;
}
async function getLowestScoringTeams(limit = 20) {
  const [rows] = await pool.query(
    `SELECT team_name, league_id, goals_scored_avg FROM team_statistics WHERE matches_played >= 3 ORDER BY goals_scored_avg ASC LIMIT ?`,
    [limit]
  );
  return rows;
}
async function getHighestScoringLeagues(limit = 20) {
  const [rows] = await pool.query(`SELECT league_name, goals_per_game FROM league_statistics ORDER BY goals_per_game DESC LIMIT ?`, [limit]);
  return rows;
}
async function getLowestScoringLeagues(limit = 20) {
  const [rows] = await pool.query(`SELECT league_name, goals_per_game FROM league_statistics WHERE matches_played >= 3 ORDER BY goals_per_game ASC LIMIT ?`, [limit]);
  return rows;
}
async function getMostReliableMarkets() {
  const [rows] = await pool.query(
    `SELECT market, category, SUM(total_predictions) AS total, SUM(correct_predictions) AS correct
     FROM prediction_market_stats GROUP BY market, category HAVING total >= 1
     ORDER BY (SUM(correct_predictions)/SUM(total_predictions)) DESC`
  );
  return rows.map((r) => ({ ...r, win_rate: r.total ? ((r.correct / r.total) * 100).toFixed(1) : '0.0' }));
}
async function getMostReliableTeamsByMarket(market, limit = 20) {
  const [rows] = await pool.query(
    `SELECT home_team AS team, COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes WHERE market = ? GROUP BY home_team HAVING total >= 3
     ORDER BY (SUM(is_correct)/COUNT(*)) DESC LIMIT ?`,
    [market, limit]
  );
  return rows;
}
async function getMostReliableLeaguesByMarket(market, limit = 20) {
  const [rows] = await pool.query(
    `SELECT l.name AS league, COUNT(*) AS total, SUM(io.is_correct) AS correct
     FROM intelligence_outcomes io LEFT JOIN leagues l ON l.id = io.league_id
     WHERE io.market = ? GROUP BY io.league_id HAVING total >= 3
     ORDER BY (SUM(io.is_correct)/COUNT(*)) DESC LIMIT ?`,
    [market, limit]
  );
  return rows;
}
async function getMostEffectivePredictionsByTeam(teamName) {
  const [rows] = await pool.query(
    `SELECT market, category, COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes WHERE home_team = ? OR away_team = ?
     GROUP BY market, category ORDER BY (SUM(is_correct)/COUNT(*)) DESC`,
    [teamName, teamName]
  );
  return rows;
}
async function getMostEffectivePredictionsByLeague(leagueId) {
  const [rows] = await pool.query(
    `SELECT market, category, COUNT(*) AS total, SUM(is_correct) AS correct
     FROM intelligence_outcomes WHERE league_id = ?
     GROUP BY market, category ORDER BY (SUM(is_correct)/COUNT(*)) DESC`,
    [leagueId]
  );
  return rows;
}
async function getCrossMarketLeagueStats() {
  const [rows] = await pool.query(
    `SELECT l.name AS league, io.market, COUNT(*) AS total, SUM(io.is_correct) AS correct
     FROM intelligence_outcomes io LEFT JOIN leagues l ON l.id = io.league_id
     GROUP BY io.league_id, io.market HAVING total >= 3
     ORDER BY (SUM(io.is_correct)/COUNT(*)) DESC`
  );
  return rows;
}

async function getPublicSummary() {
  const [[accuracy]] = await pool.query(`SELECT stat_value FROM accuracy_stats WHERE stat_key = 'win_rate'`);
  const [[total]] = await pool.query(`SELECT stat_value FROM accuracy_stats WHERE stat_key = 'total_predictions'`);
  const [[bestMarket]] = await pool.query(
    `SELECT market, category, SUM(total_predictions) t, SUM(correct_predictions) c FROM prediction_market_stats
     GROUP BY market, category HAVING t >= 1 ORDER BY (c/t) DESC LIMIT 1`
  );
  const [[bestLeague]] = await pool.query(
    `SELECT league_name FROM league_statistics ORDER BY goals_per_game DESC LIMIT 1`
  );
  return {
    winRate: accuracy?.stat_value || '0.0',
    totalPredictions: total?.stat_value || 0,
    bestMarket: bestMarket ? `${bestMarket.market} (${bestMarket.category})` : null,
    bestLeague: bestLeague?.league_name || null,
  };
}

module.exports = {
  refreshTeamStatistics,
  refreshLeagueStatistics,
  refreshMarketStats,
  computeProfitability,
  getHighestScoringTeams,
  getLowestScoringTeams,
  getHighestScoringLeagues,
  getLowestScoringLeagues,
  getMostReliableMarkets,
  getMostReliableTeamsByMarket,
  getMostReliableLeaguesByMarket,
  getMostEffectivePredictionsByTeam,
  getMostEffectivePredictionsByLeague,
  getCrossMarketLeagueStats,
  getPublicSummary,
};
