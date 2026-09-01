const cron = require('node-cron');
const { pool } = require('../config/db');
const apiFootball = require('./apiFootball');
const oddsApi = require('./oddsApi');
const intelligence = require('./intelligence');
const accuracy = require('./accuracy');
const statistics = require('./statistics');
const newsletter = require('./newsletter');

// PM2's `pm_id` is a GLOBAL counter across every app on the daemon (not per-app),
// so on a shared box running other PM2 apps this app can easily land on pm_id=5
// and never be "instance 0" even with a single worker. `NODE_APP_INSTANCE` is the
// per-app-group index PM2 sets specifically for this purpose — always '0' for a
// lone fork-mode instance, and 0..N-1 within this app's own cluster group.
function isSchedulerInstance() {
  return process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0';
}

async function setLastRun(key) {
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`,
    [key]
  );
}

function safeRun(name, fn) {
  return async () => {
    try {
      const result = await fn();
      console.log(`[scheduler] ${name} complete:`, JSON.stringify(result));
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err.message);
    }
  };
}

function startScheduler() {
  if (!isSchedulerInstance()) {
    console.log('[scheduler] not instance 0 — cron jobs disabled on this worker');
    return;
  }

  const syncSchedule = process.env.SYNC_CRON_SCHEDULE || '0 6 * * *';

  cron.schedule(syncSchedule, safeRun('sync fixtures + run intelligence', async () => {
    const fixtures = await apiFootball.syncTodayAndTomorrow();
    const engine = await intelligence.runForAllToday();
    await setLastRun('last_sync_fixtures');
    return { fixtures, engine };
  }));

  cron.schedule('0 0 * * *', safeRun('daily auto-push + VIP picks finalise', () => intelligence.runDailyPush()));

  cron.schedule('45 23 * * *', safeRun('log accuracy outcomes', async () => {
    const logged = await accuracy.logUntracked();
    const stats = await accuracy.recalculateStats();
    return { logged, stats };
  }));

  cron.schedule('50 23 * * *', safeRun('refresh statistics + profitability', async () => {
    const team = await statistics.refreshTeamStatistics();
    const league = await statistics.refreshLeagueStatistics();
    const market = await statistics.refreshMarketStats();
    const profit = await statistics.computeProfitability();
    return { team, league, market, profit };
  }));

  cron.schedule('0 * * * *', safeRun('subscription expiry check', async () => {
    const email = require('../utils/email');
    const [expiringSoon] = await pool.query(
      `SELECT s.id, s.user_id, s.plan, s.expires_at, u.email, u.name
       FROM subscriptions s JOIN users u ON u.id = s.user_id
       WHERE s.status = 'active' AND s.expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
         AND s.notified_expiry = 0`
    );
    for (const sub of expiringSoon) {
      await email.sendExpiryReminderEmail(sub);
      await pool.query('UPDATE subscriptions SET notified_expiry = 1 WHERE id = ?', [sub.id]);
    }
    const [expired] = await pool.query(
      `SELECT s.user_id FROM subscriptions s WHERE s.status = 'active' AND s.expires_at < NOW()`
    );
    for (const s of expired) {
      await pool.query(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'`, [s.user_id]);
      await pool.query(`UPDATE users SET role = 'user' WHERE id = ? AND role = 'vip'`, [s.user_id]);
    }
    return { notified: expiringSoon.length, expired: expired.length };
  }));

  // Refreshes already-scored, still-open predictions as match day approaches
  // and today's team form/H2H data has moved on since the original score.
  // Runs every 6 hours rather than once a day (this is local computation, no
  // API calls, so it's cheap) and at a raised limit so it can keep pace with
  // a large bulk-synced backlog (e.g. a 60-day range sync). runForPrediction's
  // GREATEST()-guarded is_published means this can only ever newly publish a
  // prediction that's improved past the threshold, never unpublish one already live.
  cron.schedule('15 */6 * * *', safeRun('re-score open predictions', async () => {
    const [pending] = await pool.query(
      `SELECT id, home_team, away_team, league_id, match_date FROM predictions
       WHERE result = 'pending' AND source = 'intelligence' AND match_date >= NOW() LIMIT 500`
    );
    let rescored = 0, newlyPublished = 0;
    for (const p of pending) {
      try {
        const r = await intelligence.runForPrediction(p);
        rescored++;
        if (r.autoPublished) newlyPublished++;
      } catch (e) { /* skip */ }
    }
    return { rescored, newlyPublished };
  }));

  // Gate on a local check before spending an API call: syncLiveScores previously
  // ran unconditionally every 3 min, 24/7 (480 calls/day) even when nothing was
  // playing — enough by itself to exhaust a 100/day free-tier budget in a few
  // hours and permanently starve any on-demand use (admin backfill, manual sync).
  cron.schedule('*/3 * * * *', safeRun('live score sync', async () => {
    const [live] = await pool.query(
      `SELECT 1 FROM predictions WHERE result = 'pending' AND api_fixture_id IS NOT NULL
       AND match_date BETWEEN DATE_SUB(NOW(), INTERVAL 150 MINUTE) AND DATE_ADD(NOW(), INTERVAL 15 MINUTE) LIMIT 1`
    );
    if (!live.length) return { skipped: true, reason: 'no matches in live window' };
    return apiFootball.syncLiveScores();
  }));

  cron.schedule('*/20 * * * *', safeRun('grade finished matches', async () => {
    const r = await apiFootball.syncResults();
    await setLastRun('last_sync_results');
    return r;
  }));

  cron.schedule('0 3 * * *', safeRun('reset odds API budget', () => oddsApi.resetCallsToday()));
  cron.schedule('0 3 * * *', safeRun('reset API-Football daily cap', () => apiFootball.resetCallsToday()));

  cron.schedule('*/30 * * * *', safeRun('sync bookie odds', () => oddsApi.syncOddsForTodayFixtures()));

  cron.schedule('*/5 * * * *', safeRun('publish scheduled blog posts', async () => {
    const [result] = await pool.query(
      `UPDATE blog_posts SET is_published = 1, published_at = NOW()
       WHERE is_published = 0 AND scheduled_publish_at IS NOT NULL AND scheduled_publish_at <= NOW()`
    );
    return { published: result.affectedRows };
  }));

  cron.schedule('*/5 * * * *', safeRun('publish scheduled announcements', async () => {
    const [due] = await pool.query(
      `SELECT id FROM announcements WHERE status = 'draft' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`
    );
    if (!due.length) return { published: 0 };
    await pool.query(
      `UPDATE announcements SET status = 'published', is_active = 1
       WHERE status = 'draft' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`
    );
    for (const row of due) await newsletter.maybeSendForAnnouncement(row.id);
    return { published: due.length };
  }));

  console.log('[scheduler] all cron jobs registered on instance 0');
}

module.exports = { startScheduler, isSchedulerInstance };
