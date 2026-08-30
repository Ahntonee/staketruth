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

// ---- Content Performance (SEO / prediction + blog page tracking) ----------
// Distinct from the generic site-wide "Website Analytics" above: this looks
// only at the content pages that actually matter for SEO -- prediction and
// blog detail pages -- and ties views back to the specific match/post via the
// same slug the pretty URL is built from (see server.js's /prediction/:slug
// and /blog/:slug routes).
const CONTENT_PATH_FILTER = `(path LIKE '/prediction/%' OR path LIKE '/blog/%')`;

const performanceOverview = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const [[period]] = await pool.query(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN path LIKE '/prediction/%' THEN 1 ELSE 0 END) AS predictionViews,
       SUM(CASE WHEN path LIKE '/blog/%' THEN 1 ELSE 0 END) AS blogViews,
       COUNT(DISTINCT DATE(viewed_at)) AS activeDays
     FROM page_views WHERE ${CONTENT_PATH_FILTER} AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  const [[today]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM page_views WHERE ${CONTENT_PATH_FILTER} AND DATE(viewed_at) = CURDATE()`
  );
  const [[last7]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM page_views WHERE ${CONTENT_PATH_FILTER} AND viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
  );
  return successResponse(res, {
    totalViews: Number(period.total) || 0,
    todayViews: Number(today.cnt) || 0,
    last7Views: Number(last7.cnt) || 0,
    predictionViews: Number(period.predictionViews) || 0,
    blogViews: Number(period.blogViews) || 0,
    activeDays: Number(period.activeDays) || 0,
  });
});

const performanceDaily = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const [rows] = await pool.query(
    `SELECT DATE(viewed_at) AS day,
       SUM(CASE WHEN path LIKE '/prediction/%' THEN 1 ELSE 0 END) AS predictions,
       SUM(CASE WHEN path LIKE '/blog/%' THEN 1 ELSE 0 END) AS blog
     FROM page_views WHERE ${CONTENT_PATH_FILTER} AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY DATE(viewed_at) ORDER BY day ASC`,
    [days]
  );
  return successResponse(res, rows);
});

const performanceTopPredictions = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const [rows] = await pool.query(
    `SELECT p.id, p.home_team, p.away_team, p.tip, COUNT(*) AS views
     FROM page_views pv JOIN predictions p ON pv.path = CONCAT('/prediction/', p.slug)
     WHERE pv.viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY p.id ORDER BY views DESC LIMIT ?`,
    [days, limit]
  );
  return successResponse(res, rows);
});

const performanceTopBlogPosts = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const [rows] = await pool.query(
    `SELECT b.id, b.title, b.category, COUNT(*) AS views
     FROM page_views pv JOIN blog_posts b ON pv.path = CONCAT('/blog/', b.slug)
     WHERE pv.viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY b.id ORDER BY views DESC LIMIT ?`,
    [days, limit]
  );
  return successResponse(res, rows);
});

// Ballpark-only estimate for a $2-$5 CPM display-ad range applied to content
// page views in the period -- not tied to any ad network actually being live.
const performanceRevenueEstimate = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const [[period]] = await pool.query(
    `SELECT COUNT(*) AS total FROM page_views WHERE ${CONTENT_PATH_FILTER} AND viewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  const views = Number(period.total) || 0;
  return successResponse(res, {
    views,
    low: Number(((views / 1000) * 2).toFixed(2)),
    high: Number(((views / 1000) * 5).toFixed(2)),
  });
});

module.exports = {
  trackPageView, overview, topPages, countries, devices, referrers, peakHours,
  revenueOverview, revenueByMonth, revenuePlans, revenueChurn,
  performanceOverview, performanceDaily, performanceTopPredictions, performanceTopBlogPosts, performanceRevenueEstimate,
};
