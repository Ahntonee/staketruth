const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const email = require('../utils/email');
const { PLANS } = require('../services/plans');

const PAYMENT_DETAIL_KEYS = ['payment_usdt_bep20_address', 'payment_bank_name', 'payment_bank_account_number', 'payment_bank_account_name'];

// Public -- the receiving wallet/bank details shown on the pricing page
// before a user picks crypto/bank transfer. Admin-editable (see adminUpdateDetails),
// not hardcoded, so these can change without a redeploy.
const getPaymentDetails = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN (?)`,
    [PAYMENT_DETAIL_KEYS]
  );
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  return successResponse(res, {
    usdtBep20Address: map.payment_usdt_bep20_address || '',
    bankName: map.payment_bank_name || '',
    bankAccountNumber: map.payment_bank_account_number || '',
    bankAccountName: map.payment_bank_account_name || '',
  });
});

const adminUpdateDetails = asyncHandler(async (req, res) => {
  const { usdtBep20Address, bankName, bankAccountNumber, bankAccountName } = req.body;
  const updates = {
    payment_usdt_bep20_address: usdtBep20Address, payment_bank_name: bankName,
    payment_bank_account_number: bankAccountNumber, payment_bank_account_name: bankAccountName,
  };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    await pool.query(
      `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
      [key, value, value]
    );
  }
  return successResponse(res, { message: 'Payment details updated' });
});

// A manual payment can never be auto-verified like Paystack -- there's no API
// to check a bank transfer or a specific wallet's incoming transactions
// against. The user just declares what they sent; an admin manually confirms
// it against their own bank/wallet before approving (see adminApprove).
const create = asyncHandler(async (req, res) => {
  const { plan, method, amount_claimed, reference_note } = req.body;
  if (!PLANS[plan]) return errorResponse(res, 'Invalid plan', 400);
  if (!['usdt_bep20', 'bank_transfer'].includes(method)) return errorResponse(res, 'Invalid payment method', 400);
  if (!reference_note || !reference_note.trim()) {
    return errorResponse(res, method === 'usdt_bep20' ? 'Enter the transaction hash you sent with' : 'Enter the sender name/reference you transferred with', 400);
  }
  const [result] = await pool.query(
    `INSERT INTO manual_payments (user_id, plan, method, amount_claimed, reference_note) VALUES (?, ?, ?, ?, ?)`,
    [req.user.id, plan, method, amount_claimed || PLANS[plan].amount, reference_note.trim()]
  );
  return successResponse(res, { id: result.insertId, message: 'Submitted -- your VIP access will activate once an admin confirms the payment.' }, undefined, 201);
});

const myClaims = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, plan, method, amount_claimed, status, created_at, reviewed_at FROM manual_payments WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user.id]
  );
  return successResponse(res, rows);
});

const adminList = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const where = status ? 'WHERE mp.status = ?' : '';
  const params = status ? [status] : [];
  const [rows] = await pool.query(
    `SELECT mp.*, u.name, u.email FROM manual_payments mp JOIN users u ON u.id = mp.user_id
     ${where} ORDER BY mp.created_at DESC`,
    params
  );
  return successResponse(res, rows);
});

// Mirrors subscriptions.adminGrant's activation logic (provider='manual')
// rather than duplicating a separate path -- a manually-approved crypto/bank
// payment should behave identically to an admin-granted VIP grant from here on.
const adminApprove = asyncHandler(async (req, res) => {
  const [[claim]] = await pool.query('SELECT * FROM manual_payments WHERE id = ?', [req.params.id]);
  if (!claim) return errorResponse(res, 'Payment claim not found', 404);
  if (claim.status !== 'pending') return errorResponse(res, `Already ${claim.status}`, 409);

  const selectedPlan = PLANS[claim.plan];
  const expiresAt = new Date(Date.now() + selectedPlan.days * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, provider, amount, expires_at) VALUES (?, ?, 'active', 'manual', ?, ?)`,
    [claim.user_id, claim.plan, claim.amount_claimed || selectedPlan.amount, expiresAt]
  );
  await pool.query("UPDATE users SET role = 'vip' WHERE id = ?", [claim.user_id]);
  await pool.query(
    `UPDATE manual_payments SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
    [req.user.id, req.params.id]
  );

  const [[user]] = await pool.query('SELECT email, name FROM users WHERE id = ?', [claim.user_id]);
  if (user) await email.sendVipWelcomeEmail({ email: user.email, name: user.name, telegramLink: process.env.TELEGRAM_VIP_INVITE_LINK });

  return successResponse(res, { message: 'Approved -- VIP activated', expiresAt });
});

const adminReject = asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    `UPDATE manual_payments SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'`,
    [req.body.admin_note || null, req.user.id, req.params.id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Payment claim not found or already reviewed', 404);
  return successResponse(res, { message: 'Rejected' });
});

module.exports = { getPaymentDetails, adminUpdateDetails, create, myClaims, adminList, adminApprove, adminReject };
