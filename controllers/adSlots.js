const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

// A slot only needs to actually work for its own ad_type -- an AdSense slot
// needs client/slot IDs, a banner needs an image, a text link needs a URL,
// custom code just needs the code itself. Anything missing that just doesn't
// render (see ST.injectAdSlots), so the filter here only needs is_enabled.
const getActive = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT slot_name, placement, ad_type, ad_client_id, ad_slot_id, ad_format, image_url, link_url, link_text, custom_code
     FROM ad_slots WHERE is_enabled = 1`
  );
  return successResponse(res, rows);
});

const adminList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ad_slots ORDER BY placement ASC, id ASC');
  return successResponse(res, rows);
});

const create = asyncHandler(async (req, res) => {
  const { slot_name, placement } = req.body;
  if (!slot_name || !placement) return errorResponse(res, 'slot_name and placement are required', 400);
  const [result] = await pool.query(
    `INSERT INTO ad_slots (slot_name, placement, ad_type, is_enabled) VALUES (?, ?, ?, 0)`,
    [slot_name, placement, req.body.ad_type || 'adsense']
  );
  return successResponse(res, { id: result.insertId }, undefined, 201);
});

const adminUpdate = asyncHandler(async (req, res) => {
  const {
    ad_type, ad_client_id, ad_slot_id, ad_format, image_url, link_url, link_text, custom_code, is_enabled,
  } = req.body;
  await pool.query(
    `UPDATE ad_slots SET ad_type = ?, ad_client_id = ?, ad_slot_id = ?, ad_format = ?,
     image_url = ?, link_url = ?, link_text = ?, custom_code = ?, is_enabled = ? WHERE id = ?`,
    [ad_type || 'adsense', ad_client_id || null, ad_slot_id || null, ad_format || 'auto',
      image_url || null, link_url || null, link_text || null, custom_code || null, is_enabled ? 1 : 0, req.params.id]
  );
  return successResponse(res, { message: 'Ad slot updated' });
});

const remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM ad_slots WHERE id = ?', [req.params.id]);
  return successResponse(res, { message: 'Ad slot deleted' });
});

module.exports = { getActive, adminList, create, adminUpdate, remove };
