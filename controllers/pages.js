const { pool } = require('../config/db');
const pageSeo = require('../services/pageSeo');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

const getPage = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM static_pages WHERE slug = ?', [req.params.slug]);
  if (!rows.length) return errorResponse(res, 'Page not found', 404);
  return successResponse(res, rows[0]);
});

const updatePage = asyncHandler(async (req, res) => {
  const { title, content, extra } = req.body;
  await pool.query(
    `INSERT INTO static_pages (slug, title, content, extra) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), extra = VALUES(extra)`,
    [req.params.slug, title, content, extra ? JSON.stringify(extra) : null]
  );
  return successResponse(res, { message: 'Page updated' });
});

const getSocialLinks = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key LIKE 'social_%' OR setting_key IN ('contact_email', 'contact_whatsapp')`
  );
  const links = {};
  for (const r of rows) {
    if (!r.setting_value) continue;
    links[r.setting_key.startsWith('social_') ? r.setting_key.replace('social_', '') : r.setting_key] = r.setting_value;
  }
  return successResponse(res, links);
});

// Affiliate CTA on prediction cards -- returns null values (not an error)
// until an admin actually configures a bookmaker via site_settings, so the
// frontend can just hide the CTA rather than show a dead link. No affiliate
// program was live at the time this was built; this makes turning one on
// a settings change, not a code change.
const getAffiliateConfig = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('affiliate_bookmaker_name', 'affiliate_bookmaker_url')`
  );
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value || null]));
  return successResponse(res, {
    name: map.affiliate_bookmaker_name || null,
    url: map.affiliate_bookmaker_url || null,
  });
});

// ---- SEO settings ---------------------------------------------------------

const getAllSeo = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_settings ORDER BY page_key');
  return successResponse(res, rows.map(row => {
    if (!pageSeo.pages[row.page_key]) return row;
    const defaults = pageSeo.defaults(row.page_key);
    return { ...row, h1: row.h1 ?? defaults.h1, intro: row.intro ?? defaults.intro, supports_heading: defaults.supports_heading, public_path: '/' + pageSeo.pages[row.page_key] };
  }));
});

const getSeoForPage = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_settings WHERE page_key = ?', [req.params.pageKey]);
  return successResponse(res, rows[0] || null);
});

const updateSeo = asyncHandler(async (req, res) => {
  if (!Object.hasOwn(pageSeo.pages, req.params.pageKey)) return errorResponse(res, 'Unknown page', 400);
  const names = Object.keys(pageSeo.fields).filter(name => Object.hasOwn(req.body, name));
  if (!names.length) return errorResponse(res, 'No SEO fields supplied', 400);
  for (const name of names) {
    if (typeof req.body[name] !== 'string' || req.body[name].length > pageSeo.fields[name]) return errorResponse(res, 'Invalid or too long: ' + name, 400);
  }
  for (const name of ['canonical_url', 'og_image']) {
    if (req.body[name]) {
      try { if (!['https:', 'http:'].includes(new URL(req.body[name]).protocol)) throw new Error(); }
      catch (_) { return errorResponse(res, name + ' must be a full HTTP or HTTPS URL', 400); }
    }
  }
  if (req.body.robots && !['index, follow', 'noindex, follow', 'noindex, nofollow'].includes(req.body.robots)) return errorResponse(res, 'Invalid robots setting', 400);
  await pool.query(
    'INSERT INTO seo_settings (page_key, ' + names.join(', ') + ') VALUES (' + ['?', ...names.map(() => '?')].join(', ') + ') ON DUPLICATE KEY UPDATE ' + names.map(name => name + ' = VALUES(' + name + ')').join(', '),
    [req.params.pageKey, ...names.map(name => req.body[name])]
  );
  return successResponse(res, { message: 'SEO settings updated' });
});

module.exports = { getPage, updatePage, getSocialLinks, getAffiliateConfig, getAllSeo, getSeoForPage, updateSeo };
