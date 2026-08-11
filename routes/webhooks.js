const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/db');

// Mounted in server.js with express.raw({ type: 'application/json' }) BEFORE
// express.json(), so req.body here is the raw Buffer needed for HMAC verification.
router.post('/paystack', async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret || secret.includes('YOUR_PAYSTACK')) return res.status(503).end();

    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
    if (hash !== signature) return res.status(401).end();

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      const { reference, customer, plan: planCode } = event.data;
      const [existing] = await pool.query('SELECT id FROM subscriptions WHERE paystack_reference = ?', [reference]);
      if (!existing.length) {
        const [userRows] = await pool.query('SELECT id FROM users WHERE email = ?', [customer.email]);
        if (userRows.length) {
          const days = event.data.metadata?.plan === 'annual' ? 365 : event.data.metadata?.plan === 'quarterly' ? 90 : 30;
          const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          await pool.query(
            `INSERT INTO subscriptions (user_id, plan, status, provider, paystack_reference, amount, currency, expires_at)
             VALUES (?, ?, 'active', 'paystack', ?, ?, ?, ?)`,
            [userRows[0].id, event.data.metadata?.plan || 'monthly', reference, event.data.amount / 100, event.data.currency, expiresAt]
          );
          await pool.query("UPDATE users SET role = 'vip' WHERE id = ?", [userRows[0].id]);
        }
      }
    }

    if (event.event === 'subscription.disable') {
      const email = event.data.customer?.email;
      if (email) {
        const [userRows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (userRows.length) {
          await pool.query("UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'", [userRows[0].id]);
          await pool.query("UPDATE users SET role = 'user' WHERE id = ?", [userRows[0].id]);
        }
      }
    }

    return res.status(200).end();
  } catch (err) {
    console.error('[webhooks] paystack error:', err.message);
    return res.status(400).end();
  }
});

module.exports = router;
