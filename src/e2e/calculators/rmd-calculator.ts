/**
 * Shadow RMD (Required Minimum Distribution) calculator for E2E verification.
 * No engine imports — all data passed as parameters.
 *
 * Mirrors logic from:
 *   src/utils/calculate-v3/retirement-manager.ts  (rmd method)
 *   data/rmd.json                                  (IRS Uniform Lifetime Table)
 */

/**
 * Look up the IRS life expectancy divisor for a given age.
 *
 * The RMD table maps integer ages (73-120) to divisors.
 * Returns 0 if the age is not present in the table (i.e., below RMD start age
 * or above 120), which causes calculateRMD to return 0.
 *
 * @param age       Integer age of the account holder on Dec 31 of the distribution year
 * @param rmdTable  Map of age (as string key) to divisor value
 * @returns The divisor, or 0 if age not in table
 */
export function getDivisor(
  age: number,
  rmdTable: Record<string, number>,
): number {
  const key = String(age);
  if (key in rmdTable) {
    return rmdTable[key];
  }
  return 0;
}

/**
 * Calculate the Required Minimum Distribution for a tax-deferred account.
 *
 * Formula: RMD = priorYearEndBalance / divisor
 *
 * Returns 0 when:
 *   - The age is not in the RMD table (person is below RMD age or above 120)
 *   - The prior year end balance is 0 or negative
 *
 * Engine reference (retirement-manager.ts line ~480):
 *   ```
 *   public rmd(balance: number, age: number) {
 *     if (age in this.rmdTable) {
 *       return balance / this.rmdTable[age];
 *     }
 *     return 0;
 *   }
 *   ```
 *
 * Note: The engine loads the RMD table with integer keys (parseInt), so we
 * accept the age as a number and convert to string for lookup.
 *
 * @param priorYearEndBalance  Account balance at end of prior year (Dec 31)
 * @param age                  Integer age of account holder on Dec 31 of distribution year
 * @param rmdTable             Map of age (string or number key) to divisor
 * @returns The required distribution amount, or 0
 */
export function calculateRMD(
  priorYearEndBalance: number,
  age: number,
  rmdTable: Record<string, number>,
): number {
  const divisor = getDivisor(age, rmdTable);
  if (divisor === 0) {
    return 0;
  }
  return priorYearEndBalance / divisor;
}
