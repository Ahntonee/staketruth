const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { generateToken, setTokenCookie, clearTokenCookie } = require('../utils/jwt');
const { successResponse, errorResponse, asyncHandler, sanitiseText } = require('../utils/helpers');
const email = require('../utils/email');

// In-memory OTP failure tracker: email -> { count, resetAt }
const otpFailures = new Map();
const OTP_MAX_FAILS = 5;
const OTP_WINDOW_MS = 15 * 60 * 1000;

function isOtpBlocked(emailAddr) {
  const entry = otpFailures.get(emailAddr);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { otpFailures.delete(emailAddr); return false; }
  return entry.count >= OTP_MAX_FAILS;
}
function recordOtpFailure(emailAddr) {
  const entry = otpFailures.get(emailAddr) || { count: 0, resetAt: Date.now() + OTP_WINDOW_MS };
  entry.count += 1;
  otpFailures.set(emailAddr, entry);
}
function clearOtpFailures(emailAddr) {
  otpFailures.delete(emailAddr);
}

const initiateRegister = asyncHandler(async (req, res) => {
  const name = sanitiseText(req.body.name);
  const email_ = req.body.email.toLowerCase();
  const country = sanitiseText(req.body.country || '');

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email_]);
  if (existing.length) return errorResponse(res, 'An account with this email already exists', 409);

  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const token = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await pool.query(
    `INSERT INTO pending_registrations (email, name, password_hash, country, token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash),
       country = VALUES(country), token = VALUES(token), expires_at = VALUES(expires_at)`,
    [email_, name, passwordHash, country, token, expiresAt]
  );

  await email.sendOtpEmail(email_, name, token);
  clearOtpFailures(email_);
  return successResponse(res, { message: 'Verification code sent', email: email_ });
});

const verifyRegistration = asyncHandler(async (req, res) => {
  const email_ = req.body.email.toLowerCase();
  const { token } = req.body;

  if (isOtpBlocked(email_)) {
    return errorResponse(res, 'Too many failed attempts. Please try again later.', 429);
  }

  const [rows] = await pool.query('SELECT * FROM pending_registrations WHERE email = ?', [email_]);
  const pending = rows[0];
  if (!pending || pending.token !== token || new Date(pending.expires_at) < new Date()) {
    recordOtpFailure(email_);
    return errorResponse(res, 'Invalid or expired verification code', 400);
  }

  const [result] = await pool.query(
    `INSERT INTO users (name, email, password_hash, country, role) VALUES (?, ?, ?, ?, 'user')`,
    [pending.name, pending.email, pending.password_hash, pending.country]
  );
  await pool.query('DELETE FROM pending_registrations WHERE email = ?', [email_]);
  clearOtpFailures(email_);

  const user = { id: result.insertId, name: pending.name, email: pending.email, role: 'user' };
  setTokenCookie(res, generateToken(user));
  await email.sendWelcomeEmail(user.email, user.name);

  return successResponse(res, { user }, undefined, 201);
});

const login = asyncHandler(async (req, res) => {
  const email_ = req.body.email.toLowerCase();
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email_]);
  const user = rows[0];
  if (!user) return errorResponse(res, 'Invalid email or password', 401);
  if (user.is_banned) return errorResponse(res, 'This account has been suspended', 403);

  const match = await bcrypt.compare(req.body.password, user.password_hash);
  if (!match) return errorResponse(res, 'Invalid email or password', 401);

  setTokenCookie(res, generateToken(user));
  return successResponse(res, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, country: user.country },
  });
});

const logout = asyncHandler(async (req, res) => {
  clearTokenCookie(res);
  return successResponse(res, { message: 'Logged out' });
});

const me = asyncHandler(async (req, res) => {
  if (!req.user) return errorResponse(res, 'Not authenticated', 401);
  const [subs] = await pool.query(
    `SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY expires_at DESC LIMIT 1`,
    [req.user.id]
  );
  return successResponse(res, { user: req.user, subscription: subs[0] || null });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const email_ = (req.body.email || '').toLowerCase();
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email_]);
  if (rows.length) {
    const user = rows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query('UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?', [
      hashedToken, expires, user.id,
    ]);
    const resetUrl = `${process.env.SITE_URL}/reset-password.html?token=${rawToken}`;
    await email.sendPasswordResetEmail(user.email, user.name, resetUrl);
  }
  // Always 200 — never reveal whether the email exists
  return successResponse(res, { message: 'If an account exists for that email, a reset link has been sent.' });
});

const resetPassword = asyncHandler(async (req, res) => {
  const hashedToken = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
    [hashedToken]
  );
  if (!rows.length) return errorResponse(res, 'Invalid or expired reset link', 400);

  const passwordHash = await bcrypt.hash(req.body.password, 12);
  await pool.query(
    'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
    [passwordHash, rows[0].id]
  );
  return successResponse(res, { message: 'Password reset — you can now log in.' });
});

const changePassword = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const match = await bcrypt.compare(req.body.currentPassword, rows[0].password_hash);
  if (!match) return errorResponse(res, 'Current password is incorrect', 400);

  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
  return successResponse(res, { message: 'Password updated' });
});

module.exports = {
  initiateRegister, verifyRegistration, login, logout, me, forgotPassword, resetPassword, changePassword,
};
