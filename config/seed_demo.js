// OPTIONAL — populates realistic demo content (predictions, a blog post) so the
// site has something to show before real API-Football/Odds API keys are added.
// Not run automatically by `npm start`; run manually with `node config/seed_demo.js`.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./db');
const { generatePredictionSlug, generateBlogSlug } = require('../utils/helpers');

function isoInHours(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}
function isoDaysAgo(d) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

const DEMO_PREDICTIONS = [
  { home: 'Arsenal', away: 'Crystal Palace', league: 'Premier League', hours: 5, tip: 'Over 2.5 Goals', market: 'Over/Under', category: 'over_2_5', odds: 1.65, conf: 81, vip: 0, banker: 0, analysis: 'Arsenal are in strong home form (WWWDW), averaging 2.3 goals per home game. Crystal Palace have conceded in 4 of their last 5 away fixtures. Confidence: 81/100.' },
  { home: 'Man City', away: 'Bournemouth', league: 'Premier League', hours: 7, tip: 'Home Win', market: '1X2', category: 'home_win', odds: 1.30, conf: 88, vip: 0, banker: 1, analysis: 'Man City have won 8 of their last 9 home league games. Bournemouth have struggled on the road this season. Confidence: 88/100.' },
  { home: 'Real Madrid', away: 'Getafe', league: 'La Liga', hours: 9, tip: 'Over 1.5 Goals', market: 'Over/Under', category: 'over_1_5', odds: 1.22, conf: 90, vip: 1, banker: 0, analysis: 'Real Madrid have hit Over 1.5 in 9 of their last 10 matches. Our Poisson model projects a 91% probability. Confidence: 90/100.' },
  { home: 'Bayern Munich', away: 'Union Berlin', league: 'Bundesliga', hours: 12, tip: 'BTTS No', market: 'BTTS', category: 'gg', odds: 1.85, conf: 76, vip: 0, banker: 0, analysis: 'Bayern have kept 5 clean sheets in their last 7. Union Berlin have struggled to score against top-half sides. Confidence: 76/100.' },
  { home: 'PSG', away: 'Lyon', league: 'Ligue 1', hours: 24, tip: 'Home Win', market: '1X2', category: 'vip', odds: 1.45, conf: 86, vip: 1, banker: 0, analysis: 'PSG have won 7 of their last 8 against Lyon at home. Confidence: 86/100.' },
  { home: 'Inter Milan', away: 'Torino', league: 'Serie A', hours: 30, tip: 'Over 2.5 Goals', market: 'Over/Under', category: 'over_2_5', odds: 1.90, conf: 74, vip: 0, banker: 0, analysis: 'Inter are averaging 2.4 goals per home game this season. Confidence: 74/100.' },
];

async function seedDemo() {
  const [[leagueMap]] = [await pool.query('SELECT id, name FROM leagues').then(([r]) => [Object.fromEntries(r.map((l) => [l.name, l.id]))])];

  for (const p of DEMO_PREDICTIONS) {
    const matchDate = isoInHours(p.hours);
    const slug = generatePredictionSlug(p.home, p.away, matchDate);
    const [existing] = await pool.query('SELECT id FROM predictions WHERE slug = ?', [slug]);
    if (existing.length) continue;
    await pool.query(
      `INSERT INTO predictions
       (slug, league_id, home_team, away_team, match_date, tip, market, category, odds, confidence_score,
        intelligence_score, analysis, is_vip, is_banker, is_vip_pick_of_day, source, is_published, published_at, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intelligence', 1, NOW(), 'pending')`,
      [slug, leagueMap[p.league] || null, p.home, p.away, matchDate, p.tip, p.market, p.category, p.odds,
        p.conf, p.conf, p.analysis, p.vip, p.banker, p.conf >= 85 ? 1 : 0]
    );
  }

  // A few already-graded wins for the Recent Wins rail
  const WINS = [
    { home: 'Liverpool', away: 'Everton', tip: 'Home Win', days: 1, hs: 3, as: 0 },
    { home: 'Napoli', away: 'Lazio', tip: 'Over 2.5 Goals', days: 2, hs: 2, as: 2 },
    { home: 'Dortmund', away: 'Mainz', tip: 'BTTS Yes', days: 3, hs: 2, as: 1 },
  ];
  for (const w of WINS) {
    const matchDate = isoDaysAgo(w.days);
    const slug = generatePredictionSlug(w.home, w.away, matchDate);
    const [existing] = await pool.query('SELECT id FROM predictions WHERE slug = ?', [slug]);
    if (existing.length) continue;
    await pool.query(
      `INSERT INTO predictions (slug, home_team, away_team, match_date, tip, market, category,
        odds, confidence_score, intelligence_score, is_published, published_at, result, home_score, away_score, source)
       VALUES (?, ?, ?, ?, ?, '1X2', 'free', 1.80, 79, 79, 1, NOW(), 'won', ?, ?, 'intelligence')`,
      [slug, w.home, w.away, matchDate, w.tip, w.hs, w.as]
    );
  }

  const blogSlug = generateBlogSlug('how-our-intelligence-engine-predicts-football-matches');
  const [existingPost] = await pool.query('SELECT id FROM blog_posts WHERE title = ?', ['How Our Intelligence Engine Predicts Football Matches']);
  if (!existingPost.length) {
    await pool.query(
      `INSERT INTO blog_posts (slug, title, excerpt, content, category, author_name, meta_title, meta_description, keywords, is_published, published_at)
       VALUES (?, ?, ?, ?, 'Strategy', 'StakeTruth Team', ?, ?, ?, 1, NOW())`,
      [blogSlug, 'How Our Intelligence Engine Predicts Football Matches',
        'A look under the hood at the Poisson model and learning loop behind StakeTruth predictions.',
        '# How Our Intelligence Engine Predicts Football Matches\n\nEvery StakeTruth pick starts with a **Poisson goal-expectancy model**: we estimate each team\'s expected goals from their recent scoring and conceding rates, then simulate the full range of scorelines to find the highest-probability outcome.\n\n## Learning from our own track record\n\nUnlike a static model, our engine constantly re-weights itself using outcomes from `intelligence_outcomes` — markets and teams that keep hitting get a small confidence boost; those that underperform get dialed back.\n\n## Why we show a confidence score, not a guarantee\n\nFootball is not fully predictable, and we never claim it is. Our confidence score (1-99) reflects the strength of the statistical signal, not a promise. Please gamble responsibly.',
        'How Our Intelligence Engine Predicts Football Matches | StakeTruth', 'A look under the hood at the statistical model behind StakeTruth football predictions.',
        'football prediction algorithm, poisson model football, how football predictions work']
    );
  }

  console.log('[seed_demo] demo content seeded.');
}

if (require.main === module) {
  seedDemo().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seedDemo };
