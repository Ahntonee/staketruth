const { pool } = require('../config/db');
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

// ---- SEO settings ---------------------------------------------------------

const getAllSeo = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_settings ORDER BY page_key');
  return successResponse(res, rows);
});

const getSeoForPage = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_settings WHERE page_key = ?', [req.params.pageKey]);
  return successResponse(res, rows[0] || null);
});

const updateSeo = asyncHandler(async (req, res) => {
  const { title, description, keywords, og_image } = req.body;
  await pool.query(
    `INSERT INTO seo_settings (page_key, title, description, keywords, og_image) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description),
       keywords = VALUES(keywords), og_image = VALUES(og_image)`,
    [req.params.pageKey, title, description, keywords, og_image || null]
  );
  return successResponse(res, { message: 'SEO settings updated' });
});

module.exports = { getPage, updatePage, getSocialLinks, getAllSeo, getSeoForPage, updateSeo };
