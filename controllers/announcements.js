const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const newsletter = require('../services/newsletter');

// Public: published, non-expired, audience-eligible announcements, most
// recent first. Audience filtering happens here (not client-side) so a
// guest's response never even contains the content of a registered/VIP-only
// announcement. delivery_popup/delivery_banner are included so the frontend
// can decide where to render each one (see ST.renderAnnouncements /
// ST.renderAnnouncementPopup in app.js) from a single fetch.
const listPublic = asyncHandler(async (req, res) => {
  const role = req.user ? req.user.role : null; // null = guest
  const [rows] = await pool.query(
    `SELECT id, title, content, link_url, link_label, type, delivery_banner, delivery_popup, created_at
     FROM announcements
     WHERE status = 'published' AND (expires_at IS NULL OR expires_at > NOW())
       AND (audience = 'all' OR (audience = 'registered' AND ? IS NOT NULL) OR (audience = 'vip' AND ? IN ('vip', 'admin')))
     ORDER BY created_at DESC LIMIT 5`,
    [role, role]
  );
  return successResponse(res, rows);
});

const listAdmin = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  return successResponse(res, rows);
});

function readDeliveryFields(body) {
  return {
    audience: ['all', 'registered', 'vip'].includes(body.audience) ? body.audience : 'all',
    delivery_banner: body.delivery_banner ? 1 : 0,
    delivery_popup: body.delivery_popup ? 1 : 0,
    delivery_email: body.delivery_email ? 1 : 0,
    email_subject: body.email_subject || null,
    scheduled_at: body.scheduled_at || null,
  };
}

const create = asyncHandler(async (req, res) => {
  const { title, content, link_url, link_label, type, status, expires_at } = req.body;
  if (!title) return errorResponse(res, 'Title is required', 400);
  const d = readDeliveryFields(req.body);
  // A scheduled send can't also be "published" yet -- it stays a draft until
  // the scheduler cron promotes it at scheduled_at (see services/scheduler.js).
  const finalStatus = d.scheduled_at ? 'draft' : (status === 'published' ? 'published' : 'draft');
  const [result] = await pool.query(
    `INSERT INTO announcements
     (title, content, link_url, link_label, type, status, is_active, expires_at,
      audience, delivery_banner, delivery_popup, delivery_email, email_subject, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, content || null, link_url || null, link_label || null, type || 'info', finalStatus, finalStatus === 'published' ? 1 : 0, expires_at || null,
      d.audience, d.delivery_banner, d.delivery_popup, d.delivery_email, d.email_subject, d.scheduled_at]
  );
  await newsletter.maybeSendForAnnouncement(result.insertId);
  return successResponse(res, { id: result.insertId }, null, 201);
});

const update = asyncHandler(async (req, res) => {
  const { title, content, link_url, link_label, type, status, expires_at } = req.body;
  const d = readDeliveryFields(req.body);
  const finalStatus = d.scheduled_at ? 'draft' : (status === 'published' ? 'published' : 'draft');
  await pool.query(
    `UPDATE announcements SET
       title = ?, content = ?, link_url = ?, link_label = ?, type = ?, status = ?, is_active = ?, expires_at = ?,
       audience = ?, delivery_banner = ?, delivery_popup = ?, delivery_email = ?, email_subject = ?, scheduled_at = ?
     WHERE id = ?`,
    [title, content || null, link_url || null, link_label || null, type || 'info', finalStatus, finalStatus === 'published' ? 1 : 0, expires_at || null,
      d.audience, d.delivery_banner, d.delivery_popup, d.delivery_email, d.email_subject, d.scheduled_at,
      req.params.id]
  );
  await newsletter.maybeSendForAnnouncement(req.params.id);
  return successResponse(res, { message: 'Updated' });
});

// Quick "publish this draft" action from the list, separate from a full edit.
const publish = asyncHandler(async (req, res) => {
  await pool.query(`UPDATE announcements SET status = 'published', is_active = 1, scheduled_at = NULL WHERE id = ?`, [req.params.id]);
  await newsletter.maybeSendForAnnouncement(req.params.id);
  return successResponse(res, { message: 'Published' });
});

// Explicit manual (re)send -- ignores the email_sent_at guard maybeSendForAnnouncement
// respects, for an admin who wants to resend or send a newsletter that was
// published before this feature existed / before delivery_email was checked.
const sendEmailNow = asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
  if (!row) return errorResponse(res, 'Announcement not found', 404);
  if (row.status !== 'published') return errorResponse(res, 'Publish the announcement before sending it as a newsletter', 400);
  const recipients = await newsletter.getRecipients(row.audience);
  newsletter.sendAnnouncementNewsletter(row).catch((err) => console.error('[newsletter] manual send failed:', err.message));
  return successResponse(res, { message: 'Sending', recipientCount: recipients.length });
});

const remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Deleted' });
});

module.exports = { listPublic, listAdmin, create, update, publish, sendEmailNow, remove };
