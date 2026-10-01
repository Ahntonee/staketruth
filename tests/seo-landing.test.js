const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('a failed SEO page API request preserves the server-rendered article', async () => {
  const html = fs.readFileSync('public/seo-landing.html', 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/)[1];
  const article = {
    innerHTML: '<h1>Over 1.5 Betting Tips</h1><div class="article-content"><p>Article text</p></div>',
    querySelector: (selector) => selector === 'h1' ? {} : null,
  };
  const predictions = { innerHTML: '<div class="skeleton"></div>' };
  const context = {
    window: { location: { pathname: '/tips/over-15-betting-tips' } },
    document: { getElementById: (id) => id === 'page-container' ? article : predictions },
    ST: { api: async () => { throw new Error('blocked by robots.txt'); } },
  };
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(article.innerHTML, /Over 1\.5 Betting Tips/);
  assert.doesNotMatch(article.innerHTML, /could not be found/i);
  assert.equal(predictions.innerHTML, '');
});

test('only published SEO articles are public and sitemap-visible', () => {
  const controller = fs.readFileSync('controllers/seoPages.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  const admin = fs.readFileSync('public/admin/seo-pages.html', 'utf8');
  assert.match(controller, /sp\.slug = \? AND sp\.is_published = 1/);
  assert.match(server, /seo_landing_pages WHERE is_published = 1/);
  assert.doesNotMatch(controller + server + admin, /is_search_only|Search only/);
  assert.match(admin, /Published — crawlable/);
  assert.match(admin, /Draft — private/);
});
