const router = require('express').Router();
const tables = require('../services/leagueTables');
const { asyncHandler, successResponse, errorResponse } = require('../utils/helpers');

router.get('/:league/:type', asyncHandler(async (req, res) => {
  const { league, type } = req.params;
  if (!Object.hasOwn(tables.LEAGUES, league) || !Object.hasOwn(tables.TYPES, type)) return errorResponse(res, 'Unknown league or table', 400);
  return successResponse(res, await tables.getTable(league, type));
}));
module.exports = router;
