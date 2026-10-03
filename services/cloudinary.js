const cloudinary = require('cloudinary').v2;

// cloudinary.v2 auto-configures itself from the CLOUDINARY_URL env var --
// no explicit .config() call needed as long as that's set.
function isConfigured() {
  return !!process.env.CLOUDINARY_URL;
}

// Deliberately NOT including image/svg+xml -- an SVG is XML and can carry an
// embedded <script> tag, making it a real stored-XSS vector if ever served
// back inline rather than as a flat raster image. Everything else here is a
// pure raster format with no script-execution surface.
const ALLOWED_IMAGE_TYPES = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  // WEBP's signature isn't one contiguous run -- "RIFF" then 4 bytes of file
  // size then "WEBP" -- checked separately below rather than via this map.
  'image/webp': null,
};

/**
 * Validates a base64 data URL actually IS the image type it claims to be,
 * not just that the string happens to start with the right prefix (trivially
 * spoofable -- a client can label arbitrary bytes "data:image/png;base64,...").
 * Checks the declared MIME is on the raster-only allowlist, decodes the
 * payload, confirms the decoded bytes' own magic-number signature matches,
 * and caps the size. Cloudinary's own decode/re-encode on upload is a second,
 * independent layer of defense against a crafted "image" carrying a hidden
 * payload (e.g. a polyglot file) -- this check exists to reject obvious
 * mismatches and oversized uploads before they ever leave the server.
 */
function validateImageDataUrl(dataUrl, maxBytes = 8 * 1024 * 1024) {
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) return { valid: false, reason: 'Not a valid image data URL' };
  const [, mime, base64] = match;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, mime)) {
    return { valid: false, reason: 'Unsupported image type -- use PNG, JPEG, GIF, or WEBP' };
  }
  let buf;
  try { buf = Buffer.from(base64, 'base64'); } catch (e) { return { valid: false, reason: 'Could not decode image data' }; }
  if (!buf.length) return { valid: false, reason: 'Empty file' };
  if (buf.length > maxBytes) return { valid: false, reason: `Image is too large (max ${Math.floor(maxBytes / 1024 / 1024)}MB)` };

  if (mime === 'image/webp') {
    const isRiff = buf.slice(0, 4).toString('ascii') === 'RIFF';
    const isWebp = buf.slice(8, 12).toString('ascii') === 'WEBP';
    if (!isRiff || !isWebp) return { valid: false, reason: 'File content does not match a WEBP image' };
  } else {
    const signature = ALLOWED_IMAGE_TYPES[mime];
    const matches = signature.every((byte, i) => buf[i] === byte);
    if (!matches) return { valid: false, reason: 'File content does not match the declared image type' };
  }
  return { valid: true };
}

/**
 * Uploads a base64 data URL (as produced by FileReader.readAsDataURL on the
 * client) to Cloudinary and returns the hosted URL. Used for blog featured
 * images, in-content images, and payment-proof screenshots, replacing the
 * old approach of embedding the raw base64 blob directly in the database /
 * request body -- that bloated row sizes and repeatedly hit nginx's request
 * body limit on anything but a tiny image. Callers should run
 * validateImageDataUrl first; this function doesn't re-check.
 */
async function uploadImage(dataUrl, folder = 'staketruth') {
  if (!isConfigured()) throw new Error('Cloudinary is not configured (CLOUDINARY_URL missing)');
  const result = await cloudinary.uploader.upload(dataUrl, { folder });
  return result.secure_url;
}

module.exports = { isConfigured, uploadImage, validateImageDataUrl };
