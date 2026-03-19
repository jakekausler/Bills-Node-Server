/**
 * Shadow calculator for spending tracker verification.
 * Independent reimplementation — does NOT import from engine code.
 *
 * Mirrors the carry-over / carry-under logic in
 * calculate-v3/spending-tracker-manager.ts.
 */

/**
 * Determine whether a category is over budget for the current period,
 * and compute the remaining budget.
 *
 * The effective threshold is `threshold + carryBalance` (clamped >= 0).
 * "Over budget" means year-to-date spending exceeds the effective threshold.
 * Remainder is how much is left before hitting the effective threshold.
 *
 * @param ytdSpending   - Total spending accumulated in the current period
 * @param threshold     - Base threshold (possibly inflation-adjusted) for the period
 * @param carryBalance  - Carry balance rolled forward from prior periods
 *                        (positive = surplus, negative = debt)
 */
export function calculatePeriodStatus(
  ytdSpending: number,
  threshold: number,
  carryBalance: number,
): { overBudget: boolean; remainder: number } {
  const effectiveThreshold = Math.max(0, threshold + carryBalance);
  const remainder = Math.max(0, effectiveThreshold - ytdSpending);
  const overBudget = ytdSpending > effectiveThreshold;
  return { overBudget, remainder };
}

/**
 * Apply a threshold change to a spending category.
 *
 * When `resetCarry` is true the carry balance is zeroed out;
 * otherwise the existing carry is preserved.
 *
 * @param oldThreshold - Previous base threshold
 * @param newThreshold - New base threshold after the change
 * @param resetCarry   - Whether to reset the carry balance to 0
 * @param currentCarry - Current carry balance before the change
 */
export function applyThresholdChange(
  oldThreshold: number,
  newThreshold: number,
  resetCarry: boolean,
  currentCarry: number,
): { threshold: number; carry: number } {
  return {
    threshold: newThreshold,
    carry: resetCarry ? 0 : currentCarry,
  };
}
