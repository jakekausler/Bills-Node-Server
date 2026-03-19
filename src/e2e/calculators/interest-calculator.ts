/**
 * Shadow calculator for interest/return calculations.
 * Independent implementation — no engine imports.
 *
 * Replicates the compounding logic from the engine's calculateInterestAmount
 * and processInterestEvent methods.
 */

/**
 * Compute blended annual return from portfolio glide path allocation.
 *
 * Uses the most recent waypoint year that is <= the given date's year.
 * Clamps to the earliest/latest waypoint when outside the range.
 *
 * @param date - Current date as YYYY-MM-DD
 * @param glidePathData - Portfolio makeup keyed by year string, e.g. { "2025": { stock: 0.8, bond: 0.15, ... } }
 * @param assetReturns - Per-asset annual returns, e.g. { stock: 0.10, bond: 0.04, cash: 0.02 }
 * @returns Blended annual return
 */
export function computeBlendedReturn(
  date: string,
  glidePathData: Record<string, Record<string, number>>,
  assetReturns: Record<string, number>,
): number {
  const year = parseInt(date.substring(0, 4), 10);
  const waypointYears = Object.keys(glidePathData)
    .map(Number)
    .sort((a, b) => a - b);

  // Find the most recent waypoint year <= the given year
  let selectedYear: number;
  if (year <= waypointYears[0]) {
    selectedYear = waypointYears[0];
  } else if (year >= waypointYears[waypointYears.length - 1]) {
    selectedYear = waypointYears[waypointYears.length - 1];
  } else {
    selectedYear = waypointYears[0];
    for (const wy of waypointYears) {
      if (wy > year) break;
      selectedYear = wy;
    }
  }

  const composition = glidePathData[selectedYear.toString()];

  // Compute weighted sum of returns across all asset classes
  let blended = 0;
  for (const [assetClass, weight] of Object.entries(composition)) {
    if (assetReturns[assetClass] !== undefined) {
      blended += weight * assetReturns[assetClass];
    } else {
      // For unknown asset classes (preferred, convertible, other), use
      // the average of stock and bond returns as a proxy (matches engine)
      const stockReturn = assetReturns['stock'] ?? 0;
      const bondReturn = assetReturns['bond'] ?? 0;
      blended += weight * ((stockReturn + bondReturn) / 2);
    }
  }

  return blended;
}

/**
 * Map a compounding frequency string to periods per year.
 *
 * Supports simple keywords ("day", "daily", "week", "weekly", "month",
 * "monthly", "quarter", "quarterly", "year", "yearly") and compound
 * expressions like "6 month", "2 week", etc.
 *
 * Defaults to 12 (monthly) if the frequency is unrecognized.
 */
export function periodsPerYear(frequency: string): number {
  if (!frequency || typeof frequency !== 'string') {
    return 12; // default to monthly
  }

  switch (frequency.toLowerCase()) {
    case 'day':
    case 'daily':
      return 365;
    case 'week':
    case 'weekly':
      return 52;
    case 'month':
    case 'monthly':
      return 12;
    case 'quarter':
    case 'quarterly':
      return 4;
    case 'year':
    case 'yearly':
      return 1;
    default: {
      // Try to parse compound expressions like "6 month", "2 week"
      const match = frequency.match(/(\d+)\s*(month|day|week|year|quarter)/);
      if (match) {
        const amount = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
          case 'day':
            return 365 / amount;
          case 'week':
            return 52 / amount;
          case 'quarter':
            return 4 / amount;
          case 'month':
            return 12 / amount;
          case 'year':
            return 1 / amount;
        }
      }
      return 12; // fallback
    }
  }
}

/**
 * Calculate the interest amount for one compounding period.
 *
 * Uses geometric compounding:
 *   periodRate = (1 + annualRate)^(1/n) - 1
 * where n = periodsPerYear.
 *
 * When n === 1 (yearly), periodRate === annualRate (no transformation needed).
 *
 * Returns 0 when balance or annualRate is 0.
 */
export function calculateInterestAmount(
  balance: number,
  annualRate: number,
  frequency: string,
): number {
  if (balance === 0 || annualRate === 0) return 0;

  const n = periodsPerYear(frequency);

  const periodRate = n === 1
    ? annualRate
    : Math.pow(1 + annualRate, 1 / n) - 1;

  return balance * periodRate;
}

/**
 * Calculate interest with expense-ratio adjustment, matching the engine's
 * processInterestEvent flow:
 *
 * 1. If balance > 0, subtract expenseRatio from the annual rate.
 * 2. Compute per-period interest via geometric compounding.
 * 3. Return 0 when |result| <= 0.001 (floating-point noise threshold).
 *
 * @param balance          Current account balance
 * @param annualRate       Nominal annual rate (decimal, e.g. 0.07 for 7%)
 * @param expenseRatio     Annual expense ratio (decimal, e.g. 0.004 for 0.4%)
 * @param frequency        Compounding frequency string
 * @param interestAppliesToPositiveBalance
 *   When false, interest is skipped for positive balances (debt-only accounts).
 *   Defaults to true.
 * @returns The interest amount for one compounding period, or 0.
 */
export function calculateInterest(
  balance: number,
  annualRate: number,
  expenseRatio: number,
  frequency: string,
  interestAppliesToPositiveBalance = true,
): number {
  // Skip interest on positive balances when the flag is off
  if (!interestAppliesToPositiveBalance && balance > 0) {
    return 0;
  }

  // Expense ratio is always subtracted from the annual rate for positive
  // balances (investment gains). For negative balances (debt) the engine
  // also subtracts it (lines 433-438), so we apply unconditionally when
  // balance > 0. The engine code actually always subtracts for positive
  // balances regardless of whether expenseRatio > 0.
  let effectiveRate = annualRate;
  if (balance > 0) {
    effectiveRate = annualRate - expenseRatio;
  }

  const interest = calculateInterestAmount(balance, effectiveRate, frequency);

  // Filter out floating-point noise (matches engine threshold)
  if (Math.abs(interest) <= 0.001) {
    return 0;
  }

  return interest;
}
