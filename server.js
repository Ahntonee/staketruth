require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { pool, waitForDb } = require('./config/db');
const { attachUser, identifyGuest } = require('./middleware/auth');
const { trackPageView } = require('./controllers/analytics');
const { startScheduler } = require('./services/scheduler');

const app = express();
app.set('trust proxy', 1);
app.set('etag', false);

// ---- Webhooks need the raw body for signature verification — must be
// registered BEFORE express.json() ------------------------------------------
app.use('/api/webhooks', express.raw({ type: 'application/json' }));
app.use('/api/webhooks', require('./routes/webhooks'));

// ---- Security headers -------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.paystack.co', 'https://cdn.jsdelivr.net',
          'https://pagead2.googlesyndication.com', 'https://googleads.g.doubleclick.net',
          'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://tagassistant.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        // gtag.js loading (scriptSrc, above) is only half of Analytics working --
        // it also needs to actually SEND hit data via fetch/beacon to Google's
        // collection endpoints, which is gated by connectSrc, not scriptSrc. GA4
        // uses region-sharded subdomains (region1.google-analytics.com etc.),
        // hence the wildcard rather than listing the exact one in use today.
        connectSrc: ["'self'", 'https://api.paystack.co', 'https://pagead2.googlesyndication.com',
          'https://www.google-analytics.com', 'https://*.google-analytics.com',
          'https://www.googletagmanager.com', 'https://analytics.google.com', 'https://tagassistant.google.com'],
        // Tag Assistant's live "Test your website" mode drops a floating debug
        // panel onto the page itself (separate from gtag.js/GA collection above)
        // that phones home to tagassistant.google.com to report connection status
        // -- without this, the tag can be installed and firing correctly and
        // Tag Assistant will still show "Not Connected" / "Could not connect".
        frameSrc: ["'self'", 'https://js.paystack.co', 'https://googleads.g.doubleclick.net', 'https://tagassistant.google.com'],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors({ origin: process.env.SITE_URL, credentials: true }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());

// ---- Body parsing: small default limit, larger only for admin blog/pages ----
app.use(['/api/blog', '/api/admin/pages', '/api/pages'], express.json({ limit: '10mb' }));
app.use(express.json({ limit: '10kb' }));

// ---- Auth/guest context + analytics -----------------------------------------
app.use(attachUser);
app.use(identifyGuest);
app.use(trackPageView);

// ---- Rate limiting ------------------------------------------------------------
// Vote-tally reads (GET .../votes) are excluded from the general limiter: a page
// with several prediction cards each polling their own live vote widget every
// 5-8s (Part 12 of the build spec — polling, not WebSockets) can easily produce
// more legitimate read traffic than a conservative global cap allows. The
// vote-CAST endpoint (POST) keeps its own strict per-route limiter (routes/predictions.js).
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' && /\/votes$/.test(req.path),
});
const voteReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);
app.use(/^\/api\/predictions\/\d+\/votes$/, voteReadLimiter);

// ---- Static files -------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');

// Server-side <head> injection for Google Search Console (meta tag method),
// AdSense (auto-ads script), and Google Analytics (gtag.js) so verification/
// tracking works without depending on JS execution or per-page edits — set
// GOOGLE_SITE_VERIFICATION / ADSENSE_PUBLISHER_ID / GA_MEASUREMENT_ID in .env.
// This one function is already wired into every HTML response (the catch-all
// middleware below plus the /prediction, /blog, /topic detail routes), so a
// single env var here covers the entire site with no per-page changes.
function extraHeadTags() {
  let inject = '';
  if (process.env.GOOGLE_SITE_VERIFICATION) {
    inject += `<meta name="google-site-verification" content="${process.env.GOOGLE_SITE_VERIFICATION}">`;
  }
  if (process.env.ADSENSE_PUBLISHER_ID) {
    inject += `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.ADSENSE_PUBLISHER_ID}" crossorigin="anonymous"></script>`;
  }
  if (process.env.GA_MEASUREMENT_ID) {
    const gaId = process.env.GA_MEASUREMENT_ID;
    inject += `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>`;
  }
  return inject;
}

