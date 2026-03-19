/**
 * Shadow pension calculator for E2E verification.
 * No engine imports — all data passed as parameters.
 *
 * Mirrors logic from:
 *   src/data/retirement/pension/pension.ts (HCA, reduction factor)
 *   src/utils/calculate-v3/retirement-manager.ts (getHighestCompensationAverage)
 *   src/utils/calculate-v3/calculator.ts (COLA application)
 */

/**
 * Calculate the Highest Compensation Average (HCA).
 *
 * Finds the best N consecutive years of annual income. If `workEndYear` is
 * provided, only income from years strictly before that year is included
 * (mirrors the engine's `year < pension.workEndDate.getUTCFullYear()` guard).
 *
 * @param annualIncomes  Array of { year, amount } objects (need not be sorted)
 * @param bestYears      Number of consecutive years to average
 * @param workEndYear    Optional year the person stopped working (exclusive upper bound)
 * @returns The highest average of any `bestYears` consecutive window, or 0
 */
export function calculateHCA(
  annualIncomes: Array<{ year: number; amount: number }>,
  bestYears: number,
  workEndYear?: number,
): number {
  // Filter to years before work end (if provided) and sort by year ascending
  const filtered = annualIncomes
    .filter((entry) => (workEndYear === undefined ? true : entry.year < workEndYear))
    .sort((a, b) => a.year - b.year);

  if (filtered.length < bestYears) {
    // Not enough years — engine returns 0 via empty Math.max(...[])
    return filtered.length === 0
      ? 0
      : filtered.reduce((s, e) => s + e.amount, 0) / filtered.length;
  }

  let highestAverage = 0;
  for (let i = 0; i <= filtered.length - bestYears; i++) {
    const windowSum = filtered
      .slice(i, i + bestYears)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const avg = windowSum / bestYears;
    if (avg > highestAverage) {
      highestAverage = avg;
    }
  }

  return highestAverage;
}

/**
 * Calculate the monthly pension payment (before COLA).
 *
 * Formula: (hca * accrualRate * yearsWorked * reductionFactor) / 12
 *
 * @param hca              Highest Compensation Average
 * @param accrualRate      Pension accrual factor (e.g. 0.018)
 * @param yearsWorked      Total years of service (fractional)
 * @param reductionFactor  Factor between 0 and 1 (1 = unreduced / full benefits)
 * @returns Monthly pension amount
 */
export function calculateMonthlyPension(
  hca: number,
  accrualRate: number,
  yearsWorked: number,
  reductionFactor: number,
): number {
  return (hca * accrualRate * yearsWorked * reductionFactor) / 12;
}

/**
 * Apply Cost-of-Living Adjustment to a monthly pension amount.
 *
 * Engine logic (from calculator.ts):
 *   - 'none'     → no adjustment
 *   - 'fixed'    → amount * (1 + fixedRate) ^ yearsFromStart
 *   - 'cpiLinked' → not yet implemented in engine; returns base amount
 *
 * @param monthlyAmount  Base monthly pension (without COLA)
 * @param colaType       'none' | 'fixed' | 'cpiLinked'
 * @param fixedRate      Annual fixed COLA rate (e.g. 0.02 for 2%)
 * @param yearsFromStart Number of full years since first payment
 * @returns Adjusted monthly amount
 */
export function applyCOLA(
  monthlyAmount: number,
  colaType: 'none' | 'fixed' | 'cpiLinked',
  fixedRate: number | undefined,
  yearsFromStart: number,
): number {
  if (colaType === 'none' || yearsFromStart <= 0) {
    return monthlyAmount;
  }

  if (colaType === 'fixed' && fixedRate !== undefined) {
    return monthlyAmount * Math.pow(1 + fixedRate, yearsFromStart);
  }

  // cpiLinked is not implemented in engine — returns base amount
  return monthlyAmount;
}
