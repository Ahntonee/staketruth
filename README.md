# StakeTruth

Data-driven football predictions platform — free & VIP tips, a statistical Intelligence Engine, Banker of the Day, VIP Picks of the Day, live win-vote polls, and a full admin panel.

## Stack

Node 20+/22 LTS, Express 5, MySQL 8, vanilla JS + a shared design-system CSS (mobile-first), PM2 for production process management.

## Local setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Database** — a `staketruth` database and dedicated `staketruth_user` were already created on this machine's local MySQL during setup. If you're moving to a new machine, create them yourself:
   ```sql
   CREATE DATABASE staketruth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'staketruth_user'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
   GRANT ALL PRIVILEGES ON staketruth.* TO 'staketruth_user'@'localhost';
   ```
   Then update `DB_PASSWORD` in `.env` to match.

3. **Environment** — `.env` already exists with working local DB credentials and placeholder values for third-party services. Fill in real values when ready (see "What still needs your input" below).

4. **Run migrations** (safe to re-run any time — every statement is idempotent):
   ```bash
   npm run migrate
   ```

5. **(Optional) Seed demo content** — a handful of realistic sample predictions and a blog post, so the site isn't empty before you connect a real API-Football key:
   ```bash
   node config/seed_demo.js
   ```

6. **Start the server**
   ```bash
   npm start
   ```
   or, for auto-reload during development:
   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000`. Admin panel: `http://localhost:3000/admin/index.html`.

   **Default admin login:** `admin@staketruth.com` / `Admin@ST!` — change this password after your first login (Dashboard → avatar menu → Dashboard → Account Settings, or directly in `admin/users.html`... note the admin account itself is best managed by logging in as that user and using the public-site dashboard's "Change Password" form).

## What still needs your input before this is production-ready

| Item | Where | Why it matters |
|---|---|---|
| **Real logo** | `public/images/logo.png` | You said you'd add this yourself — the header/footer reference it and gracefully fall back to a text wordmark until it exists. |
| **Favicon** | `public/favicon.png` | Currently missing (404) — add a 32x32/64x64 PNG. |
| **API-Football key** | `.env` → `API_FOOTBALL_KEY` | Powers real fixture/result syncing and the historical-data backfill. Without it, the Intelligence Engine has nothing to analyze beyond manually-entered or demo predictions. |
| **The Odds API key** | `.env` → `ODDS_API_KEY` | Powers the live bookie-odds tags shown on prediction cards. |
| **Paystack keys** | `.env` → `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` | Required for real VIP subscription payments. Use test keys first. |
| **SMTP credentials** | `.env` → `SMTP_*` | Required for OTP verification emails, password resets, and subscription reminders. Until set, these emails are logged to the console instead of sent. |
| **Telegram VIP invite link** | `.env` → `TELEGRAM_VIP_INVITE_LINK` | Shown to new VIP subscribers. |
| **Domain** | Baked in as `staketruth.com` throughout SEO tags, sitemap, canonical URLs | Update `SITE_URL` in `.env` and the hardcoded canonical/OG URLs in each public HTML `<head>` if the real domain differs. |
| **Google Search Console** | `.env` → `GOOGLE_SITE_VERIFICATION` | Paste the verification code Google gives you when you add the site as a property — it's injected server-side into every page's `<head>` automatically. |
| **Google AdSense** | `admin/ads.html` (per-placement) + `.env` → `ADSENSE_PUBLISHER_ID` (site-wide auto-ads script) | Ad units render nothing until you fill in a real publisher/slot ID and enable a placement. **Note:** AdSense's policies are stricter for gambling-adjacent content — keep site copy framed around "predictions/analysis" rather than betting incitement (already done throughout) to maximize approval odds, and expect closer scrutiny than a typical content site. |

## Architecture notes worth knowing

- **Role-based gating happens server-side**, not via CSS — a locked prediction's real tip/odds/analysis never reach a browser that shouldn't see them (`controllers/predictions.js` → `serializePrediction`).
- **Live vote polls use polling, not WebSockets** (every 7s while the tab is visible) — a deliberate choice so the app stays a stateless, horizontally-scalable PM2 cluster. See `PART 12` of `staketruth-build-prompt.md` for the full rationale if you ever revisit this.
- **The Intelligence Engine learns from its own database** — H2H lookups and confidence scoring prefer `historical_fixtures` (your own accumulated match history) over live API calls, falling back to the API only when local data is thin. Run a historical backfill (`admin/sync.html`) per league once you have an API-Football key, so the engine has something to learn from immediately instead of starting cold.
- **Profitability data (`admin/intelligence.html`) is intentionally admin-only** — it's never exposed on any public page or public API endpoint.
- **The full product/technical spec this app was built from** lives at `../oddslander/staketruth-build-prompt.md` (in the sibling folder where the spec was originally drafted) — refer to it for the complete rationale behind every feature.

## Production deployment

```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup
```

See `nginx.conf.example`... (not yet generated — ask for it if you're ready to deploy; it needs your real domain and SSL setup details first).

## Scheduled jobs

All cron jobs (`services/scheduler.js`) only run on PM2 instance 0, so scaling to multiple instances never double-runs a sync. Key jobs: fixture sync + Intelligence Engine run (`SYNC_CRON_SCHEDULE`, default 6am daily), results grading, nightly statistics/profitability refresh, hourly subscription-expiry checks, and the 00:00 daily auto-push of top picks to registered users.
