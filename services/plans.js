// Prices are in naira; Paystack reports amounts in kobo.
// `rank` orders plans by tier (Diamond outranks Gold regardless of billing
// cycle, since Diamond is the premium product, not just "more of the same")
// then by duration within a tier -- used to block buying your current plan
// again or downgrading while already subscribed (see canPurchasePlan below).
const PLANS = Object.freeze({
  gold_biweekly: { label: 'Gold · 2 Weeks', amount: 9000, days: 14, rank: 1 },
  gold_monthly: { label: 'Gold · 1 Month', amount: 15000, days: 30, rank: 2 },
  diamond_biweekly: { label: 'Diamond · 2 Weeks', amount: 10000, days: 14, rank: 3 },
  diamond_monthly: { label: 'Diamond · 1 Month', amount: 18500, days: 30, rank: 4 },
});

// A user with an active subscription may only buy a STRICTLY higher-ranked
// plan (an upgrade) -- not the same plan again, and not a lower one, until
// their current one expires naturally. `currentPlan` is null/undefined for
// someone with no active subscription, which always allows the purchase.
function canPurchasePlan(currentPlan, targetPlan) {
  if (!currentPlan || !PLANS[currentPlan]) return true;
  if (!PLANS[targetPlan]) return false;
  return PLANS[targetPlan].rank > PLANS[currentPlan].rank;
}

module.exports = { PLANS, canPurchasePlan };