const SEO_PAGE_KEY_BY_PATH = {
  '/': 'home',
  '/predictions.html': 'predictions',
  '/pricing.html': 'pricing',
  '/blog.html': 'blog',
  '/about.html': 'about',
  '/statistics.html': 'statistics',
};

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const isHtmlRequest = req.path === '/' || req.path.endsWith('.html');
  if (!isHtmlRequest || req.path.startsWith('/admin')) return next();

  const filePath = path.join(PUBLIC_DIR, req.path === '/' ? 'index.html' : req.path);
  fs.readFile(filePath, 'utf8', async (err, html) => {
    if (err) return next(); // let static/404 handling take over

    const pageKey = SEO_PAGE_KEY_BY_PATH[req.path];
    if (pageKey) {
      try {
        const [rows] = await pool.query('SELECT title, description, keywords, og_image FROM seo_settings WHERE page_key = ?', [pageKey]);
        const seo = rows[0];
        if (seo) {
          if (seo.title) html = html.replace(/<title>.*?<\/title>/s, `<title>${seo.title}</title>`);
          if (seo.description) html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${seo.description.replace(/"/g, '&quot;')}$2`);
          if (seo.keywords) html = html.replace(/(<meta name="keywords" content=")[^"]*(")/, `$1${seo.keywords.replace(/"/g, '&quot;')}$2`);
          if (seo.og_image) html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${seo.og_image}$2`);
        }
      } catch (e) { /* DB might not be seeded yet — fall back to the static defaults in the file */ }
    }

    const inject = extraHeadTags();
    if (inject) html = html.replace('</head>', `${inject}</head>`);
    // Paystack's PUBLIC key is safe to expose client-side (it's designed to be) —
    // substituted here so pricing.html never hardcodes a real key in source.
    html = html.replace(/\{\{PAYSTACK_PUBLIC_KEY\}\}/g, process.env.PAYSTACK_PUBLIC_KEY || '');
    res.type('html').send(html);
  });
});

// Cache-busting is not part of this build (no hashed filenames for CSS/JS/HTML), so a
// blanket 1y max-age would make every future fix invisible to returning visitors for up
// to a year. HTML always revalidates; JS/CSS get a short cache; images/fonts can be long.
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (process.env.NODE_ENV !== 'production') { res.setHeader('Cache-Control', 'no-store'); return; }
    if (/\.html?$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    else if (/\.(js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
    else res.setHeader('Cache-Control', 'public, max-age=2592000');
  },
}));

// ---- Admin path guard: only whitelisted admin pages are ever served --------
const ADMIN_PAGES = new Set([
  'index.html', 'dashboard.html', 'intelligence.html', 'predictions.html', 'categories.html',
  'leaderboard.html', 'blog.html', 'subscriptions.html', 'users.html', 'leagues.html',
  'moderation.html', 'ads.html', 'sync.html', 'analytics.html', 'revenue.html', 'seo.html',
  'seo-pages.html', 'backlinks.html', 'pages.html', 'settings.html',
]);
app.get('/admin/:page', (req, res, next) => {
  if (!ADMIN_PAGES.has(req.params.page)) return res.status(404).send('Not found');
  return res.sendFile(path.join(PUBLIC_DIR, 'admin', req.params.page));
});
app.get('/admin', (req, res) => res.redirect('/admin/index.html'));

// ---- API routes -----------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/leagues', require('./routes/leagues'));
app.use('/api/statistics', require('./routes/statistics'));
app.use('/api/admin/intelligence', require('./routes/intelligence'));
app.use('/api/ads', require('./routes/adSlots'));
app.use('/api/blog', require('./routes/blog'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/analytics'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/backlinks', require('./routes/backlinks'));
app.use('/api/seo-pages', require('./routes/seoPages'));
app.use('/api/accumulators', require('./routes/accumulators'));
app.use('/api/bet-builder', require('./routes/betBuilder'));

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', time: new Date().toISOString() }));
app.get('/api/status', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    conn.release();
    return res.json({ success: true, db: 'connected' });
  } catch (err) {
    return res.status(500).json({ success: false, db: 'disconnected', error: err.message });
  }
});

// ---- Pretty URLs -----------------------------------------------------------
// All three of these are real server-side rendering, not just client-side
// document.title tricks -- title, meta description, canonical URL, structured
// data, AND the visible content itself are injected before the response goes
// out, so a crawler (or anything else that doesn't run JS) sees the actual
// page on the very first request. See services/ssr.js for why this mattered:
// every one of these pages previously defaulted its canonical tag to the
// homepage until client JS corrected it, which told search engines to treat
// the whole prediction/blog/topic library as homepage duplicates.
const ssr = require('./services/ssr');

app.get('/prediction/:slug', (req, res) => {
  fs.readFile(path.join(PUBLIC_DIR, 'prediction-detail.html'), 'utf8', async (err, html) => {
    if (err) return res.status(500).send('Server error');
    try {
      const [rows] = await pool.query(
        'SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id WHERE p.slug = ?',
        [req.params.slug]
      );
      if (rows.length) html = ssr.renderPredictionPage(html, rows[0], req.user ? req.user.role : 'guest');
    } catch (e) { /* fall back to the static template defaults */ }
    const inject = extraHeadTags();
    if (inject) html = html.replace('</head>', `${inject}</head>`);
    res.type('html').send(html);
  });
});

