const { pool } = require('../config/db');
const { successResponse, asyncHandler } = require('../utils/helpers');

function detectDeviceType(userAgent = '') {
  if (/mobile/i.test(userAgent)) return 'mobile';
  if (/tablet|ipad/i.test(userAgent)) return 'tablet';
  return 'desktop';
}

// Matches an actual page navigation: "/", "*.html", or the pretty
// "/prediction/:slug" and "/blog/:slug" routes — never a static asset.
const STATIC_ASSET_RE = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|map|xml|txt|json)$/i;
function isPageNavigation(path) {
  if (STATIC_ASSET_RE.test(path)) return false;
  if (path === '/' || path.endsWith('.html')) return true;
  if (/^\/prediction\/[^/]+$/.test(path) || /^\/blog\/[^/]+$/.test(path)) return true;
  return false;
}

// Lightweight, fire-and-forget page view logger. Never blocks the response and
// never stores a full IP or any PII beyond a coarse country string. Only real
// page navigations are logged — static assets (CSS/JS/images/sitemap/etc.)
// would otherwise drown out the "top pages" signal.
function trackPageView(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
  if (!isPageNavigation(req.path)) return next();
  const path = req.path;
  const referrer = req.get('referrer') || req.get('referer') || null;
  const deviceType = detectDeviceType(req.get('user-agent') || '');
  const sessionId = req.cookies?.st_guest || null;
  const country = req.headers['cf-ipcountry'] || req.headers['x-country'] || null; // populated by a CDN/geo layer in production

  pool.query(
    'INSERT INTO page_views (path, country, device_type, referrer, session_id) VALUES (?, ?, ?, ?, ?)',
    [path, country, deviceType, referrer, sessionId]
  ).catch((err) => console.error('[analytics] page view log failed:', err.message));

  next();
}

const overview = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const [rows] = await pool.query(
    `SELECT DATE(viewed_at) AS day, COUNT(*) AS views FROM page_views
     WHERE viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY DATE(viewed_at) ORDER BY day ASC`,
    [days]
  );
  return successResponse(res, rows);
});

const topPages = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT path, COUNT(*) AS views FROM page_views GROUP BY path ORDER BY views DESC LIMIT 20`
  );
  return successResponse(res, rows);
});

const countries = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT COALESCE(country, 'Unknown') AS country, COUNT(*) AS views FROM page_views GROUP BY country ORDER BY views DESC LIMIT 20`
  );
  return successResponse(res, rows);
});

const devices = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT device_type, COUNT(*) AS views FROM page_views GROUP BY device_type`);
  return successResponse(res, rows);
});

const referrers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT COALESCE(referrer, 'Direct') AS referrer, COUNT(*) AS views FROM page_views GROUP BY referrer ORDER BY views DESC LIMIT 20`
  );
  return successResponse(res, rows);
});

const peakHours = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT HOUR(viewed_at) AS hour, COUNT(*) AS views FROM page_views GROUP BY HOUR(viewed_at) ORDER BY hour ASC`);
  return successResponse(res, rows);
});

const revenueOverview = asyncHandler(async (req, res) => {
  const [[totalAllTime]] = await pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM subscriptions');
  const [[thisMonth]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM subscriptions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  const [[activeSubs]] = await pool.query("SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active'");
  const avgLtv = activeSubs.cnt ? Number(totalAllTime.total) / activeSubs.cnt : 0;
  return successResponse(res, {
    totalAllTime: Number(totalAllTime.total), thisMonth: Number(thisMonth.total),
    activeSubscribers: activeSubs.cnt, averageLtv: avgLtv.toFixed(2),
  });
});

const revenueByMonth = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, plan, SUM(amount) AS total
     FROM subscriptions GROUP BY month, plan ORDER BY month ASC`
  );
  return successResponse(res, rows);
});

const revenuePlans = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT plan, COUNT(*) AS cnt FROM subscriptions WHERE status = 'active' GROUP BY plan`);
  return successResponse(res, rows);
});

const revenueChurn = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(updated_at, '%Y-%m') AS month, COUNT(*) AS churned
     FROM subscriptions WHERE status = 'expired' GROUP BY month ORDER BY month ASC`
  );
  return successResponse(res, rows);
});

module.exports = {
  trackPageView, overview, topPages, countries, devices, referrers, peakHours,
  revenueOverview, revenueByMonth, revenuePlans, revenueChurn,
};
