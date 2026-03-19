/**
 * Shadow Roth conversion calculator for E2E verification.
 * No engine imports — all data passed as parameters.
 *
 * Mirrors logic from:
 *   src/utils/calculate-v3/roth-conversion-manager.ts  (bracket space, conversion amount, lots)
 *   src/utils/calculate-v3/bracket-calculator.ts        (getBracketDataForYear, inflation)
 */

interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

interface YearBracketData {
  brackets: Record<string, TaxBracket[]>;
  standardDeduction: Record<string, number>;
}

/**
 * Inflate bracket data from a base year to a target year.
 * Mirrors getBracketDataForYear in bracket-calculator.ts:
 *   - Bracket thresholds are rounded to nearest $50 (IRS convention)
 *   - Rates are not inflated
 *
 * @param baseBrackets   Brackets for the base year
 * @param baseDeduction  Standard deduction for the base year and filing status
 * @param yearsToInflate Number of years to inflate forward
 * @param inflationRate  Annual inflation rate (e.g. 0.03)
 * @returns Inflated brackets and standard deduction
 */
function inflateBracketData(
  baseBrackets: TaxBracket[],
  baseDeduction: number,
  yearsToInflate: number,
  inflationRate: number,
): { brackets: TaxBracket[]; standardDeduction: number } {
  if (yearsToInflate <= 0) {
    return { brackets: baseBrackets, standardDeduction: baseDeduction };
  }

  const multiplier = Math.pow(1 + inflationRate, yearsToInflate);

  const inflatedBrackets = baseBrackets.map((b) => ({
    min: Math.round((b.min * multiplier) / 50) * 50,
    max: b.max !== null ? Math.round((b.max * multiplier) / 50) * 50 : null,
    rate: b.rate,
  }));

  const inflatedDeduction = Math.round((baseDeduction * multiplier) / 50) * 50;

  return { brackets: inflatedBrackets, standardDeduction: inflatedDeduction };
}

/**
 * Calculate remaining bracket space for Roth conversions.
 *
 * Engine logic (roth-conversion-manager.ts lines ~146-168):
 *   1. Get bracket data for the year (inflation-adjusted)
 *   2. Find the bracket matching targetBracketRate
 *   3. taxableIncome = max(0, ytdOrdinaryIncome - standardDeduction)
 *   4. remainingSpace = max(0, bracket.max - taxableIncome)
 *
 * @param ytdOrdinaryIncome  Year-to-date ordinary + retirement + interest income
 * @param targetBracketRate  The tax rate of the target bracket (e.g. 0.22)
 * @param filingStatus       Filing status key (e.g. 'mfj', 'single')
 * @param year               Tax year
 * @param inflationRate      Annual inflation rate for bracket adjustment
 * @param taxBrackets        Raw bracket data: { baseYear, brackets, standardDeduction }
 *                           where brackets/standardDeduction are keyed by filing status
 * @returns Remaining space in the target bracket (>= 0)
 */
export function calculateBracketSpace(
  ytdOrdinaryIncome: number,
  targetBracketRate: number,
  filingStatus: string,
  year: number,
  inflationRate: number,
  taxBrackets: {
    baseYear: number;
    brackets: Record<string, TaxBracket[]>;
    standardDeduction: Record<string, number>;
  },
): number {
  const yearsToInflate = year - taxBrackets.baseYear;
  const baseBrackets = taxBrackets.brackets[filingStatus];
  const baseDeduction = taxBrackets.standardDeduction[filingStatus];

  if (!baseBrackets || baseDeduction === undefined) {
    return 0;
  }

  const { brackets, standardDeduction } = inflateBracketData(
    baseBrackets,
    baseDeduction,
    yearsToInflate,
    inflationRate,
  );

  // Find the bracket matching the target rate
  const targetBracket = brackets.find((b) => b.rate === targetBracketRate);
  if (!targetBracket) {
    return 0;
  }

  const thresholdEnd = targetBracket.max ?? Number.MAX_SAFE_INTEGER;
  const taxableIncome = Math.max(0, ytdOrdinaryIncome - standardDeduction);

  return Math.max(0, thresholdEnd - taxableIncome);
}

/**
 * Calculate the actual conversion amount.
 *
 * Engine logic: min(bracketSpace, sourceBalance), clamped >= 0
 *
 * @param bracketSpace   Available space in target bracket
 * @param sourceBalance  Balance available in the source (traditional) account
 * @returns Conversion amount (>= 0)
 */
export function calculateConversionAmount(
  bracketSpace: number,
  sourceBalance: number,
): number {
  return Math.max(0, Math.min(bracketSpace, sourceBalance));
}

/**
 * Get the total balance of conversion lots still within the 5-year holding period
 * (subject to early withdrawal penalty if under age 59.5).
 *
 * Engine logic (roth-conversion-manager.ts lines ~457-468):
 *   Sum lots where penaltyFreeYear > currentYear
 *   (penaltyFreeYear = conversionYear + 5)
 *
 * @param conversionLots  Array of { year, amount } representing Roth conversion lots
 * @param currentYear     The year to check against
 * @returns Total penaltyable balance
 */
export function getPenaltyableBalance(
  conversionLots: Array<{ year: number; amount: number }>,
  currentYear: number,
): number {
  let total = 0;
  for (const lot of conversionLots) {
    const penaltyFreeYear = lot.year + 5;
    if (penaltyFreeYear > currentYear) {
      total += lot.amount;
    }
  }
  return total;
}

/**
 * Check the ACA subsidy impact of a Roth conversion.
 *
 * Engine logic (roth-conversion-manager.ts lines ~196-348):
 *   - If in ACA period for nextYear, calculate subsidy with and without conversion
 *   - Annual subsidy loss = max(0, (subsidyBefore - subsidyAfter) * 12)
 *
 * This is a simplified version — the engine also does binary search to reduce
 * conversion if effective rate exceeds target + 5%. The full binary search is
 * not replicated here; this function just returns the raw annual subsidy loss.
 *
 * @param currentMAGI       Current year's MAGI (ordinary income before conversion)
 * @param conversionAmount  Proposed conversion amount
 * @param nextYear          Year+1 (when MAGI affects ACA subsidy)
 * @param acaSubsidyFn      Function(magi, householdSize, year, grossPremium) => monthly subsidy
 * @param grossPremium      ACA gross premium for nextYear
 * @returns Annual subsidy loss (>= 0)
 */
export function checkAcaSubsidyImpact(
  currentMAGI: number,
  conversionAmount: number,
  nextYear: number,
  acaSubsidyFn: (magi: number, householdSize: number, year: number, grossPremium: number) => number,
  grossPremium: number,
): number {
  const householdSize = 2;

  const subsidyBefore = acaSubsidyFn(currentMAGI, householdSize, nextYear, grossPremium);
  const subsidyAfter = acaSubsidyFn(
    currentMAGI + conversionAmount,
    householdSize,
    nextYear,
    grossPremium,
  );

  return Math.max(0, (subsidyBefore - subsidyAfter) * 12);
}
