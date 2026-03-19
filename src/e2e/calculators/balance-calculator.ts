/**
 * Shadow calculator for account balance verification.
 * Independent reimplementation — does NOT import from engine code.
 *
 * Computes the expected balance by summing a prior balance with
 * all module-level outputs (interest, bills, transfers, etc.).
 */

/**
 * Calculate the expected balance given a prior balance and a list of
 * module outputs (each with a signed amount).
 *
 * @param priorBalance  - Account balance at the start of the period
 * @param moduleOutputs - Array of { module, amount } from each engine module
 * @returns The expected ending balance
 */
export function calculateExpectedBalance(
  priorBalance: number,
  moduleOutputs: Array<{ module: string; amount: number }>,
): number {
  return priorBalance + moduleOutputs.reduce((sum, m) => sum + m.amount, 0);
}
