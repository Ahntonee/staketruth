const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const categories = require('../config/categories');

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
test('editor pages load matching pinned editor styles and script plus icons', () => {
  for (const name of ['seo-pages', 'blog', 'pages']) {
    const html = fs.readFileSync('public/admin/' + name + '.html', 'utf8');
    assert.match(html, /easymde@2\.20\.0\/dist\/easymde.min.css/);
    assert.match(html, /easymde@2\.20\.0\/dist\/easymde.min.js/);
    assert.match(html, /fontawesome-free/);
  }
});
