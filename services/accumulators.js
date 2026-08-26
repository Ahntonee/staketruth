// Shared combined-odds/result math for both admin accumulators (Truth Safe
// Picks) and user bet-builder slips -- same accumulator logic either way.

function combinedOdds(legs) {
  const withOdds = legs.filter((l) => l.odds != null && l.odds > 0);
  if (!withOdds.length) return null;
  return Number(withOdds.reduce((acc, l) => acc * Number(l.odds), 1).toFixed(2));
}

// Standard accumulator settlement: any leg lost -> the whole slip lost.
// All legs won -> won. Otherwise (still pending legs, none lost) -> pending.
function combinedResult(legs) {
  if (legs.some((l) => l.result === 'lost')) return 'lost';
  if (legs.every((l) => l.result === 'won')) return 'won';
  return 'pending';
}

module.exports = { combinedOdds, combinedResult };
