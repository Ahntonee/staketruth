const { pool } = require('../config/db');
const football = require('./apiFootball');

const LEAGUES = { 39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1' };
const TYPES = { standings: '/standings', scorers: '/players/topscorers', assists: '/players/topassists' };
const pending = new Map();
const memory = new Map();
const TTL = 6 * 60 * 60 * 1000;

function seasonNow() {
  const date = new Date();
  return Number(process.env.API_FOOTBALL_SEASON) || date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
}

function normalize(response, league, type) {
  if (type === 'standings') return (response[0]?.league?.standings?.[0] || []).map(r => ({
    rank: r.rank, name: r.team.name, played: r.all.played, goalDifference: r.goalsDiff, points: r.points,
  }));
  return response.map(r => {
    const stat = r.statistics?.find(s => s.league?.id === Number(league));
    return stat ? { name: r.player.name, team: stat.team.name, value: type === 'scorers' ? stat.goals.total : stat.goals.assists } : null;
  }).filter(r => r && r.value != null).sort((a, b) => b.value - a.value).slice(0, 20).map((r, i) => ({ ...r, rank: i + 1 }));
}

async function load(league, type, season, key) {
  const [stored] = await pool.query('SELECT setting_value FROM site_settings WHERE setting_key = ?', [key]);
  let cached;
  try { cached = stored[0] ? JSON.parse(stored[0].setting_value) : null; } catch (_) { cached = null; }
  if (cached && Date.now() - Date.parse(cached.updatedAt) < TTL) {
    memory.set(key, { value: cached, until: Date.now() + TTL - (Date.now() - Date.parse(cached.updatedAt)) });
    return cached;
  }
  try {
    const response = await football.fetchPublicTable(TYPES[type], league, season);
    const rows = normalize(response, league, type);
    if (!rows.length) throw new Error('No rankings available');
    const value = { league: LEAGUES[league], season, rows, updatedAt: new Date().toISOString(), stale: false };
    await pool.query('INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [key, JSON.stringify(value)]);
    memory.set(key, { value, until: Date.now() + TTL });
    return value;
  } catch (err) {
    const value = cached ? { ...cached, stale: true } : { league: LEAGUES[league], season, rows: [], updatedAt: null, stale: false, unavailable: true };
    memory.set(key, { value, until: Date.now() + 5 * 60 * 1000 });
    console.error('[league-tables]', league, type, err.message);
    return value;
  }
}

function getTable(league, type) {
  if (!Object.hasOwn(LEAGUES, league) || !Object.hasOwn(TYPES, type)) throw new Error('Invalid league or table');
  const season = seasonNow();
  const key = `public_table_${league}_${season}_${type}`;
  if (memory.get(key)?.until > Date.now()) return Promise.resolve(memory.get(key).value);
  if (!pending.has(key)) pending.set(key, load(league, type, season, key).finally(() => pending.delete(key)));
  return pending.get(key);
}

module.exports = { getTable, LEAGUES, TYPES, normalize, seasonNow };
