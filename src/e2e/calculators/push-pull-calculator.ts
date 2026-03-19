/**
 * Shadow calculator for push/pull mechanics.
 * Mirrors logic in push-pull-handler.ts.
 * No engine imports — all data passed as parameters.
 */

/**
 * Calculate push amount when an account's minimum balance in a segment
 * exceeds its configured maximum balance.
 * Returns 0 if no push is needed.
 */
export function calculatePush(minBalanceInSegment: number, maxBalance: number): number {
  const excess = minBalanceInSegment - maxBalance;
  return excess > 0 ? excess : 0;
}

/**
 * Calculate pull amount when an account's minimum balance in a segment
 * falls below its configured minimum balance.
 * Returns 0 if the deficit is below the minimumPullAmount threshold.
 */
export function calculatePull(
  minBalanceInSegment: number,
  minBalance: number,
  minimumPullAmount: number,
): number {
  if (minBalanceInSegment >= minBalance) return 0;
  const deficit = minBalance - minBalanceInSegment;
  return Math.max(deficit, minimumPullAmount);
}

/**
 * Select which accounts to pull from and how much from each,
 * ordered by priority (lower = pulled first).
 * Each account contributes up to (balance - minimumBalance).
 */
export function selectPullSources(
  deficit: number,
  pullableAccounts: Array<{
    name: string;
    balance: number;
    priority: number;
    minimumBalance?: number;
  }>,
  strategy: 'manual' | 'taxOptimized',
  _segmentDate: string,
): Array<{ name: string; amount: number }> {
  // Sort by priority ascending (lower priority number = pulled first)
  const sorted = [...pullableAccounts].sort((a, b) => a.priority - b.priority);

  const results: Array<{ name: string; amount: number }> = [];
  let remaining = deficit;

  for (const acct of sorted) {
    if (remaining <= 0) break;

    const available = acct.balance - (acct.minimumBalance ?? 0);
    if (available <= 0) continue;

    const pullAmount = Math.min(remaining, available);
    results.push({ name: acct.name, amount: pullAmount });
    remaining -= pullAmount;
  }

  return results;
}

/**
 * Compute tax-aware priority score for withdrawal ordering.
 * Lower score = higher priority (pulled first).
 *
 * Pre-59.5 (penalty era):
 *   10 — Taxable (checking, savings, brokerage)
 *   50 — Roth (contributions are tax/penalty-free)
 *  100 — Tax-deferred with penalty (401k/IRA)
 *
 * Post-59.5 (no penalty):
 *   10 — Taxable
 *   40 — Tax-deferred (ordinary income, no penalty)
 *   50 — Roth (preserve tax-free growth)
 */
export function getTaxAwarePriority(
  account: {
    name: string;
    type: string;
    earlyWithdrawalPenalty?: number;
    earlyWithdrawalDate?: string | null;
  },
  date: string,
): number {
  const isPreTax = account.type === 'deferred'; // 401k, traditional IRA
  const isRoth = account.name.toLowerCase().includes('roth');

  const hasPenalty =
    (account.earlyWithdrawalPenalty ?? 0) > 0 &&
    account.earlyWithdrawalDate != null &&
    date < account.earlyWithdrawalDate;

  if (hasPenalty) {
    if (isRoth) return 50;
    if (isPreTax) return 100;
    return 10;
  }

  if (isRoth) return 50;
  if (isPreTax) return 40;
  return 10;
}
