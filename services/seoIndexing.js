const MIN_PREDICTION_ANALYSIS_LENGTH = 180;
const PREDICTION_PAST_DAYS = 2;
const PREDICTION_FUTURE_DAYS = 7;

function cleanSiteUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[char]));
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absoluteUrl(siteUrl, path) {
  return `${cleanSiteUrl(siteUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function urlEntry(siteUrl, path, { lastmod, priority } = {}) {
  const modified = isoDate(lastmod);
  return '<url>' +
    `<loc>${escapeXml(absoluteUrl(siteUrl, path))}</loc>` +
    (modified ? `<lastmod>${modified}</lastmod>` : '') +
    (priority ? `<priority>${priority}</priority>` : '') +
    '</url>';
}

function urlSet(siteUrl, entries) {
  const body = entries.map((entry) => urlEntry(siteUrl, entry.path, entry)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

function sitemapIndex(siteUrl, paths) {
  const body = paths.map((path) => `<sitemap><loc>${escapeXml(absoluteUrl(siteUrl, path))}</loc></sitemap>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

// This fragment is deliberately shared by every sitemap query. Individual
// match pages are useful search results only while timely, fully public, and
// backed by enough unique analysis to stand on their own. VIP/banker pages
// remain available to visitors but their generic locked shell is not indexed.
const INDEXABLE_PREDICTION_WHERE = `
  p.is_published = 1
  AND p.is_vip = 0
  AND p.is_banker = 0
  AND p.slug IS NOT NULL
  AND p.slug != ''
  AND p.tip IS NOT NULL
  AND p.tip != ''
  AND p.analysis IS NOT NULL
  AND CHAR_LENGTH(TRIM(p.analysis)) >= ${MIN_PREDICTION_ANALYSIS_LENGTH}
  AND p.match_date >= DATE_SUB(CURDATE(), INTERVAL ${PREDICTION_PAST_DAYS} DAY)
  AND p.match_date < DATE_ADD(CURDATE(), INTERVAL ${PREDICTION_FUTURE_DAYS + 1} DAY)`;

function isIndexablePrediction(prediction, now = new Date()) {
  if (!prediction || !prediction.is_published || prediction.is_vip || prediction.is_banker) return false;
  if (!String(prediction.slug || '').trim() || !String(prediction.tip || '').trim()) return false;
  if (String(prediction.analysis || '').trim().length < MIN_PREDICTION_ANALYSIS_LENGTH) return false;

  const matchDate = new Date(prediction.match_date);
  if (Number.isNaN(matchDate.getTime())) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - PREDICTION_PAST_DAYS);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + PREDICTION_FUTURE_DAYS + 1);
  return matchDate >= start && matchDate < end;
}

module.exports = {
  INDEXABLE_PREDICTION_WHERE,
  absoluteUrl,
  cleanSiteUrl,
  encodePathSegment,
  isIndexablePrediction,
  sitemapIndex,
  urlSet,
};
