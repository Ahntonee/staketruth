const axios = require('axios');
const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination, paginate } = require('../utils/helpers');
const email = require('../utils/email');

const DURATIONS = { daypass: 1, monthly: 30, quarterly: 90, annual: 365 };

const getStatus = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  return successResponse(res, rows[0] || null);
});

const paystackVerify = asyncHandler(async (req, res) => {
  const { reference, plan } = req.body;
  if (!DURATIONS[plan]) return errorResponse(res, 'Invalid plan', 400);

  if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('YOUR_PAYSTACK')) {
    return errorResponse(res, 'Payments are not configured yet on this deployment. Add PAYSTACK_SECRET_KEY to .env.', 503);
  }

  const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const txn = response.data.data;
  if (txn.status !== 'success') return errorResponse(res, 'Payment not successful', 400);

  const expiresAt = new Date(Date.now() + DURATIONS[plan] * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, provider, paystack_reference, amount, currency, expires_at)
     VALUES (?, ?, 'active', 'paystack', ?, ?, ?, ?)`,
    [req.user.id, plan, reference, txn.amount / 100, txn.currency, expiresAt]
  );
  await pool.query("UPDATE users SET role = 'vip' WHERE id = ?", [req.user.id]);
  await email.sendVipWelcomeEmail({ email: req.user.email, name: req.user.name, telegramLink: process.env.TELEGRAM_VIP_INVITE_LINK });

  return successResponse(res, { message: 'VIP activated', expiresAt });
});

const cancel = asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'`,
    [req.user.id]
  );
  return successResponse(res, { message: 'Subscription cancelled — you\'ll keep VIP access until it expires.' });
});

const adminGrant = asyncHandler(async (req, res) => {
  const { user_id, plan, days } = req.body;
  const duration = days || DURATIONS[plan] || 30;
  const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, provider, amount, expires_at) VALUES (?, ?, 'active', 'manual', 0, ?)`,
    [user_id, plan || 'monthly', expiresAt]
  );
  await pool.query("UPDATE users SET role = 'vip' WHERE id = ?", [user_id]);
  return successResponse(res, { message: 'VIP granted', expiresAt });
});

const adminList = asyncHandler(async (req, res) => {
  const { status, plan } = req.query;
  const { page, limit, offset } = parsePagination(req.query);
  const where = [];
  const params = [];
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (plan) { where.push('s.plan = ?'); params.push(plan); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM subscriptions s ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT s.*, u.name, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id
     ${whereSql} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, rows, paginate(countRows[0].cnt, page, limit));
});

const adminExtend = asyncHandler(async (req, res) => {
  const days = Number(req.body.days) || 30;
  await pool.query('UPDATE subscriptions SET expires_at = DATE_ADD(expires_at, INTERVAL ? DAY) WHERE id = ?', [days, req.params.id]);
  return successResponse(res, { message: 'Subscription extended' });
});

const adminCancel = asyncHandler(async (req, res) => {
  await pool.query("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?", [req.params.id]);
  return successResponse(res, { message: 'Subscription cancelled' });
});

const adminNotifyExpiry = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.plan, s.expires_at, u.email, u.name FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return errorResponse(res, 'Subscription not found', 404);
  await email.sendExpiryReminderEmail(rows[0]);
  return successResponse(res, { message: 'Reminder sent' });
});

module.exports = {
  getStatus, paystackVerify, cancel, adminGrant, adminList, adminExtend, adminCancel, adminNotifyExpiry,
};
