const fs = require('fs');
const path = require('path');

const pages = { home: 'index.html', predictions: 'predictions.html', 'bet-builder': 'bet-builder.html', pricing: 'pricing.html', blog: 'blog.html', about: 'about.html', statistics: 'statistics.html' };
const fields = { title: 255, description: 5000, keywords: 5000, og_image: 500, h1: 255, intro: 5000, og_title: 255, og_description: 5000, canonical_url: 500, robots: 100 };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function defaults(key) {
  const html = fs.readFileSync(path.join(__dirname, '../public', pages[key]), 'utf8');
  return {
    h1: decode(html.match(/<span data-seo-heading>([\s\S]*?)<\/span>/)?.[1] || ''),
    intro: decode(html.match(/<p data-seo-intro[^>]*>([\s\S]*?)<\/p>/)?.[1] || ''),
    supports_heading: html.includes('data-seo-heading'),
  };
}

function meta(html, kind, key, value) {
  if (value == null) return html;
  const tag = `<meta ${kind}="${key}" content="${escape(value)}">`;
  const pattern = new RegExp(`<meta\\b[^>]*\\b${kind}=["']${key}["'][^>]*>`, 'i');
  return pattern.test(html) ? html.replace(pattern, () => tag) : html.replace('</head>', () => `${tag}\n</head>`);
}

function render(html, seo) {
  if (seo.title) html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => `<title>${escape(seo.title)}</title>`);
  html = meta(html, 'name', 'description', seo.description);
  html = meta(html, 'name', 'keywords', seo.keywords);
  html = meta(html, 'name', 'robots', seo.robots || 'index, follow');
  for (const prefix of ['og', 'twitter']) {
    const kind = prefix === 'og' ? 'property' : 'name';
    html = meta(html, kind, prefix + ':title', seo.og_title || seo.title);
    html = meta(html, kind, prefix + ':description', seo.og_description || seo.description);
    if (seo.og_image) html = meta(html, kind, prefix + ':image', seo.og_image);
  }
  if (seo.canonical_url) {
    const tag = `<link rel="canonical" href="${escape(seo.canonical_url)}">`;
    const pattern = /<link\b[^>]*rel=["']canonical["'][^>]*>/i;
    html = pattern.test(html) ? html.replace(pattern, () => tag) : html.replace('</head>', () => tag + '\n</head>');
    html = meta(html, 'property', 'og:url', seo.canonical_url);
  }
  if (seo.h1) html = html.replace(/(<span data-seo-heading>)[\s\S]*?(<\/span>)/, (_, start, end) => start + escape(seo.h1) + end);
  if (seo.intro != null) html = html.replace(/(<p data-seo-intro[^>]*>)[\s\S]*?(<\/p>)/, (_, start, end) => start + escape(seo.intro).replace(/\n/g, '<br>') + end);
  return html;
}

module.exports = { pages, fields, defaults, render };
