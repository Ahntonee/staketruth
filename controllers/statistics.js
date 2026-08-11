const { successResponse, asyncHandler } = require('../utils/helpers');
const stats = require('../services/statistics');

const highestScoringTeams = asyncHandler(async (req, res) => {
  const rows = await stats.getHighestScoringTeams(Number(req.query.limit) || 20);
  return successResponse(res, rows);
});
const lowestScoringTeams = asyncHandler(async (req, res) => {
  const rows = await stats.getLowestScoringTeams(Number(req.query.limit) || 20);
  return successResponse(res, rows);
});
const highestScoringLeagues = asyncHandler(async (req, res) => {
  const rows = await stats.getHighestScoringLeagues(Number(req.query.limit) || 20);
  return successResponse(res, rows);
});
const lowestScoringLeagues = asyncHandler(async (req, res) => {
  const rows = await stats.getLowestScoringLeagues(Number(req.query.limit) || 20);
  return successResponse(res, rows);
});
const reliableTeams = asyncHandler(async (req, res) => {
  const rows = await stats.getMostReliableTeamsByMarket(req.query.market, Number(req.query.limit) || 20);
  return successResponse(res, rows);
});
const reliableLeagues = asyncHandler(async (req, res) => {
  const rows = await stats.getMostReliableLeaguesByMarket(req.query.market, Number(req.query.limit) || 20);
  return successResponse(res, rows);
});
const effectiveByTeam = asyncHandler(async (req, res) => {
  const rows = await stats.getMostEffectivePredictionsByTeam(req.query.team);
  return successResponse(res, rows);
});
const effectiveByLeague = asyncHandler(async (req, res) => {
  const rows = await stats.getMostEffectivePredictionsByLeague(req.query.league_id);
  return successResponse(res, rows);
});
const reliableMarkets = asyncHandler(async (req, res) => {
  const rows = await stats.getMostReliableMarkets();
  return successResponse(res, rows);
});
const crossMarketLeague = asyncHandler(async (req, res) => {
  const rows = await stats.getCrossMarketLeagueStats();
  return successResponse(res, rows);
});
const summary = asyncHandler(async (req, res) => {
  const data = await stats.getPublicSummary();
  return successResponse(res, data);
});

module.exports = {
  highestScoringTeams, lowestScoringTeams, highestScoringLeagues, lowestScoringLeagues,
  reliableTeams, reliableLeagues, effectiveByTeam, effectiveByLeague, reliableMarkets,
  crossMarketLeague, summary,
};
