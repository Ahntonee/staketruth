const slugify = require('slugify');

function generateSlug(text, suffix = '') {
  const base = slugify(text, { lower: true, strict: true });
  return suffix ? `${base}-${suffix}` : base;
}

function generatePredictionSlug(homeTeam, awayTeam, matchDateISO) {
  const datePart = (matchDateISO || '').slice(0, 10);
  return generateSlug(`${homeTeam}-vs-${awayTeam}-${datePart}`);
}

function generateBlogSlug(title) {
  return generateSlug(`${title}-${Date.now().toString(36)}`);
}

function formatOdds(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

function parsePagination(query, defaultLimit = 20, maxLimit = 100) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function paginate(totalItems, page, limit) {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

function successResponse(res, data, meta = undefined, status = 200) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

function errorResponse(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Strips all HTML tags — used on free-text inputs that are never meant to carry markup (names, comments, etc.)
function sanitiseText(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/<[^>]*>/g, '').trim();
}

function formatDateTime(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  generateSlug,
  generatePredictionSlug,
  generateBlogSlug,
  formatOdds,
  parsePagination,
  paginate,
  successResponse,
  errorResponse,
  asyncHandler,
  sanitiseText,
  formatDateTime,
  clamp,
};
