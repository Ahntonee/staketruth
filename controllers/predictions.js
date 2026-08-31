const { pool } = require('../config/db');
const {
  successResponse, errorResponse, asyncHandler, parsePagination, paginate, generatePredictionSlug,
} = require('../utils/helpers');
const accuracy = require('../services/accuracy');
const intelligence = require('../services/intelligence');

function safeParseJSON(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return []; }
}

function getRole(req) {
  return req.user ? req.user.role : 'guest';
}

// The definitive role-based gating rule (Part 10 of the spec).
function getLockReason(row, role) {
  if (role === 'admin' || role === 'vip') return null;
  if (row.is_banker) return role === 'user' ? null : 'guest';
  if (row.is_vip) {
    if (role === 'guest') return 'guest';
    if (role === 'user') return row.pushed_to_registered ? null : 'subscription_required';
  }
  return null; // free content
}

function serializePrediction(row, role) {
  const lockReason = getLockReason(row, role);
  const base = {
    id: row.id,
    slug: row.slug,
    home_team: row.home_team,
    away_team: row.away_team,
    home_team_logo: row.home_team_logo,
    away_team_logo: row.away_team_logo,
    match_date: row.match_date,
    market: row.market,
    category: row.category,
    is_vip: !!row.is_vip,
    is_banker: !!row.is_banker,
    is_featured: !!row.is_featured,
    is_vip_pick_of_day: !!row.is_vip_pick_of_day,
    pushed_to_registered: !!row.pushed_to_registered,
    voting_disabled: !!row.voting_disabled,
    result: row.result,
    home_score: row.home_score,
    away_score: row.away_score,
    bookies_available: safeParseJSON(row.bookies_available),
    league_id: row.league_id,
    league_name: row.league_name || null,
    lockReason,
  };
  if (lockReason) {
    return { ...base, tip: '🔒 Locked', analysis: null, odds: null, intelligence_score: null, confidence_score: null };
  }
  return {
    ...base,
    tip: row.tip,
    analysis: row.analysis,
    odds: row.odds !== null ? Number(row.odds) : null,
    intelligence_score: row.intelligence_score,
    confidence_score: row.confidence_score,
  };
}

