// Prices are in naira; Paystack reports amounts in kobo.
const PLANS = Object.freeze({
  gold_biweekly: { label: 'Gold · 2 Weeks', amount: 9000, days: 14 },
  gold_monthly: { label: 'Gold · 1 Month', amount: 15000, days: 30 },
  diamond_biweekly: { label: 'Diamond · 2 Weeks', amount: 10000, days: 14 },
  diamond_monthly: { label: 'Diamond · 1 Month', amount: 18500, days: 30 },
});

module.exports = { PLANS };
