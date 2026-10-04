const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

const router = express.Router();

// Team crests come from API-Football's CDN as ~250px PNGs (~85KB each) but are
// shown at 16-48px, so a page of predictions pulled over a megabyte of image
// for pixels it never displayed. This route fetches each crest once, shrinks it
// to a 96px WebP (covers 32px at 3x density, typically 2-4KB) and keeps it on
// disk -- every later request, from any visitor, is a cheap static read.
//
// The id is restricted to digits and the upstream host is fixed, so this can't
// be steered at an arbitrary URL (no SSRF), and unknown ids are remembered as
// misses so random-id requests can't be used to hammer the upstream.
const CACHE_DIR = path.join(__dirname, '..', '.cache', 'team-logos');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const inflight = new Map();
const misses = new Map(); // id -> expiry timestamp
const MISS_TTL_MS = 10 * 60 * 1000;
const MAX_MISSES = 5000;

async function buildLogo(id, file) {
  const { data } = await axios.get(`https://media.api-sports.io/football/teams/${id}.png`, {
    responseType: 'arraybuffer', timeout: 8000, maxContentLength: 2 * 1024 * 1024,
  });
  const webp = await sharp(Buffer.from(data))
    .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82 })
    .toBuffer();
  fs.writeFileSync(file, webp);
}

router.get('/team/:id.webp', async (req, res) => {
  const id = req.params.id;
  if (!/^\d{1,8}$/.test(id)) return res.status(404).end();
  const file = path.join(CACHE_DIR, `${id}.webp`);

  if (!fs.existsSync(file)) {
    const missUntil = misses.get(id);
    if (missUntil && missUntil > Date.now()) return res.status(404).end();
    try {
      if (!inflight.has(id)) inflight.set(id, buildLogo(id, file).finally(() => inflight.delete(id)));
      await inflight.get(id);
    } catch (err) {
      if (misses.size >= MAX_MISSES) misses.clear();
      misses.set(id, Date.now() + MISS_TTL_MS);
      return res.status(404).end();
    }
  }
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.type('image/webp');
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