const listPredictions = asyncHandler(async (req, res) => {
  const { date, league_id, market, category, vip, result, search, min_confidence, sort } = req.query;
  const { page, limit, offset } = parsePagination(req.query);
  const role = getRole(req);

  const where = ['p.is_published = 1'];
  const params = [];
  if (date === 'today') where.push('DATE(p.match_date) = CURDATE()');
  else if (date === 'yesterday') where.push('DATE(p.match_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)');
  else if (date === 'tomorrow') where.push('DATE(p.match_date) = DATE_ADD(CURDATE(), INTERVAL 1 DAY)');
  if (league_id) { where.push('p.league_id = ?'); params.push(league_id); }
  if (market) { where.push('p.market = ?'); params.push(market); }
  // 'free' isn't a real category the scoring pipeline ever assigns (predictions
  // get tagged by their actual market -- over_1_5, home_win, etc. -- or 'vip'
  // once they clear the VIP threshold), so filtering on the literal string
  // always returned nothing. "Free" means what a visitor actually expects:
  // everything that isn't VIP-gated.
  if (category === 'free') where.push("p.is_vip = 0 AND p.category != 'banker'");
  else if (category && category !== 'all') { where.push('p.category = ?'); params.push(category); }
  if (vip === 'true') where.push('p.is_vip = 1');
  if (result) { where.push('p.result = ?'); params.push(result); }
  if (search) { where.push('(p.home_team LIKE ? OR p.away_team LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (min_confidence) { where.push('p.intelligence_score >= ?'); params.push(Number(min_confidence)); }

  const whereSql = where.join(' AND ');
  const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM predictions p WHERE ${whereSql}`, params);
  // Pending picks first (soonest kickoff first, since those are what a visitor
  // actually wants to act on), already-settled won/lost results after (most
  // recently played first) -- a plain match_date sort let an early finished
  // match outrank later still-pending ones just because it kicked off first.
  // sort=confidence overrides this for callers that specifically want the
  // strongest picks first regardless of kickoff time (e.g. Bet Builder's
  // Auto-Generate, which is asking for "the best N picks", not "what's next").
  const orderSql = sort === 'confidence'
    ? 'p.intelligence_score DESC'
    : `(p.result = 'pending') DESC,
       CASE WHEN p.result = 'pending' THEN p.match_date END ASC,
       CASE WHEN p.result != 'pending' THEN p.match_date END DESC`;
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, rows.map((r) => serializePrediction(r, role)), paginate(countRows[0].cnt, page, limit));
});

const getStats = asyncHandler(async (req, res) => {
  const [overrides] = await pool.query('SELECT stat_key, stat_value FROM site_stat_overrides');
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.stat_key, o.stat_value]));
  const [accRows] = await pool.query('SELECT stat_key, stat_value FROM accuracy_stats');
  const accMap = Object.fromEntries(accRows.map((o) => [o.stat_key, o.stat_value]));
  const [[tipsToday]] = await pool.query("SELECT COUNT(*) AS cnt FROM predictions WHERE is_published = 1 AND DATE(match_date) = CURDATE()");
  const [[leagueCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM leagues WHERE is_active = 1');

  return successResponse(res, {
    win_rate: overrideMap.win_rate || accMap.win_rate || '0.0',
    vip_win_rate: overrideMap.vip_win_rate || accMap.vip_win_rate || '0.0',
    tips_today: tipsToday.cnt,
    leagues_covered: leagueCount.cnt,
  });
});

const getBankers = asyncHandler(async (req, res) => {
  const role = getRole(req);
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.is_banker = 1 AND p.is_published = 1 AND DATE(p.match_date) = CURDATE()
     ORDER BY p.intelligence_score DESC LIMIT 2`
  );
  return successResponse(res, rows.map((r) => serializePrediction(r, role)));
});

const getVipPicksOfDay = asyncHandler(async (req, res) => {
  const role = getRole(req);
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.is_vip_pick_of_day = 1 AND p.is_published = 1 AND DATE(p.match_date) = CURDATE()
     ORDER BY p.intelligence_score DESC LIMIT 5`
  );
  return successResponse(res, rows.map((r) => serializePrediction(r, role)));
});

const getRecentWins = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);
  const [rows] = await pool.query(
    `SELECT id, slug, home_team, away_team, tip, market, odds, match_date, home_score, away_score
     FROM predictions WHERE result = 'won' ORDER BY match_date DESC LIMIT ?`,
    [limit]
  );
  return successResponse(res, rows);
});

const getFeatured = asyncHandler(async (req, res) => {
  const role = getRole(req);
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.is_featured = 1 AND p.is_published = 1 ORDER BY p.match_date DESC LIMIT 10`
  );
  return successResponse(res, rows.map((r) => serializePrediction(r, role)));
});

