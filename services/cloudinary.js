const cloudinary = require('cloudinary').v2;

// cloudinary.v2 auto-configures itself from the CLOUDINARY_URL env var --
// no explicit .config() call needed as long as that's set.
function isConfigured() {
  return !!process.env.CLOUDINARY_URL;
}

/**
 * Uploads a base64 data URL (as produced by FileReader.readAsDataURL on the
 * client) to Cloudinary and returns the hosted URL. Used for blog featured
 * images and in-content images, replacing the old approach of embedding the
 * raw base64 blob directly in the database / request body -- that bloated
 * row sizes and repeatedly hit nginx's request body limit on anything but a
 * tiny image.
 */
async function uploadImage(dataUrl, folder = 'staketruth') {
  if (!isConfigured()) throw new Error('Cloudinary is not configured (CLOUDINARY_URL missing)');
  const result = await cloudinary.uploader.upload(dataUrl, { folder });
  return result.secure_url;
}

module.exports = { isConfigured, uploadImage };
