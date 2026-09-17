const { pool } = require('../config/db');
const email = require('../utils/email');
const activeSends = new Map();

// Announcements reach registered accounts; VIP narrows the audience.
async function getRecipients(audience) {
  let where = "email IS NOT NULL AND email <> ''";
  if (audience === 'vip') where += " AND role IN ('vip', 'admin')";
  const [rows] = await pool.query(`SELECT id, name, email FROM users WHERE ${where}`);
  return rows;
}

// Sends sequentially with a small delay between each -- a burst of thousands
// of simultaneous sends is far more likely to trip the email provider's own
// rate limit than the time this adds costs. Runs to completion in the
// background (callers don't await this); one recipient failing is logged
// and skipped, never aborts the rest of the batch.
async function deliverAnnouncement(announcement) {
  const recipients = await getRecipients(announcement.audience);
  let sent = 0;
  let failed = 0;
  for (const user of recipients) {
    try {
      const result = await email.sendAnnouncementEmail(
        user.email, user.name,
        announcement.email_subject || announcement.title,
        announcement.content || '',
        announcement.link_url, announcement.link_label
      );
      if (result && (result.error || result.skipped)) throw new Error(result.error || 'Email delivery is not configured');
      sent++;
    } catch (err) {
      failed++;
      console.error(`[newsletter] failed to send announcement ${announcement.id} to ${user.email}:`, err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (sent > 0 && failed === 0) {
    await pool.query('UPDATE announcements SET email_sent_at = NOW() WHERE id = ?', [announcement.id]);
  }
  await pool.query('UPDATE announcements SET email_error = ? WHERE id = ?', [failed ? `${failed} of ${recipients.length} emails failed. Check email configuration and server logs.` : (sent ? null : 'No recipients found.'), announcement.id]);
  console.log(`[newsletter] announcement ${announcement.id}: sent ${sent}/${recipients.length} (${failed} failed)`);
  return { sent, failed, total: recipients.length };
}

function sendAnnouncementNewsletter(announcement) {
  const key = String(announcement.id);
  if (activeSends.has(key)) return activeSends.get(key);
  const task = deliverAnnouncement(announcement).finally(() => activeSends.delete(key));
  activeSends.set(key, task);
  return task;
}

// Call after any create/update/publish/scheduled-publish that could have
// just made an announcement live -- starts delivery unless already completed
// (guarded by email_sent_at) if it's published, email delivery is on, and
// it hasn't already gone out. Fire-and-forget on purpose: a list of any real
// size would otherwise hold the admin's save/publish request open for a long
// time waiting on sequential email sends.
async function maybeSendForAnnouncement(id) {
  const [[row]] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);
  if (row && row.status === 'published' && row.delivery_email && !row.email_sent_at) {
    sendAnnouncementNewsletter(row).catch((err) => console.error('[newsletter] background send failed:', err.message));
  }
}

module.exports = { getRecipients, sendAnnouncementNewsletter, maybeSendForAnnouncement };
