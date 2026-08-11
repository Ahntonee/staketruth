const { pool } = require('../config/db');

// Server-side clamp, independent of whatever range the admin UI happens to render —
// the UI's slider bounds are cosmetic, this is the actual guardrail. Mirrors
// WEIGHT_RANGES in public/admin/intelligence.html.
const WEIGHT_RANGES = {
  form_weight: [0, 1], h2h_weight: [0, 1], odds_weight: [0, 1],
  market_weight: [0, 1], league_weight: [0, 1],
  learning_rate: [0, 0.5], team_pattern_weight: [0, 0.5],
  home_advantage: [1, 2], poisson_k: [3, 10],
  min_confidence_publish: [0, 99], auto_publish_threshold: [0, 99],
  auto_push_threshold: [0, 99], vip_pick_threshold: [0, 99],
};

function clamp(key, value) {
  const range = WEIGHT_RANGES[key];
  if (!range) return value;
  return Math.min(range[1], Math.max(range[0], value));
}

// Intelligence weights are always read live from the DB (never cached in memory) so
// that admin changes in /admin/intelligence.html take effect on the very next
// engine run without a server restart.
async function getWeight(key, fallback = 0) {
  const [rows] = await pool.query('SELECT weight_value FROM intelligence_weights WHERE weight_key = ?', [key]);
  if (!rows.length) return fallback;
  return Number(rows[0].weight_value);
}

async function getAllWeights() {
  const [rows] = await pool.query('SELECT weight_key, weight_value, description FROM intelligence_weights ORDER BY weight_key');
  const map = {};
  for (const row of rows) map[row.weight_key] = Number(row.weight_value);
  return { list: rows, map };
}

async function updateWeight(key, value) {
  await pool.query(
    `INSERT INTO intelligence_weights (weight_key, weight_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE weight_value = VALUES(weight_value)`,
    [key, value]
  );
}

async function updateWeights(updates) {
  const entries = Object.entries(updates);
  for (const [key, value] of entries) {
    if (Number.isFinite(Number(value))) await updateWeight(key, clamp(key, Number(value)));
  }
}

module.exports = { getWeight, getAllWeights, updateWeight, updateWeights };
