const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const format = require('../public/js/announcement-format');

test('announcement formatting supports emphasis, lists, links and paragraphs', () => {
  const html = format.render('**Welcome**\n*News*\n- First\n- Second\n[Visit](https://example.com)');
  assert.match(html, /<strong>Welcome<\/strong>/);
  assert.match(html, /<em>News<\/em>/);
  assert.match(html, /<ul><li>First<\/li><li>Second<\/li><\/ul>/);
  assert.match(html, /href="https:\/\/example.com"/);
});
test('announcement formatting escapes raw HTML and rejects executable links', () => {
  const html = format.render('<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n[quote](https://example.com/"onmouseover="x)');
  assert.doesNotMatch(html, /<img|href="javascript:|href="https:\/\/example.com\/"/);
  assert.match(html, /&lt;img/);
});
function harness(fetch) {
  const stored = new Map();
  let calls = 0;
  const pool = { query: async (sql, args) => {
    if (sql.startsWith('SELECT')) return [stored.has(args[0]) ? [{ setting_value: stored.get(args[0]) }] : []];
    stored.set(args[0], args[1]); return [{}];
  }};
  const context = { module: { exports: {} }, process: { env: { API_FOOTBALL_SEASON: '2026' } }, console: { error() {} },
    require: name => name.includes('config/db') ? {pool} : {fetchPublicTable: async (...args) => { calls++; return fetch(...args); }} };
  vm.runInNewContext(fs.readFileSync('services/leagueTables.js','utf8'),context);
  return {api: context.module.exports, stored, calls: () => calls};
}
const player = (name, league, goals, assists) => ({player:{name},statistics:[{league:{id:league},team:{name:'Team'},goals:{total:goals,assists}}]});
test('player tables filter by league and rank by requested statistic', () => {
  const h = harness(() => []);
  const rows=h.api.normalize([player('A',39,9,2),player('B',39,3,5),player('C',140,20,10)],39,'assists');
  assert.equal(rows.length,2); assert.equal(rows[0].name,'B'); assert.equal(rows[0].value,5);
});
test('concurrent table requests share a provider call and subsequent calls use cache', async () => {
  const h=harness(() => [player('A',39,9,2)]);
  const results=await Promise.all([h.api.getTable('39','scorers'),h.api.getTable('39','scorers')]);
  assert.equal(results[0].rows.length,1);
  await h.api.getTable('39','scorers'); assert.equal(h.calls(),1); assert.equal(h.stored.size,1);
});
test('provider failure preserves last known table and backs off retries', async () => {
  const h=harness(() => {throw new Error('offline');});
  h.stored.set('public_table_39_2026_standings', JSON.stringify({rows:[{name:'A'}],updatedAt:'2026-01-01T00:00:00Z',season:2026}));
  const result=await h.api.getTable('39','standings');assert.equal(result.stale,true);assert.equal(result.rows.length,1);
  await h.api.getTable('39','standings');assert.equal(h.calls(),1);
});
test('unknown leagues and table types cannot trigger provider calls', () => {
  const h=harness(() => []);
  assert.throws(()=>h.api.getTable('999','standings'));
  assert.throws(()=>h.api.getTable('39','__proto__'));
  assert.equal(h.calls(),0);
});