app.get('/blog/:slug', (req, res) => {
  fs.readFile(path.join(PUBLIC_DIR, 'blog-post.html'), 'utf8', async (err, html) => {
    if (err) return res.status(500).send('Server error');
    try {
      const [rows] = await pool.query('SELECT * FROM blog_posts WHERE slug = ? AND is_published = 1', [req.params.slug]);
      if (rows.length) html = ssr.renderBlogPage(html, rows[0]);
    } catch (e) { /* fall back to the static template defaults */ }
    const inject = extraHeadTags();
    if (inject) html = html.replace('</head>', `${inject}</head>`);
    res.type('html').send(html);
  });
});

app.get('/topic/:slug', (req, res) => {
  fs.readFile(path.join(PUBLIC_DIR, 'seo-landing.html'), 'utf8', async (err, html) => {
    if (err) return res.status(500).send('Server error');
    try {
      const [rows] = await pool.query(
        'SELECT * FROM seo_landing_pages WHERE slug = ? AND is_published = 1',
        [req.params.slug]
      );
      if (rows.length) html = ssr.renderTopicPage(html, rows[0]);
    } catch (e) { /* fall back to the static template defaults */ }
    const inject = extraHeadTags();
    if (inject) html = html.replace('</head>', `${inject}</head>`);
    res.type('html').send(html);
  });
});

// ---- SEO: robots.txt, sitemap.xml, ads.txt ---------------------------------
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /dashboard.html\nDisallow: /reset-password.html\n\nSitemap: ${process.env.SITE_URL}/sitemap.xml\n`
  );
});

app.get('/ads.txt', async (req, res) => {
  const [rows] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'adsense_publisher_id'");
  const publisherId = rows[0]?.setting_value || process.env.ADSENSE_PUBLISHER_ID;
  if (!publisherId) return res.type('text/plain').send('');
  res.type('text/plain').send(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`);
});

let sitemapCache = { xml: null, at: 0 };
app.get('/sitemap.xml', async (req, res) => {
  if (sitemapCache.xml && Date.now() - sitemapCache.at < 60 * 60 * 1000) {
    return res.type('application/xml').send(sitemapCache.xml);
  }
  const site = process.env.SITE_URL;
  const staticUrls = ['/', '/predictions.html', '/pricing.html', '/blog.html', '/about.html', '/statistics.html'];
  const lowPriorityUrls = ['/contact.html', '/terms.html', '/privacy.html'];
  const [preds] = await pool.query(
    "SELECT slug, updated_at FROM predictions WHERE is_published = 1 AND slug IS NOT NULL ORDER BY updated_at DESC LIMIT 5000"
  );
  const [posts] = await pool.query("SELECT slug, updated_at FROM blog_posts WHERE is_published = 1 ORDER BY updated_at DESC");
  const [topics] = await pool.query("SELECT slug, updated_at FROM seo_landing_pages WHERE is_published = 1 ORDER BY updated_at DESC");

  const urlXml = (loc, lastmod, priority) =>
    `<url><loc>${site}${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}<priority>${priority}</priority></url>`;

  const body = [
    ...staticUrls.map((u) => urlXml(u, null, u === '/' ? '1.0' : '0.7')),
    ...lowPriorityUrls.map((u) => urlXml(u, null, '0.3')),
    ...preds.map((p) => urlXml(`/prediction/${p.slug}`, p.updated_at, '0.6')),
    ...posts.map((p) => urlXml(`/blog/${p.slug}`, p.updated_at, '0.5')),
    ...topics.map((t) => urlXml(`/topic/${t.slug}`, t.updated_at, '0.7')),
  ].join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
  sitemapCache = { xml, at: Date.now() };
  res.type('application/xml').send(xml);
});

// Google Search Console HTML-file verification support: drop a file named
// google1234567890abcdef.html in public/ and it's served automatically by the
// static middleware above. GOOGLE_SITE_VERIFICATION in .env drives the meta-tag
// method instead (read by app.js / injected server-side into page <head>s).

// ---- 404 for anything else under /api -------------------------------------
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// ---- Global error handler ----------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[error]', err);
  // Full error detail is still logged above for debugging -- this just avoids
  // leaking raw SQL/schema in the response. A couple of common MySQL error
  // codes get an actionable-but-safe message instead of the fully generic
  // one, since "one of your fields is too long" is genuinely useful to an
  // admin filling out a form and reveals nothing about the schema.
  let message = process.env.NODE_ENV === 'production' ? 'An error occurred.' : err.message;
  if (process.env.NODE_ENV === 'production') {
    if (err.code === 'ER_DATA_TOO_LONG') message = 'One of the fields you entered is too long for its limit -- please shorten it and try again.';
    else if (err.code === 'ER_DUP_ENTRY') message = 'That value is already in use -- please choose a different one.';
  }
  res.status(err.status || 500).json({ success: false, message });
});

const PORT = process.env.PORT || 3000;

waitForDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] StakeTruth listening on port ${PORT} (${process.env.NODE_ENV})`);
      startScheduler();
    });
  })
  .catch((err) => {
    console.error('[server] failed to connect to database, exiting:', err.message);
    process.exit(1);
  });

module.exports = app;
