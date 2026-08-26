// Server-side rendering helpers for the dynamic detail-page templates
// (/prediction/:slug, /blog/:slug, /topic/:slug). These pages used to be
// served as a static HTML shell with all real content -- title, meta
// description, canonical URL, structured data, and the visible body --
// injected client-side after a fetch completed. A crawler (or any tool that
// doesn't run JS, including some AI answer engines) saw an empty, generic
// page, and the canonical tag defaulted to the homepage until JS corrected
// it -- actively telling search engines every one of these pages was a
// duplicate of the homepage rather than distinct content worth indexing.
//
// These functions inject the same information server-side so the page is
// fully meaningful on arrival. The client-side JS in each page still runs
// afterward and re-renders the same content for full interactivity (vote
// polls, bookmarks, comments) -- this is a progressive-enhancement layer,
// not a replacement for it.

const { getLockReason } = require('../controllers/predictions');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function confidenceLabel(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return 'High confidence';
  if (score >= 60) return 'Medium confidence';
  if (score >= 40) return 'Low confidence';
  return 'Very low confidence';
}

function injectHead(html, { title, description, canonical, jsonLd, ogImage }) {
  let out = html
    .replace(/<title id="page-title">[^<]*<\/title>/, `<title id="page-title">${escapeHtml(title)}</title>`)
    .replace(/(<meta id="meta-description" name="description" content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
    .replace(/(<link rel="canonical" id="canonical-link" href=")[^"]*(")/, `$1${canonical}$2`)
    .replace(/(<meta id="og-title" property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)}$2`);
  if (jsonLd) out = out.replace('</head>', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head>`);
  return out;
}

function renderPredictionPage(html, p, role) {
  const lockReason = getLockReason(p, role);
  const title = `${p.home_team} vs ${p.away_team} Prediction — ${lockReason ? 'VIP Pick' : p.tip} | StakeTruth`;
  const description = `StakeTruth prediction for ${p.home_team} vs ${p.away_team}: ${lockReason ? 'full analysis available to VIP members.' : (p.analysis || p.tip)}`;
  const canonical = `${process.env.SITE_URL}/prediction/${p.slug}`;

  let out = injectHead(html, {
    title, description, canonical,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'SportsEvent',
      name: `${p.home_team} vs ${p.away_team}`, startDate: new Date(p.match_date).toISOString(),
      homeTeam: { '@type': 'SportsTeam', name: p.home_team },
      awayTeam: { '@type': 'SportsTeam', name: p.away_team },
    },
  });

  const label = confidenceLabel(p.intelligence_score);
  const body = lockReason
    ? `<div class="card card-pad text-center" style="padding:24px 0;">
        <span class="material-icons-round" style="font-size:2.2rem;color:var(--primary);">lock</span>
        <p style="font-weight:700;margin-top:8px;">${lockReason === 'guest' ? 'Sign up free to view this pick.' : 'Upgrade to VIP to view this pick, the full analysis, and live odds.'}</p>
      </div>`
    : `<div class="card card-pad">
        <div class="prediction-card__league"><span>${escapeHtml(p.league_name || 'Football')}</span></div>
        <div class="prediction-card__teams" style="margin:16px 0;">
          <div class="prediction-card__team"><span>${escapeHtml(p.home_team)}</span></div>
          <div class="prediction-card__vs">VS</div>
          <div class="prediction-card__team"><span>${escapeHtml(p.away_team)}</span></div>
        </div>
        <div class="prediction-card__tip" style="font-size:1.4rem;">${escapeHtml(p.tip)}</div>
        ${label ? `<p class="text-soft">${label}${p.intelligence_score != null ? ` (${p.intelligence_score}/100)` : ''}</p>` : ''}
        ${p.odds ? `<p>Odds: ${escapeHtml(p.odds)}</p>` : ''}
        ${p.analysis ? `<p>${escapeHtml(p.analysis)}</p>` : ''}
      </div>`;

  out = out.replace(
    '<div id="detail-container"><div class="skeleton" style="height:320px;border-radius:14px;"></div></div>',
    `<div id="detail-container">${body}</div>`
  );
  out = out.replace('<span id="breadcrumb-current">Match</span>', `<span id="breadcrumb-current">${escapeHtml(p.home_team + ' vs ' + p.away_team)}</span>`);
  return out;
}

function renderBlogPage(html, post) {
  const title = `${post.meta_title || post.title} | StakeTruth Blog`;
  const description = post.meta_description || (post.excerpt || '').slice(0, 160);
  const canonical = `${process.env.SITE_URL}/blog/${post.slug}`;

  let out = injectHead(html, {
    title, description, canonical,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: post.title, datePublished: post.published_at, author: { '@type': 'Person', name: post.author_name || 'StakeTruth Team' },
    },
  });

  const body = `<article>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="text-soft">By ${escapeHtml(post.author_name || 'StakeTruth Team')}</p>
    ${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ''}
  </article>`;

  out = out.replace(
    '<div id="post-container"><div class="skeleton" style="height:400px;border-radius:14px;"></div></div>',
    `<div id="post-container">${body}</div>`
  );
  return out;
}

function renderTopicPage(html, page) {
  const title = page.title;
  const description = page.meta_description || '';
  const canonical = `${process.env.SITE_URL}/topic/${page.slug}`;

  let out = injectHead(html, { title, description, canonical });
  out = out.replace('<span id="breadcrumb-current">Predictions</span>', `<span id="breadcrumb-current">${escapeHtml(page.h1 || page.title)}</span>`);
  const body = `<h1>${escapeHtml(page.h1 || page.title)}</h1>`;
  out = out.replace(
    '<div id="page-container"><div class="skeleton" style="height:200px;border-radius:14px;"></div></div>',
    `<div id="page-container">${body}</div>`
  );
  return out;
}

module.exports = { renderPredictionPage, renderBlogPage, renderTopicPage };