const getBySlug = asyncHandler(async (req, res) => {
  const role = getRole(req);
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id WHERE p.slug = ?`,
    [req.params.slug]
  );
  if (!rows.length) return errorResponse(res, 'Prediction not found', 404);
  return successResponse(res, serializePrediction(rows[0], role));
});

// ---- Votes ---------------------------------------------------------------

const getVotes = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT vote_choice, COUNT(*) AS cnt FROM match_votes WHERE prediction_id = ? GROUP BY vote_choice',
    [req.params.id]
  );
  const counts = { home: 0, draw: 0, away: 0 };
  rows.forEach((r) => { counts[r.vote_choice] = r.cnt; });
  const total = counts.home + counts.draw + counts.away;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  let myVote = null;
  if (req.user) {
    const [mine] = await pool.query('SELECT vote_choice FROM match_votes WHERE prediction_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    myVote = mine[0]?.vote_choice || null;
  } else if (req.guestToken) {
    const [mine] = await pool.query('SELECT vote_choice FROM match_votes WHERE prediction_id = ? AND guest_token = ?', [req.params.id, req.guestToken]);
    myVote = mine[0]?.vote_choice || null;
  }

  return successResponse(res, { home: pct(counts.home), draw: pct(counts.draw), away: pct(counts.away), total, myVote });
});

const castVote = asyncHandler(async (req, res) => {
  const [predRows] = await pool.query('SELECT voting_disabled FROM predictions WHERE id = ?', [req.params.id]);
  if (!predRows.length) return errorResponse(res, 'Prediction not found', 404);
  if (predRows[0].voting_disabled) return errorResponse(res, 'Voting is disabled for this match', 403);

  try {
    await pool.query(
      'INSERT INTO match_votes (prediction_id, user_id, guest_token, vote_choice) VALUES (?, ?, ?, ?)',
      [req.params.id, req.user ? req.user.id : null, req.user ? null : req.guestToken, req.body.choice]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return errorResponse(res, 'You have already voted on this match', 409);
    throw err;
  }
  return successResponse(res, { message: 'Vote recorded' }, undefined, 201);
});

// ---- Admin CRUD -----------------------------------------------------------

const ALLOWED_FIELDS = [
  'league_id', 'home_team', 'away_team', 'home_team_logo', 'away_team_logo', 'match_date', 'tip',
  'market', 'category', 'odds', 'confidence_score', 'intelligence_score', 'analysis',
  'is_vip', 'is_banker', 'is_featured', 'is_vip_pick_of_day',
];

const createPrediction = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.is_banker) {
    const [[cnt]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM predictions WHERE is_banker = 1 AND DATE(match_date) = DATE(?)',
      [b.match_date]
    );
    if (cnt.cnt >= 2) return errorResponse(res, 'Maximum 2 Banker of the Day predictions per day', 400);
  }
  const slug = generatePredictionSlug(b.home_team, b.away_team, b.match_date);
  const [result] = await pool.query(
    `INSERT INTO predictions
     (slug, league_id, home_team, away_team, match_date, tip, market, category, odds, confidence_score,
      analysis, is_vip, is_banker, is_featured, is_vip_pick_of_day, bookies_available, source, is_published, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, NOW())`,
    [slug, b.league_id || null, b.home_team, b.away_team, b.match_date, b.tip, b.market || '1X2',
      b.category || 'free', b.odds || null, b.confidence_score || null, b.analysis || null,
      b.is_vip ? 1 : 0, b.is_banker ? 1 : 0, b.is_featured ? 1 : 0, b.is_vip_pick_of_day ? 1 : 0,
      b.bookies_available ? JSON.stringify(b.bookies_available) : null]
  );
  return successResponse(res, { id: result.insertId, slug }, undefined, 201);
});

const updatePrediction = asyncHandler(async (req, res) => {
  const fields = Object.keys(req.body).filter((k) => ALLOWED_FIELDS.includes(k));
  if (!fields.length) return errorResponse(res, 'No valid fields to update', 400);
  const setSql = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]));
  await pool.query(`UPDATE predictions SET ${setSql} WHERE id = ?`, [...values, req.params.id]);
  return successResponse(res, { message: 'Prediction updated' });
});

const deletePrediction = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM predictions WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Prediction deleted' });
});

const setResult = asyncHandler(async (req, res) => {
  const { result, home_score, away_score } = req.body;
  await pool.query('UPDATE predictions SET result = ?, home_score = ?, away_score = ? WHERE id = ?', [
    result, home_score ?? null, away_score ?? null, req.params.id,
  ]);
  if (result === 'won' || result === 'lost') await accuracy.logUntracked();
  return successResponse(res, { message: 'Result updated' });
});

const togglePublish = asyncHandler(async (req, res) => {
  await pool.query('UPDATE predictions SET is_published = ?, published_at = IF(? = 1, NOW(), published_at) WHERE id = ?', [
    req.body.is_published ? 1 : 0, req.body.is_published ? 1 : 0, req.params.id,
  ]);
  return successResponse(res, { message: 'Publish state updated' });
});

const toggleBanker = asyncHandler(async (req, res) => {
  if (req.body.is_banker) {
    const [[pred]] = await pool.query('SELECT match_date FROM predictions WHERE id = ?', [req.params.id]);
    const [[cnt]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM predictions WHERE is_banker = 1 AND DATE(match_date) = DATE(?) AND id != ?',
      [pred.match_date, req.params.id]
    );
    if (cnt.cnt >= 2) return errorResponse(res, 'Maximum 2 Banker of the Day predictions per day', 400);
  }
  await pool.query('UPDATE predictions SET is_banker = ? WHERE id = ?', [req.body.is_banker ? 1 : 0, req.params.id]);
  return successResponse(res, { message: 'Banker status updated' });
});

const changeCategory = asyncHandler(async (req, res) => {
  await pool.query('UPDATE predictions SET category = ? WHERE id = ?', [req.body.category, req.params.id]);
  return successResponse(res, { message: 'Category updated' });
});

const togglePush = asyncHandler(async (req, res) => {
  await pool.query('UPDATE predictions SET pushed_to_registered = ?, pushed_at = IF(? = 1, NOW(), pushed_at) WHERE id = ?', [
    req.body.pushed_to_registered ? 1 : 0, req.body.pushed_to_registered ? 1 : 0, req.params.id,
  ]);
  return successResponse(res, { message: 'Push state updated' });
});

const resetVotes = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM match_votes WHERE prediction_id = ?', [req.params.id]);
  return successResponse(res, { message: 'Votes reset' });
});

const toggleVoting = asyncHandler(async (req, res) => {
  await pool.query('UPDATE predictions SET voting_disabled = ? WHERE id = ?', [req.body.voting_disabled ? 1 : 0, req.params.id]);
  return successResponse(res, { message: 'Voting state updated' });
});

function idsClause(ids) {
  return { placeholders: ids.map(() => '?').join(','), values: ids };
}

// Guards the same PUBLISHED_CAP the Intelligence Engine's auto-publish path
// respects (see services/intelligence.js) -- room is counted against
// everything published OUTSIDE this selection, then reclaimed from already-
// graded published picks outside the selection if needed, before allowing
// the batch through. Never exceeds the cap, even for IDs already published
// within the same selection (those don't cost a new slot).
const bulkPublish = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return errorResponse(res, 'ids array is required', 400);
  const { placeholders, values } = idsClause(ids);

  const [[{ alreadyPublished }]] = await pool.query(
    `SELECT COUNT(*) AS alreadyPublished FROM predictions WHERE id IN (${placeholders}) AND is_published = 1`, values
  );
  const newPublishCount = ids.length - alreadyPublished;
  if (newPublishCount > 0) {
    // Cap only counts/reclaims predictions published at/after the cutover --
    // see intelligence.getPublishCapCutover for why the pre-existing legacy
    // backlog is intentionally excluded from this accounting.
    const cutover = await intelligence.getPublishCapCutover();
    const [[{ outsideTotal }]] = await pool.query(
      `SELECT COUNT(*) AS outsideTotal FROM predictions WHERE is_published = 1 AND published_at >= ? AND id NOT IN (${placeholders})`, [cutover, ...values]
    );
    let room = intelligence.PUBLISHED_CAP - outsideTotal;
    if (newPublishCount > room && room < intelligence.PUBLISHED_CAP) {
      await pool.query(
        `UPDATE predictions SET is_published = 0
         WHERE is_published = 1 AND result != 'pending' AND published_at >= ? AND id NOT IN (${placeholders})
         ORDER BY match_date ASC LIMIT ?`,
        [cutover, ...values, Math.max(newPublishCount - room, 0)]
      );
      const [[{ outsideTotal: outsideTotal2 }]] = await pool.query(
        `SELECT COUNT(*) AS outsideTotal FROM predictions WHERE is_published = 1 AND published_at >= ? AND id NOT IN (${placeholders})`, [cutover, ...values]
      );
      room = intelligence.PUBLISHED_CAP - outsideTotal2;
    }
    if (newPublishCount > room) {
      return errorResponse(res, `Can only publish ${Math.max(room, 0)} more right now -- the published cap (${intelligence.PUBLISHED_CAP}) is full of still-pending picks. Wait for more to be graded, or unpublish some manually.`, 409);
    }
  }
  await pool.query(`UPDATE predictions SET is_published = 1, published_at = NOW() WHERE id IN (${placeholders})`, values);
  return successResponse(res, { updated: ids.length });
});

const bulkUnpublish = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return errorResponse(res, 'ids array is required', 400);
  const { placeholders, values } = idsClause(ids);
  await pool.query(`UPDATE predictions SET is_published = 0 WHERE id IN (${placeholders})`, values);
  return successResponse(res, { updated: ids.length });
});

const bulkDelete = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return errorResponse(res, 'ids array is required', 400);
  const { placeholders, values } = idsClause(ids);
  await pool.query(`DELETE FROM predictions WHERE id IN (${placeholders})`, values);
  return successResponse(res, { deleted: ids.length });
});

const bulkPush = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return errorResponse(res, 'ids array is required', 400);
  const { placeholders, values } = idsClause(ids);
  await pool.query(`UPDATE predictions SET pushed_to_registered = 1, pushed_at = NOW() WHERE id IN (${placeholders})`, values);
  return successResponse(res, { updated: ids.length });
});

// Admin list — sees every field, unredacted, with extra filters
const adminListPredictions = asyncHandler(async (req, res) => {
  const { date, league_id, category, result, source, vip, banker, pushed, search, market, visibility, min_confidence } = req.query;
  const { page, limit, offset } = parsePagination(req.query, 25, 200);
  const where = ['1=1'];
  const params = [];
  if (date) { where.push('DATE(p.match_date) = ?'); params.push(date); }
  if (league_id) { where.push('p.league_id = ?'); params.push(league_id); }
  if (category) { where.push('p.category = ?'); params.push(category); }
  if (result) { where.push('p.result = ?'); params.push(result); }
  if (source) { where.push('p.source = ?'); params.push(source); }
  if (market) { where.push('p.market = ?'); params.push(market); }
  if (min_confidence) { where.push('p.intelligence_score >= ?'); params.push(Number(min_confidence)); }
  // visibility is a display-tier concept layered on top of is_vip/is_banker,
  // not a stored column -- "free" means neither flag is set.
  if (visibility === 'vip') where.push('p.is_vip = 1');
  else if (visibility === 'banker') where.push('p.is_banker = 1');
  else if (visibility === 'free') where.push('p.is_vip = 0 AND p.is_banker = 0');
  if (vip === 'true') where.push('p.is_vip = 1');
  if (banker === 'true') where.push('p.is_banker = 1');
  if (pushed === 'true') where.push('p.pushed_to_registered = 1');
  if (search) { where.push('(p.home_team LIKE ? OR p.away_team LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const whereSql = where.join(' AND ');

  const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM predictions p WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT p.*, l.name AS league_name FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE ${whereSql} ORDER BY p.match_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, rows, paginate(countRows[0].cnt, page, limit));
});

module.exports = {
  listPredictions, getStats, getBankers, getVipPicksOfDay, getRecentWins, getFeatured, getBySlug,
  getVotes, castVote,
  createPrediction, updatePrediction, deletePrediction, setResult, togglePublish, toggleBanker,
  changeCategory, togglePush, resetVotes, toggleVoting,
  bulkPublish, bulkUnpublish, bulkDelete, bulkPush, adminListPredictions,
  serializePrediction, getLockReason,
};
