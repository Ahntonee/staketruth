const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const indexing = require('../services/seoIndexing');
const ssr = require('../services/ssr');

function prediction(overrides = {}) {
  const matchDate = new Date();
  matchDate.setDate(matchDate.getDate() + 1);
  return {
    slug: 'alpha-vs-beta-2026-10-01',
    home_team: 'Alpha',
    away_team: 'Beta',
    league_name: 'Test League',
    match_date: matchDate.toISOString(),
    tip: 'Over 2.5 Goals',
    analysis: 'A'.repeat(220),
    intelligence_score: 82,
    is_published: 1,
    is_vip: 0,
    is_banker: 0,
    ...overrides,
  };
}

test('sitemap output encodes unsafe slug characters and remains valid XML', () => {
  const xml = indexing.urlSet('https://www.staketruth.com/', [{
    path: '/tips/' + indexing.encodePathSegment('Legit home-win & picks'), priority: '0.8',
  }]);
  assert.match(xml, /Legit%20home-win%20%26%20picks/);
  assert.doesNotMatch(xml, /Legit home-win/);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
});

test('only timely, public predictions with substantive analysis are indexable', () => {
  assert.equal(indexing.isIndexablePrediction(prediction()), true);
  assert.equal(indexing.isIndexablePrediction(prediction({ is_vip: 1 })), false);
  assert.equal(indexing.isIndexablePrediction(prediction({ is_banker: 1 })), false);
  assert.equal(indexing.isIndexablePrediction(prediction({ analysis: 'Too short' })), false);
  assert.equal(indexing.isIndexablePrediction(prediction({ is_published: 0 })), false);
});

test('prediction SSR applies the same indexability policy used by the sitemap', () => {
  const template = fs.readFileSync('public/prediction-detail.html', 'utf8');
  const indexable = ssr.renderPredictionPage(template, prediction(), 'guest');
  assert.match(indexable, /<meta name="robots" content="index, follow">/);

  const locked = ssr.renderPredictionPage(template, prediction({ is_vip: 1 }), 'guest');
  assert.match(locked, /<meta name="robots" content="noindex, follow">/);
});

test('blog SSR includes the complete article instead of only its excerpt', () => {
  const template = fs.readFileSync('public/blog-post.html', 'utf8');
  const html = ssr.renderBlogPage(template, {
    slug: 'complete-article', title: 'Complete Article', excerpt: 'Short summary',
    content: '## Match context\n\nThis full analysis must be present in the initial response.',
    author_name: 'StakeTruth Team', published_at: new Date().toISOString(),
  });
  assert.match(html, /Match context/);
  assert.match(html, /This full analysis must be present in the initial response/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
});
