const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const seo = require('../services/pageSeo');
for (const key of ['home', 'predictions', 'bet-builder', 'pricing', 'blog']) {
  test(key + ': heading, introduction and all metadata appear in served HTML', () => {
    const html = fs.readFileSync('public/' + seo.pages[key], 'utf8');
    const result = seo.render(html, {title:'Unique $& title',h1:'Unique <heading>',intro:'Intro & keywords\nSecond line',description:'Unique description',keywords:'unique, football',og_title:'Sharing title',og_description:'Sharing description',og_image:'https://example.com/image.png',canonical_url:'https://example.com/' + key,robots:'noindex, follow'});
    assert.ok(result.includes('<title>Unique $&amp; title</title>'));
    assert.ok(result.includes('<span data-seo-heading>Unique &lt;heading&gt;</span>'));
    assert.ok(result.includes('Intro &amp; keywords<br>Second line'));
    assert.ok(result.includes('name="keywords" content="unique, football"'));
    assert.ok(result.includes('property="og:title" content="Sharing title"'));
    assert.ok(result.includes('name="twitter:description" content="Sharing description"'));
    assert.ok(result.includes('name="robots" content="noindex, follow"'));
    assert.equal((result.match(/rel="canonical"/g)||[]).length,1);
    assert.ok(seo.defaults(key).h1);
    if(key==='bet-builder') assert.ok(result.includes('>construction</span>'));
  });
}
test('unconfigured heading/intro retain defaults and empty intro can be removed', () => {
 const html=fs.readFileSync('public/index.html','utf8');
 assert.ok(seo.render(html,{}).includes(seo.defaults('home').h1));
 assert.ok(seo.render(html,{intro:''}).includes('<p data-seo-intro></p>'));
});
test('metadata and headings escape executable HTML and preserve replacement tokens', () => {
 const html=fs.readFileSync('public/blog.html','utf8');
 const result=seo.render(html,{title:'</title><script>alert(1)</script>',h1:'<img onerror="x">',description:'" onload="x',keywords:'$&'});
 assert.ok(!result.includes('<script>alert(1)</script>'));
 assert.ok(result.includes('content="&quot; onload=&quot;x"'));
 assert.ok(result.includes('name="keywords" content="$&amp;"'));
});
