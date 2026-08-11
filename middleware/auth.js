const crypto = require('crypto');
const { pool } = require('../config/db');
const { verifyToken, COOKIE_NAME, GUEST_COOKIE_NAME } = require('../utils/jwt');
const { errorResponse } = require('../utils/helpers');

// Populates req.user (or null) from the st_token cookie. Never rejects — downstream
// middleware/route handlers decide what to do with an absent user.
async function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    const [rows] = await pool.query(
      'SELECT id, name, email, role, country, telegram_invited, is_banned, is_comment_banned FROM users WHERE id = ?',
      [decoded.id]
    );
    if (rows.length && !rows[0].is_banned) {
      req.user = rows[0];
    }
  } catch (err) {
    // invalid/expired token — treat as logged out
  }
  next();
}

function authenticate(req, res, next) {
  if (!req.user) return errorResponse(res, 'Authentication required', 401);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return errorResponse(res, 'Admin access required', 403);
  next();
}

function requireVip(req, res, next) {
  if (!req.user || (req.user.role !== 'vip' && req.user.role !== 'admin')) {
    return errorResponse(res, 'VIP subscription required', 403);
  }
  next();
}

// Ensures every visitor (logged in or not) has a stable st_guest token, used only
// to de-duplicate anonymous match-poll votes. Not used for auth in any way.
function identifyGuest(req, res, next) {
  let guestToken = req.cookies?.[GUEST_COOKIE_NAME];
  if (!guestToken) {
    guestToken = crypto.randomUUID();
    res.cookie(GUEST_COOKIE_NAME, guestToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  req.guestToken = guestToken;
  next();
}

module.exports = { attachUser, authenticate, requireAdmin, requireVip, identifyGuest };
