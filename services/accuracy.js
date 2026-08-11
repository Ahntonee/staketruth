const { pool } = require('../config/db');

/**
 * Logs every newly-graded (won/lost) prediction into prediction_accuracy_log and,
 * for intelligence-sourced picks, into intelligence_outcomes so the learning loop
 * (services/confidence.js) has fresh data on the next run.
 */
async function logUntracked() {
  const [graded] = await pool.query(
    `SELECT p.* FROM predictions p
     LEFT JOIN prediction_accuracy_log l ON l.prediction_id = p.id
     WHERE p.result IN ('won','lost') AND l.id IS NULL`
  );

  let logged = 0;
  for (const p of graded) {
    const isCorrect = p.result === 'won' ? 1 : 0;
    await pool.query(
      `INSERT INTO prediction_accuracy_log
       (prediction_id, market, category, league_id, home_team, away_team, tip,
        confidence_score, intelligence_score, is_correct, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, p.market, p.category, p.league_id, p.home_team, p.away_team, p.tip,
        p.confidence_score, p.intelligence_score, isCorrect, p.source]
    );

    if (p.source === 'intelligence') {
      const [leagueRow] = await pool.query('SELECT api_league_id FROM leagues WHERE id = ?', [p.league_id]);
      await pool.query(
        `INSERT INTO intelligence_outcomes
         (prediction_id, market, category, league_id, api_league_id, home_team, away_team, tip,
          confidence_score, home_goals_avg, away_goals_avg, home_goals_conceded_avg, away_goals_conceded_avg,
          actual_home_score, actual_away_score, is_correct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.market, p.category, p.league_id, leagueRow[0]?.api_league_id || null,
          p.home_team, p.away_team, p.tip, p.intelligence_score,
          p.home_goals_avg, p.away_goals_avg, p.home_goals_conceded_avg, p.away_goals_conceded_avg,
          p.home_score, p.away_score, isCorrect]
      );
    }
    logged++;
  }
  return { logged };
}

async function recalculateStats() {
  const [[overall]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM prediction_accuracy_log`
  );
  const winRate = overall.total ? (Number(overall.correct) / overall.total) * 100 : 0;

  const [[vip]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(a.is_correct) AS correct
     FROM prediction_accuracy_log a JOIN predictions p ON p.id = a.prediction_id
     WHERE p.is_vip = 1`
  );
  const vipWinRate = vip.total ? (Number(vip.correct) / vip.total) * 100 : 0;

  const stats = {
    total_predictions: overall.total || 0,
    win_rate: winRate.toFixed(2),
    vip_win_rate: vipWinRate.toFixed(2),
  };

  for (const [key, value] of Object.entries(stats)) {
    await pool.query(
      `INSERT INTO accuracy_stats (stat_key, stat_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value)`,
      [key, value]
    );
  }
  return stats;
}

module.exports = { logUntracked, recalculateStats };
