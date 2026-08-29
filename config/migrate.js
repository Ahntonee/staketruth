require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('user','vip','admin') DEFAULT 'user',
    country VARCHAR(100),
    timezone VARCHAR(50) DEFAULT 'UTC',
    telegram_invited TINYINT(1) DEFAULT 0,
    password_reset_token VARCHAR(255),
    password_reset_expires DATETIME,
    is_banned TINYINT(1) DEFAULT 0,
    is_comment_banned TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS pending_registrations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    country VARCHAR(100),
    token VARCHAR(6) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS leagues (
    id INT PRIMARY KEY AUTO_INCREMENT,
    api_league_id INT UNIQUE,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(100),
    continent VARCHAR(50),
    logo_url VARCHAR(500),
    is_active TINYINT(1) DEFAULT 1,
    is_popular TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    api_team_id INT UNIQUE,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(100),
    logo_url VARCHAR(500),
    goals_scored_total INT DEFAULT 0,
    goals_conceded_total INT DEFAULT 0,
    matches_played INT DEFAULT 0,
    goals_scored_avg DECIMAL(5,2),
    goals_conceded_avg DECIMAL(5,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS historical_fixtures (
    id INT PRIMARY KEY AUTO_INCREMENT,
    api_fixture_id INT UNIQUE,
    league_id INT,
    api_league_id INT,
    season INT,
    home_team VARCHAR(255) NOT NULL,
    away_team VARCHAR(255) NOT NULL,
    api_home_team_id INT,
    api_away_team_id INT,
    match_date DATETIME NOT NULL,
    home_score INT,
    away_score INT,
    home_score_ht INT,
    away_score_ht INT,
    venue VARCHAR(255),
    status VARCHAR(20) DEFAULT 'FT',
    stats JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hf_teams (home_team, away_team),
    INDEX idx_hf_league_season (api_league_id, season),
    INDEX idx_hf_match_date (match_date)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS predictions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(500) UNIQUE,
    league_id INT,
    home_team VARCHAR(255) NOT NULL,
    away_team VARCHAR(255) NOT NULL,
    home_team_logo VARCHAR(500),
    away_team_logo VARCHAR(500),
    match_date DATETIME NOT NULL,
    tip VARCHAR(255) NOT NULL,
    market ENUM('1X2','Over/Under','BTTS','Draw No Bet','Correct Score','Accumulator') DEFAULT '1X2',
    category ENUM('all','free','over_1_5','over_2_5','over_3_5','under_1_5','under_2_5','under_3_5','gg','home_win','away_win','draw','vip','banker') DEFAULT 'free',
    odds DECIMAL(6,2),
    confidence_score INT,
    intelligence_score INT,
    analysis TEXT,
    is_vip TINYINT(1) DEFAULT 0,
    is_banker TINYINT(1) DEFAULT 0,
    is_featured TINYINT(1) DEFAULT 0,
    is_vip_pick_of_day TINYINT(1) DEFAULT 0,
    pushed_to_registered TINYINT(1) DEFAULT 0,
    pushed_at DATETIME,
    voting_disabled TINYINT(1) DEFAULT 0,
    source ENUM('manual','intelligence','auto_sync') DEFAULT 'manual',
    result ENUM('pending','won','lost','void','cancelled') DEFAULT 'pending',
    home_score INT,
    away_score INT,
    home_form VARCHAR(10),
    away_form VARCHAR(10),
    home_form_venue VARCHAR(10),
    away_form_venue VARCHAR(10),
    h2h_summary TEXT,
    home_goals_avg DECIMAL(5,2),
    away_goals_avg DECIMAL(5,2),
    home_goals_conceded_avg DECIMAL(5,2),
    away_goals_conceded_avg DECIMAL(5,2),
    api_fixture_id INT,
    bookies_available JSON,
    is_published TINYINT(1) DEFAULT 1,
    published_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_match_date (match_date),
    INDEX idx_league_id (league_id),
    INDEX idx_result (result),
    INDEX idx_category (category),
    INDEX idx_is_banker (is_banker),
    INDEX idx_is_vip (is_vip),
    INDEX idx_is_vip_pick_of_day (is_vip_pick_of_day),
    INDEX idx_pushed_to_registered (pushed_to_registered),
    INDEX idx_api_fixture_id (api_fixture_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS bookmarks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    prediction_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bookmark (user_id, prediction_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS bet_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    prediction_id INT,
    stake DECIMAL(10,2) NOT NULL,
    odds DECIMAL(6,2),
    result ENUM('won','lost','void') DEFAULT 'void',
    profit_loss DECIMAL(10,2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    prediction_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    is_approved TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS match_votes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    prediction_id INT NOT NULL,
    user_id INT,
    guest_token VARCHAR(64),
    vote_choice ENUM('home','draw','away') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vote_user (prediction_id, user_id),
    UNIQUE KEY uq_vote_guest (prediction_id, guest_token),
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    plan ENUM('monthly','quarterly','annual') NOT NULL,
    status ENUM('active','cancelled','expired','trialing') DEFAULT 'active',
    provider ENUM('paystack','manual') DEFAULT 'paystack',
    provider_subscription_id VARCHAR(255),
    paystack_reference VARCHAR(255),
    amount DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'NGN',
    trial_ends_at DATETIME,
    expires_at DATETIME,
    notified_expiry TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS blog_posts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(500) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    excerpt TEXT,
    content LONGTEXT,
    featured_image LONGTEXT,
    category VARCHAR(100),
    author_name VARCHAR(100),
    meta_title VARCHAR(255),
    meta_description TEXT,
    keywords TEXT,
    is_published TINYINT(1) DEFAULT 0,
    published_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS seo_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    page_key VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255),
    description TEXT,
    keywords TEXT,
    og_image VARCHAR(500),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS static_pages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT,
    extra JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS site_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS site_stat_overrides (
    id INT PRIMARY KEY AUTO_INCREMENT,
    stat_key VARCHAR(100) UNIQUE NOT NULL,
    stat_value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS ad_slots (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slot_name VARCHAR(100) UNIQUE NOT NULL,
    placement ENUM('homepage_top','homepage_sidebar','homepage_infeed','predictions_infeed','prediction_detail_bottom','blog_infeed','blog_post_bottom') NOT NULL,
    ad_client_id VARCHAR(50),
    ad_slot_id VARCHAR(50),
    ad_format VARCHAR(20) DEFAULT 'auto',
    is_enabled TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS announcements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    link_url VARCHAR(500),
    link_label VARCHAR(100),
    is_active TINYINT(1) DEFAULT 1,
    expires_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS prediction_accuracy_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    prediction_id INT UNIQUE NOT NULL,
    market VARCHAR(50),
    category VARCHAR(50),
    league_id INT,
    home_team VARCHAR(255),
    away_team VARCHAR(255),
    tip VARCHAR(255),
    confidence_score INT,
    intelligence_score INT,
    is_correct TINYINT(1),
    source ENUM('manual','intelligence','auto_sync') DEFAULT 'manual',
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS accuracy_stats (
    id INT PRIMARY KEY AUTO_INCREMENT,
    stat_key VARCHAR(100) UNIQUE NOT NULL,
    stat_value DECIMAL(10,4),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS intelligence_outcomes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    prediction_id INT NOT NULL,
    market VARCHAR(50),
    category VARCHAR(50),
    league_id INT,
    api_league_id INT,
    home_team VARCHAR(255),
    away_team VARCHAR(255),
    tip VARCHAR(255),
    confidence_score INT,
    home_goals_avg DECIMAL(5,2),
    away_goals_avg DECIMAL(5,2),
    home_goals_conceded_avg DECIMAL(5,2),
    away_goals_conceded_avg DECIMAL(5,2),
    actual_home_score INT,
    actual_away_score INT,
    is_correct TINYINT(1),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS intelligence_weights (
    id INT PRIMARY KEY AUTO_INCREMENT,
    weight_key VARCHAR(100) UNIQUE NOT NULL,
    weight_value DECIMAL(8,4) NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS team_statistics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    team_name VARCHAR(255) NOT NULL,
    api_team_id INT,
    league_id INT,
    api_league_id INT,
    season INT,
    matches_played INT DEFAULT 0,
    goals_scored INT DEFAULT 0,
    goals_conceded INT DEFAULT 0,
    goals_scored_avg DECIMAL(5,2),
    goals_conceded_avg DECIMAL(5,2),
    wins INT DEFAULT 0,
    draws INT DEFAULT 0,
    losses INT DEFAULT 0,
    clean_sheets INT DEFAULT 0,
    btts_count INT DEFAULT 0,
    over_1_5_count INT DEFAULT 0,
    over_2_5_count INT DEFAULT 0,
    over_3_5_count INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_team_league_season (api_team_id, api_league_id, season)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS league_statistics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    league_id INT,
    api_league_id INT UNIQUE,
    league_name VARCHAR(255),
    season INT,
    matches_played INT DEFAULT 0,
    total_goals INT DEFAULT 0,
    goals_per_game DECIMAL(5,2),
    btts_percentage DECIMAL(5,2),
    over_1_5_percentage DECIMAL(5,2),
    over_2_5_percentage DECIMAL(5,2),
    over_3_5_percentage DECIMAL(5,2),
    home_win_percentage DECIMAL(5,2),
    away_win_percentage DECIMAL(5,2),
    draw_percentage DECIMAL(5,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS prediction_market_stats (
    id INT PRIMARY KEY AUTO_INCREMENT,
    market VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    league_id INT,
    team_name VARCHAR(255),
    total_predictions INT DEFAULT 0,
    correct_predictions INT DEFAULT 0,
    win_rate DECIMAL(5,2),
    avg_confidence DECIMAL(5,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS profitability_stats (
    id INT PRIMARY KEY AUTO_INCREMENT,
    entity_type ENUM('team','league') NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    league_id INT,
    market VARCHAR(50),
    category VARCHAR(50),
    total_tips INT DEFAULT 0,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    units_staked DECIMAL(10,2) DEFAULT 0,
    units_returned DECIMAL(10,2) DEFAULT 0,
    profit_units DECIMAL(10,2) DEFAULT 0,
    roi_percent DECIMAL(6,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_entity_market (entity_type, entity_name, market)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS page_views (
    id INT PRIMARY KEY AUTO_INCREMENT,
    path VARCHAR(500),
    country VARCHAR(100),
    city VARCHAR(100),
    device_type VARCHAR(50),
    referrer VARCHAR(500),
    session_id VARCHAR(64),
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_viewed_at (viewed_at),
    INDEX idx_country (country)
  ) ENGINE=InnoDB`,

  // Partner/reciprocal backlinks shown in the footer's "Other Sites" section.
  // Auto-expire via expires_at rather than a cron delete, so an admin can
  // still see & renew a lapsed link instead of it silently vanishing.
  `CREATE TABLE IF NOT EXISTS backlinks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    duration_days INT NOT NULL DEFAULT 30,
    expires_at DATETIME NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  // Real, publicly-visible SEO landing pages (league/market specific) --
  // shown identically to users and search engines, no cloaking. Content is
  // just an intro/H1; the actual predictions list is pulled live at render
  // time from the `predictions` table filtered by league_id/category.
  `CREATE TABLE IF NOT EXISTS seo_landing_pages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(200) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    meta_description VARCHAR(500),
    h1 VARCHAR(255),
    intro_content TEXT,
    league_id INT,
    category VARCHAR(50),
    is_published TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS league_standings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    league_id INT NOT NULL,
    season INT NOT NULL,
    api_team_id INT,
    team_name VARCHAR(255) NOT NULL,
    team_logo VARCHAR(500),
    \`rank\` INT,
    played INT DEFAULT 0,
    won INT DEFAULT 0,
    drawn INT DEFAULT 0,
    lost INT DEFAULT 0,
    goals_for INT DEFAULT 0,
    goals_against INT DEFAULT 0,
    goal_diff INT DEFAULT 0,
    points INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_league_season_team (league_id, season, team_name),
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  // Admin-curated multi-leg accumulators ("Truth Safe Picks") -- distinct from
  // the auto-scored single predictions table. Legs reference existing
  // predictions so odds/results/grading flow from the underlying pick rather
  // than being duplicated here.
  `CREATE TABLE IF NOT EXISTS accumulators (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    is_published TINYINT(1) DEFAULT 0,
    published_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS accumulator_legs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    accumulator_id INT NOT NULL,
    prediction_id INT NOT NULL,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (accumulator_id) REFERENCES accumulators(id) ON DELETE CASCADE,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_accumulator_prediction (accumulator_id, prediction_id)
  ) ENGINE=InnoDB`,

  // User-facing bet builder -- a personal planning tool (no real transactions).
  // Registered users pick from published predictions to build and save their
  // own combo, same leg-references-a-prediction shape as accumulators above.
  `CREATE TABLE IF NOT EXISTS user_bet_slips (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS user_bet_slip_legs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    slip_id INT NOT NULL,
    prediction_id INT NOT NULL,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (slip_id) REFERENCES user_bet_slips(id) ON DELETE CASCADE,
    FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_slip_prediction (slip_id, prediction_id)
  ) ENGINE=InnoDB`,
];

// NOTE: api_league_id values follow API-Football's well-documented ID scheme.
// Double-check them against GET /leagues on your own API-Football key once
// it's active — they're editable any time afterward from admin/leagues.html
// without needing to touch this file again.
const LEAGUES = [
  // Europe — top flight
  [39, 'Premier League', 'England', 'Europe', 1],
  [140, 'La Liga', 'Spain', 'Europe', 1],
  [135, 'Serie A', 'Italy', 'Europe', 1],
  [78, 'Bundesliga', 'Germany', 'Europe', 1],
  [61, 'Ligue 1', 'France', 'Europe', 1],
  [88, 'Eredivisie', 'Netherlands', 'Europe', 1],
  [94, 'Primeira Liga', 'Portugal', 'Europe', 1],
  [144, 'Jupiler Pro League', 'Belgium', 'Europe', 1],
  [203, 'Süper Lig', 'Turkey', 'Europe', 1],
  [179, 'Premiership', 'Scotland', 'Europe', 1],
  [40, 'Championship', 'England', 'Europe', 0],
  // Europe — continental competitions
  [2, 'UEFA Champions League', 'World', 'Europe', 1],
  [3, 'UEFA Europa League', 'World', 'Europe', 1],
  [848, 'UEFA Europa Conference League', 'World', 'Europe', 0],
  // Africa
  [6, 'Africa Cup of Nations', 'World', 'Africa', 1],
  [233, 'Egyptian Premier League', 'Egypt', 'Africa', 1],
  [288, 'Premier Soccer League', 'South Africa', 'Africa', 1],
  [12, 'CAF Champions League', 'World', 'Africa', 1],
  [20, 'CAF Confederation Cup', 'World', 'Africa', 0],
  // Rest of world
  [253, 'MLS', 'USA', 'North America', 0],
  [71, 'Brasileirao', 'Brazil', 'South America', 0],
  [128, 'Liga Profesional Argentina', 'Argentina', 'South America', 0],
  [323, 'Indian Super League', 'India', 'Asia', 0],
];

const WEIGHTS = [
  ['form_weight', 0.30, 'Weight of recent form in the confidence score'],
  ['h2h_weight', 0.20, 'Weight of head-to-head history'],
  ['odds_weight', 0.20, 'Weight of bookmaker implied probability'],
  ['market_weight', 0.15, 'Weight of market-type reliability coefficient'],
  ['league_weight', 0.15, 'Weight of league-tier reliability'],
  ['home_advantage', 1.15, 'Home advantage multiplier applied to expected goals'],
  ['poisson_k', 6, 'Max goals evaluated in the Poisson score matrix'],
  ['learning_rate', 0.10, 'Bayesian nudge from historical market/category win rate'],
  ['min_confidence_publish', 72, 'Minimum intelligence score for a prediction to be generated'],
  ['auto_publish_threshold', 78, 'Minimum intelligence score for auto-publish'],
  ['team_pattern_weight', 0.10, 'Weight of team-specific tip-type pattern learning'],
  ['vip_pick_threshold', 85, 'Minimum intelligence score to enter VIP Picks of the Day'],
  ['auto_push_threshold', 80, 'Minimum intelligence score for the 00:00 auto-push to registered users'],
];

const SITE_SETTINGS = [
  ['social_twitter', ''],
  ['social_telegram', ''],
  ['social_facebook', ''],
  ['social_reddit', ''],
  ['social_whatsapp', ''],
  ['contact_email', 'support@staketruth.com'],
  ['contact_whatsapp', ''],
  ['odds_api_calls_today', '0'],
  ['last_sync_fixtures', ''],
  ['last_sync_results', ''],
  ['last_auto_push', ''],
];

const SEO_PAGES = [
  ['home', 'StakeTruth — Football Predictions Today | VIP Tips & Banker of the Day', 'Free and VIP football predictions today, backed by a statistical Intelligence Engine. Correct score tips, Over 2.5 goals predictions, BTTS tips, and the daily Banker of the Day pick.', 'football predictions today, football tips today, banker of the day, VIP football tips, correct score predictions, over 2.5 goals predictions, BTTS predictions today, sure football tips'],
  ['predictions', 'Today’s Football Predictions & Betting Tips | StakeTruth', 'Browse today’s free and VIP football predictions by league, market, and confidence score. Updated daily from our Intelligence Engine.', 'football predictions today, best football tips today, VIP predictions, over/under 2.5 tips, BTTS tips today'],
  ['pricing', 'VIP Subscription — Unlock Premium Football Tips | StakeTruth', 'Subscribe to StakeTruth VIP for premium football predictions, banker of the day exclusives, and early access to high-confidence picks.', 'VIP football tips, football prediction subscription, premium betting tips, sure odds today'],
  ['blog', 'Football Betting Insights & Strategy Blog | StakeTruth', 'Expert analysis, betting strategy, and football prediction insights from the StakeTruth team.', 'football betting tips, betting strategy blog, football prediction analysis'],
  ['about', 'About StakeTruth — Data-Driven Football Predictions', 'Learn how StakeTruth’s Intelligence Engine combines statistical modelling and historical data to produce accurate football predictions.', 'about staketruth, football prediction platform, data-driven betting tips'],
  ['statistics', 'Football Statistics & Prediction Track Record | StakeTruth', 'Team and league scoring statistics, market reliability, and StakeTruth’s own prediction track record.', 'football statistics, most reliable betting markets, team goals average, football prediction accuracy'],
];

const STATIC_PAGES = [
  ['home', 'Home', '# Data-Driven Football Predictions You Can Actually Follow\n\nStakeTruth turns raw football data into daily predictions you can act on. Every tip on this site — free or VIP — comes from the same statistical Intelligence Engine, not a tipster\'s gut feeling, so the reasoning behind a pick is always visible in its confidence score and analysis.\n\n## How the Intelligence Engine works\n\nEach prediction starts from a Poisson goal-expectancy model built on both teams\' recent scoring and conceding form, then blends in head-to-head history, market-specific track record, and league-level patterns learned from our own growing database of graded outcomes. The result is a single confidence score from 0-100 that determines whether a pick publishes automatically, gets held for manual review, or gets promoted to a Truthpick of the Day.\n\n## What you get\n\n**Free Predictions** cover a wide spread of markets — over/under goals, BTTS, home/away wins, draws — across leagues worldwide, refreshed daily. **Banker of the Day** is our single highest-conviction pick, chosen for members. **Truthpicks of the Day** are reserved for VIP members: the small handful of predictions each day that clear our highest confidence bar. Every graded prediction, win or loss, is tracked openly on our Leaderboard so our real accuracy is never a mystery.\n\n## Built for how you actually bet\n\nBeyond single tips, our Bet Builder lets you auto-generate a multi-leg accumulator from today\'s highest-confidence picks, or build your own combo pick by pick, complete with a stake calculator and one-tap sharing.\n\n## Responsible gambling\n\nStakeTruth provides statistical analysis for entertainment and informational purposes. Confidence scores reflect the strength of our model, not a guarantee of any outcome. Please gamble responsibly and only wager what you can afford to lose.', null],
  ['about', 'About Us', '# About StakeTruth\n\nStakeTruth combines a real-time football data pipeline with a statistical Intelligence Engine to produce football predictions with a target 80-88% win rate. We publish free daily tips, a Banker of the Day, and a VIP tier with our highest-confidence picks.\n\n## How it works\n\nOur Intelligence Engine blends a Poisson goal-expectancy model with historical outcome learning drawn from our own prediction database, so it gets sharper the longer it runs.\n\n## Responsible gambling\n\nStakeTruth provides statistical analysis for entertainment and informational purposes. Please gamble responsibly.', null],
  ['terms', 'Terms of Service', '# Terms of Service\n\nBy using StakeTruth you agree that all predictions are provided for informational and entertainment purposes only. We do not guarantee outcomes. You are solely responsible for any wagering decisions you make. You must be of legal gambling age in your jurisdiction to use betting-related content on this site.', null],
  ['privacy', 'Privacy Policy', '# Privacy Policy\n\nStakeTruth collects the minimum data necessary to operate your account: name, email, and usage analytics. We never sell your personal data. Payment is processed by Paystack; we do not store card details.', null],
  ['contact', 'Contact Us', '# Contact Us\n\nEmail us at support@staketruth.com for account, subscription, or general enquiries.', null],
];

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.DB_NAME, table, column]
  );
  return rows[0].cnt > 0;
}

async function ensureColumn(table, column, definition) {
  const exists = await columnExists(table, column);
  if (!exists) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migrate] added column ${table}.${column}`);
  }
}

async function migrate() {
  console.log('[migrate] starting…');

  for (const statement of TABLES) {
    await pool.query(statement);
  }
  console.log(`[migrate] ${TABLES.length} tables ensured`);

  // Idempotent column additions for tables that may already exist from an earlier run
  await ensureColumn('predictions', 'is_published', "TINYINT(1) DEFAULT 1");
  await ensureColumn('users', 'is_comment_banned', "TINYINT(1) DEFAULT 0");
  await ensureColumn('ad_slots', 'ad_type', "ENUM('adsense','banner_image','text_link','custom_code') DEFAULT 'adsense'");
  await ensureColumn('ad_slots', 'image_url', "VARCHAR(500)");
  await ensureColumn('ad_slots', 'link_url', "VARCHAR(500)");
  await ensureColumn('ad_slots', 'link_text', "VARCHAR(255)");
  await ensureColumn('ad_slots', 'custom_code', "LONGTEXT");
  // Free-text league filter for SEO landing pages -- replaces the old strict
  // league_id FK filter so an admin can type any topic/league name, not just
  // one already seeded in the leagues table. Matched by LIKE against the
  // predictions' own league name at render time, not by id.
  await ensureColumn('seo_landing_pages', 'league_text_filter', "VARCHAR(255)");
  await ensureColumn('seo_landing_pages', 'meta_keywords', "VARCHAR(500)");

  // Blog post scheduling: when set, the post stays a draft until this
  // moment, at which point the scheduler cron flips is_published to 1.
  await ensureColumn('blog_posts', 'scheduled_publish_at', "DATETIME NULL");

  // Announcements: replaced the original plain is_active flag with a proper
  // draft/published workflow plus a visual type, matching how every other
  // publishable content type in the admin already works (blog posts, SEO
  // pages). is_active is kept and backfilled from status for callers that
  // haven't been updated yet, rather than dropped outright.
  await ensureColumn('announcements', 'status', "ENUM('draft','published') DEFAULT 'draft'");
  await ensureColumn('announcements', 'type', "ENUM('info','success','warning','danger') DEFAULT 'info'");
  await pool.query(`UPDATE announcements SET status = IF(is_active = 1, 'published', 'draft') WHERE status = 'draft' AND is_active = 1`);

  // Seed admin
  const [existingAdmin] = await pool.query('SELECT id FROM users WHERE email = ?', ['admin@staketruth.com']);
  if (existingAdmin.length === 0) {
    const hash = await bcrypt.hash('Admin@ST!', 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`,
      ['StakeTruth Admin', 'admin@staketruth.com', hash]
    );
    console.log('[migrate] seeded admin user admin@staketruth.com / Admin@ST!');
  }

  // Seed leagues. is_popular/is_active are deliberately NOT touched on conflict —
  // they're admin-editable from admin/leagues.html, and this migration re-runs
  // on every server start, so overwriting them here would silently revert any
  // toggle an admin has made. name/country/continent are safe to keep in sync
  // since there's no UI to edit those per-league.
  for (const [apiId, name, country, continent, popular] of LEAGUES) {
    await pool.query(
      `INSERT INTO leagues (api_league_id, name, country, continent, is_popular)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), country = VALUES(country), continent = VALUES(continent)`,
      [apiId, name, country, continent, popular]
    );
  }
  console.log(`[migrate] seeded ${LEAGUES.length} leagues`);

  // Seed intelligence weights
  for (const [key, value, description] of WEIGHTS) {
    await pool.query(
      `INSERT IGNORE INTO intelligence_weights (weight_key, weight_value, description) VALUES (?, ?, ?)`,
      [key, value, description]
    );
  }
  console.log(`[migrate] seeded ${WEIGHTS.length} intelligence weights`);

  // Seed site settings
  for (const [key, value] of SITE_SETTINGS) {
    await pool.query(`INSERT IGNORE INTO site_settings (setting_key, setting_value) VALUES (?, ?)`, [key, value]);
  }

  // Seed SEO settings
  for (const [pageKey, title, description, keywords] of SEO_PAGES) {
    await pool.query(
      `INSERT IGNORE INTO seo_settings (page_key, title, description, keywords) VALUES (?, ?, ?, ?)`,
      [pageKey, title, description, keywords]
    );
  }
  console.log(`[migrate] seeded ${SEO_PAGES.length} SEO pages`);

  // Seed static pages
  for (const [slug, title, content, extra] of STATIC_PAGES) {
    await pool.query(
      `INSERT IGNORE INTO static_pages (slug, title, content, extra) VALUES (?, ?, ?, ?)`,
      [slug, title, content, extra]
    );
  }
  console.log(`[migrate] seeded ${STATIC_PAGES.length} static pages`);

  // Seed ad slots — one disabled row per placement
  const placements = [
    'homepage_top', 'homepage_sidebar', 'homepage_infeed', 'predictions_infeed',
    'prediction_detail_bottom', 'blog_infeed', 'blog_post_bottom',
  ];
  for (const placement of placements) {
    await pool.query(
      `INSERT IGNORE INTO ad_slots (slot_name, placement, is_enabled) VALUES (?, ?, 0)`,
      [placement, placement]
    );
  }
  console.log(`[migrate] seeded ${placements.length} ad slots`);

  console.log('[migrate] complete.');
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}

module.exports = { migrate };
