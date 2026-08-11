const { pool } = require('../config/db');
const { successResponse, asyncHandler } = require('../utils/helpers');

const getActive = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT slot_name, placement, ad_client_id, ad_slot_id, ad_format FROM ad_slots WHERE is_enabled = 1 AND ad_client_id IS NOT NULL AND ad_client_id != ""'
  );
  return successResponse(res, rows);
});

const adminList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ad_slots ORDER BY placement ASC');
  return successResponse(res, rows);
});

const adminUpdate = asyncHandler(async (req, res) => {
  const { ad_client_id, ad_slot_id, ad_format, is_enabled } = req.body;
  await pool.query(
    'UPDATE ad_slots SET ad_client_id = ?, ad_slot_id = ?, ad_format = ?, is_enabled = ? WHERE id = ?',
    [ad_client_id || null, ad_slot_id || null, ad_format || 'auto', is_enabled ? 1 : 0, req.params.id]
  );
  return successResponse(res, { message: 'Ad slot updated' });
});

module.exports = { getActive, adminList, adminUpdate };
