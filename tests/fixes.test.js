const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const categories = require('../config/categories');
const { PLANS } = require('../services/plans');

function newsletter(result) {
  const queries = [];
  let sends = 0;
  const pool = { query: async (sql, args) => {
    queries.push({ sql, args });
    return sql.startsWith('SELECT') ? [[{ id: 1, name: 'Test', email: 'test@example.com' }]] : [{}];
  }};
  const context = { module: { exports: {} }, console: { log() {}, error() {} }, setTimeout: fn => fn(),
    require: name => name.includes('config/db') ? { pool } : { sendAnnouncementEmail: async () => { sends++; return result; } } };
  vm.runInNewContext(fs.readFileSync('services/newsletter.js', 'utf8'), context);
  return { api: context.module.exports, queries, sends: () => sends };
}

test('announcements include all registered accounts and narrow VIP audience', async () => {
  const n = newsletter({ sent: true });
  await n.api.getRecipients('registered');
  assert.doesNotMatch(n.queries[0].sql, /newsletter_subscribed|role IN/);
  await n.api.getRecipients('vip');
  assert.match(n.queries[1].sql, /role IN/);
});
for (const result of [{ error: 'provider rejected' }, { skipped: true }]) {
  test('failed or skipped email is not marked sent: ' + JSON.stringify(result), async () => {
    const n = newsletter(result);
    const summary = await n.api.sendAnnouncementNewsletter({ id: 1, audience: 'all' });
    assert.equal(summary.sent, 0);
    assert.equal(summary.failed, 1);
    assert.ok(!n.queries.some(q => q.sql.includes('email_sent_at = NOW()')));
    assert.match(n.queries.find(q => q.sql.includes('email_error')).args[0], /1 of 1 emails failed/);
  });
}
test('successful delivery records completion and coalesces concurrent sends', async () => {
  const n = newsletter({ sent: true });
  const a = { id: 1, audience: 'all' };
  await Promise.all([n.api.sendAnnouncementNewsletter(a), n.api.sendAnnouncementNewsletter(a)]);
  assert.equal(n.sends(), 1);
  assert.ok(n.queries.some(q => q.sql.includes('email_sent_at = NOW()')));
});
test('every category has a crawlable link on both prediction lists', () => {
  for (const file of ['public/index.html', 'public/predictions.html']) {
    const html = fs.readFileSync(file, 'utf8');
    for (const key of Object.keys(categories)) assert.ok(html.includes('href="/topic/' + key.replace(/_/g, '-') + '-predictions"'), key);
  }
});
test('Gold and Diamond pricing buttons match configured prices and durations', () => {
  const html = fs.readFileSync('public/pricing.html', 'utf8');
  const buttons = [...html.matchAll(/data-plan="([^"]+)" data-amount="(\d+)"/g)];
  const expected = [
    ['gold_biweekly', 9000, 14],
    ['gold_monthly', 15000, 30],
    ['diamond_biweekly', 10000, 14],
    ['diamond_monthly', 18500, 30],
  ];
  assert.equal(buttons.length, 5);
  expected.forEach(([plan, amount, days], index) => {
    assert.equal(buttons[index][1], plan);
    assert.equal(Number(buttons[index][2]), amount);
    assert.equal(PLANS[plan].amount, amount);
    assert.equal(PLANS[plan].days, days);
  });
  assert.equal(buttons[4][1], 'diamond_monthly');
  assert.match(html, /Accuracy figures are targets, not guarantees/);
  assert.doesNotMatch(html, /researched and analyzed to help you make more informed betting decisions/);
  assert.match(html, /new PaystackPop\(\)/);
  assert.match(html, /\.newTransaction\(/);
  assert.match(html, /onSuccess:/);
  assert.doesNotMatch(html, /PaystackPop\.setup|openIframe\(/);
});
test('shared tips use compact corners and homepage rails remain sticky', () => {
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  const home = fs.readFileSync('public/index.html', 'utf8');
  assert.match(css, /\.category-tab\s*\{[^}]*border-radius:\s*10px/s);
  assert.match(home, /class="home-left-aside"/);
  assert.match(home, /\.home-left-aside\s*\{[^}]*position:\s*sticky/s);
  assert.match(home, /class="hero home-hero"/);
  assert.match(home, /class="home-primary-section"/);
});
test('checkout and ad providers are allowed and per-slot AdSense can load itself', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  assert.match(server, /https:\/\/\*\.paystack\.co/);
  assert.match(server, /https:\/\/\*\.paystack\.com/);
  assert.match(server, /https:\/\/\*\.googlesyndication\.com/);
  assert.match(server, /https:\/\/\*\.ftd\.agency/);
  assert.match(app, /function ensureAdSenseScript/);
  assert.match(app, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=/);
});
test('Site Pages unifies core content, on-page SEO and landing articles', () => {
  const admin = fs.readFileSync('public/admin/pages.html', 'utf8');
  const adminJs = fs.readFileSync('public/js/admin.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  const pageSeo = fs.readFileSync('services/pageSeo.js', 'utf8');
  assert.match(admin, /<h1[^>]*>Site Pages<\/h1>/);
  for (const label of ['Home (SEO)', 'About Us', 'Terms of Service', 'Privacy Policy', 'Contact Us', 'Subscription']) assert.match(admin, new RegExp(label.replace(/[()]/g, '\\$&')));
  assert.match(admin, /AD\.api\('\/pages\/seo'\)/);
  assert.match(admin, /AD\.api\('\/seo-pages\/admin\/list'\)/);
  assert.match(admin, /new EasyMDE/);
  assert.match(admin, /Page Content/);
  assert.match(adminJs, /label: 'Site Pages'/);
  assert.doesNotMatch(adminJs, /label: 'SEO Pages'|label: 'SEO'/);
  for (const key of ['terms', 'privacy', 'contact']) {
    assert.match(pageSeo, new RegExp(key + ": '" + key + "\\.html'"));
    assert.match(server, new RegExp("'/" + key + "\\.html'"));
  }
});
test('Subscription managed article is displayed when Site Pages content exists', () => {
  const pricing = fs.readFileSync('public/pricing.html', 'utf8');
  const migration = fs.readFileSync('config/migrate.js', 'utf8');
  assert.match(pricing, /id="pricing-managed-content"/);
  assert.match(pricing, /ST\.api\('\/pages\/pricing'\)/);
  assert.match(migration, /\['pricing', 'Subscription', '', null\]/);
});
test('editor pages load matching pinned editor styles and script plus icons', () => {
  for (const name of ['seo-pages', 'blog', 'pages']) {
    const html = fs.readFileSync('public/admin/' + name + '.html', 'utf8');
    assert.match(html, /easymde@2\.20\.0\/dist\/easymde.min.css/);
    assert.match(html, /easymde@2\.20\.0\/dist\/easymde.min.js/);
    assert.match(html, /fontawesome-free/);
  }
});
