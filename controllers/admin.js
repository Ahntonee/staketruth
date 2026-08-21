const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination, paginate } = require('../utils/helpers');

// ---- Dashboard overview -----------------------------------------------------

const getDashboardOverview = asyncHandler(async (req, res) => {
  const apiFootball = require('../services/apiFootball');
  const oddsApi = require('../services/oddsApi');

  const [[totalPreds]] = await pool.query('SELECT COUNT(*) AS cnt FROM predictions');
  const [[todayPreds]] = await pool.query('SELECT COUNT(*) AS cnt FROM predictions WHERE DATE(match_date) = CURDATE()');
  const [[queueCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM predictions WHERE source = 'intelligence' AND is_published = 0");
  const [[winRateRow]] = await pool.query("SELECT stat_value FROM accuracy_stats WHERE stat_key = 'win_rate'");
  const [[vipWinRateRow]] = await pool.query("SELECT stat_value FROM accuracy_stats WHERE stat_key = 'vip_win_rate'");
  const [[activeVip]] = await pool.query("SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active'");
  const [[totalUsers]] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  const [[newUsersWeek]] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
  const [[revenueMonth]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM subscriptions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  const [[revenueTotal]] = await pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM subscriptions');
  const [[lastRun]] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'last_intelligence_run'");
  const [[lastPush]] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'last_auto_push'");
  const [[vipToday]] = await pool.query("SELECT COUNT(*) AS cnt FROM predictions WHERE is_vip_pick_of_day = 1 AND DATE(match_date) = CURDATE()");
  const [[pushedToday]] = await pool.query("SELECT COUNT(*) AS cnt FROM predictions WHERE pushed_to_registered = 1 AND DATE(match_date) = CURDATE()");
  const [[adSlotsTotal]] = await pool.query('SELECT COUNT(*) AS cnt FROM ad_slots');
  const [[adSlotsEnabled]] = await pool.query('SELECT COUNT(*) AS cnt FROM ad_slots WHERE is_enabled = 1');

  const apiBudget = await apiFootball.getRemainingCount();
  const oddsCallsToday = await oddsApi.getCallsToday();

  const [recentPredictions] = await pool.query(
    `SELECT id, home_team, away_team, tip, match_date, result, is_published FROM predictions ORDER BY created_at DESC LIMIT 8`
  );

  // Week-over-week deltas — give the KPI row a sense of direction, not just a snapshot.
  const [[predsThisWeek]] = await pool.query("SELECT COUNT(*) AS cnt FROM predictions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
  const [[predsLastWeek]] = await pool.query("SELECT COUNT(*) AS cnt FROM predictions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)");
  const [[winRateThisWeek]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM prediction_accuracy_log WHERE logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
  );
  const [[winRateLastWeek]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM prediction_accuracy_log WHERE logged_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND logged_at < DATE_SUB(NOW(), INTERVAL 7 DAY)"
  );
  const [[revenueLastMonth]] = await pool.query(
    "SELECT COALESCE(SUM(amount),0) AS total FROM subscriptions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)"
  );

  const wrThisWeek = winRateThisWeek.total ? (Number(winRateThisWeek.correct) / winRateThisWeek.total) * 100 : null;
  const wrLastWeek = winRateLastWeek.total ? (Number(winRateLastWeek.correct) / winRateLastWeek.total) * 100 : null;

  return successResponse(res, {
    totalPredictions: totalPreds.cnt,
    todayPredictions: todayPreds.cnt,
    reviewQueueCount: queueCount.cnt,
    winRate: winRateRow?.stat_value || '0.0',
    vipWinRate: vipWinRateRow?.stat_value || '0.0',
    activeVipSubscribers: activeVip.cnt,
    totalUsers: totalUsers.cnt,
    newUsersThisWeek: newUsersWeek.cnt,
    revenueThisMonth: Number(revenueMonth.total),
    revenueTotal: Number(revenueTotal.total),
    intelligence: { lastRun: lastRun?.setting_value || null, lastAutoPush: lastPush?.setting_value || null, vipPicksToday: vipToday.cnt, pushedToday: pushedToday.cnt },
    apiBudget: { apiFootball: apiBudget, oddsApiCallsToday: oddsCallsToday },
    adSlots: { total: adSlotsTotal.cnt, enabled: adSlotsEnabled.cnt },
    recentPredictions,
    trends: {
      predictions: predsLastWeek.cnt ? Math.round(((predsThisWeek.cnt - predsLastWeek.cnt) / predsLastWeek.cnt) * 100) : null,
      winRate: (wrThisWeek !== null && wrLastWeek !== null) ? Math.round(wrThisWeek - wrLastWeek) : null,
      revenue: Number(revenueLastMonth.total) ? Math.round(((Number(revenueMonth.total) - Number(revenueLastMonth.total)) / Number(revenueLastMonth.total)) * 100) : null,
    },
  });
});

// 14-day trend series for the dashboard's performance chart.
const getDashboardTrend = asyncHandler(async (req, res) => {
  const [volume] = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS cnt FROM predictions
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY DATE(created_at) ORDER BY day ASC`
  );
  const [accuracy] = await pool.query(
    `SELECT DATE(logged_at) AS day, COUNT(*) AS total, SUM(is_correct) AS correct FROM prediction_accuracy_log
     WHERE logged_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY DATE(logged_at) ORDER BY day ASC`
  );
  return successResponse(res, { volume, accuracy });
});

// ---- Users ------------------------------------------------------------------

const listUsers = asyncHandler(async (req, res) => {
  const { role, country, status } = req.query;
  const { page, limit, offset } = parsePagination(req.query, 25, 200);
  const where = [];
  const params = [];
  if (role) { where.push('role = ?'); params.push(role); }
  if (country) { where.push('country = ?'); params.push(country); }
  if (status === 'banned') where.push('is_banned = 1');
  if (status === 'active') where.push('is_banned = 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM users ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT id, name, email, role, country, is_banned, is_comment_banned, created_at FROM users ${whereSql}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, rows, paginate(countRows[0].cnt, page, limit));
});

const getUser = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role, country, is_banned, is_comment_banned, created_at FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'User not found', 404);
  const [subs] = await pool.query('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
  const [preds] = await pool.query(
    `SELECT COUNT(*) AS bookmarked FROM bookmarks WHERE user_id = ?`, [req.params.id]
  );
  return successResponse(res, { ...rows[0], subscriptions: subs, activity: preds[0] });
});

const banUser = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET is_banned = 1 WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'User banned' });
});
const unbanUser = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET is_banned = 0 WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'User unbanned' });
});
const commentBanUser = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET is_comment_banned = 1 WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'User banned from commenting' });
});
const commentUnbanUser = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET is_comment_banned = 0 WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'User unbanned from commenting' });
});
const grantVip = asyncHandler(async (req, res) => {
  const days = Number(req.body.days) || 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, provider, amount, expires_at) VALUES (?, 'monthly', 'active', 'manual', 0, ?)`,
    [req.params.id, expiresAt]
  );
  await pool.query("UPDATE users SET role = 'vip' WHERE id = ?", [req.params.id]);
  return successResponse(res, { message: 'VIP granted', expiresAt });
});

// ---- Leaderboard --------------------------------------------------------

// Display labels for the raw category enum -- shown to admins in the
// Accuracy by Category table instead of the raw db value (e.g. 'over_1_5').
const CATEGORY_LABELS = {
  free: 'Free Pick', vip: 'VIP', banker: 'Banker',
  over_1_5: '1.5 Goals', over_2_5: '2.5 Goals', over_3_5: '3.5 Goals',
  under_1_5: '1.5 Goals', under_2_5: '2.5 Goals', under_3_5: '3.5 Goals',
  gg: 'BTTS', home_win: 'Home Win', away_win: 'Away Win', draw: 'Draw',
};

const getLeaderboard = asyncHandler(async (req, res) => {
  const { period = '30d', group_by = 'market', sort_by = 'win_rate' } = req.query;
  const days = period === '7d' ? 7 : period === 'all' ? 36500 : 30;
  const groupCol = group_by === 'league' ? 'l.name' : group_by === 'team' ? 'p.home_team' : group_by === 'category' ? 'p.category' : 'p.market';
  const extraSelect = group_by === 'league' ? ', l.country AS group_country' : '';

  const [rows] = await pool.query(
    `SELECT ${groupCol} AS group_label${extraSelect}, COUNT(*) AS total,
            SUM(p.result = 'won') AS wins, SUM(p.result = 'lost') AS losses,
            AVG(p.confidence_score) AS avg_confidence
     FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.result IN ('won','lost') AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY ${groupCol}${extraSelect} HAVING total >= 1
     ORDER BY ${sort_by === 'most_won' ? 'wins' : sort_by === 'confidence' ? 'avg_confidence' : '(wins/total)'} DESC
     LIMIT 30`,
    [days]
  );
  const data = rows.map((r) => ({
    ...r,
    win_rate: r.total ? ((r.wins / r.total) * 100).toFixed(1) : '0.0',
    group_label: group_by === 'category' ? (CATEGORY_LABELS[r.group_label] || r.group_label) : r.group_label,
  }));
  return successResponse(res, data);
});

const getLeaderboardSummary = asyncHandler(async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS settled, SUM(result = 'won') AS won, SUM(result = 'lost') AS lost
     FROM predictions WHERE result IN ('won','lost')`
  );
  const settled = Number(row.settled) || 0;
  const won = Number(row.won) || 0;
  const lost = Number(row.lost) || 0;
  return successResponse(res, {
    settled, won, lost,
    accuracy: settled ? Number(((won / settled) * 100).toFixed(1)) : 0,
  });
});

const getRecentResults = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const [rows] = await pool.query(
    `SELECT home_team, away_team, home_score, away_score, tip, result, match_date
     FROM predictions WHERE result IN ('won','lost')
     ORDER BY match_date DESC LIMIT ?`,
    [limit]
  );
  return successResponse(res, rows);
});

// ---- Generic site settings (social links, misc key/value) ----------------

const getSettings = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM site_settings');
  return successResponse(res, Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
});

const putSetting = asyncHandler(async (req, res) => {
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [req.params.key, req.body.value ?? '']
  );
  return successResponse(res, { message: 'Setting updated' });
});

const getStatOverrides = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM site_stat_overrides');
  return successResponse(res, rows);
});

const putStatOverride = asyncHandler(async (req, res) => {
  await pool.query(
    `INSERT INTO site_stat_overrides (stat_key, stat_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value)`,
    [req.params.key, req.body.value]
  );
  return successResponse(res, { message: 'Override saved' });
});

module.exports = {
  getDashboardOverview, getDashboardTrend, listUsers, getUser, banUser, unbanUser, commentBanUser, commentUnbanUser, grantVip,
  getLeaderboard, getLeaderboardSummary, getRecentResults, getSettings, putSetting, getStatOverrides, putStatOverride,
};
