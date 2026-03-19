/**
 * Shadow calculator for federal tax computation.
 * Independent implementation — no engine imports.
 *
 * Replicates the progressive bracket logic from the engine's
 * bracket-calculator.ts and tax-manager.ts.
 */

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

interface YearBracketData {
  brackets: Record<FilingStatus, TaxBracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  ssProvisionalThresholds: Record<FilingStatus, { tier1: number; tier2: number }>;
}

/**
 * Find the most recent year <= targetYear in the bracket data, then inflate
 * bracket thresholds and standard deduction forward.
 *
 * SS provisional thresholds are NEVER inflated (statutory, not indexed).
 */
function getBracketDataForYear(
  year: number,
  inflationRate: number,
  taxBrackets: Record<string, YearBracketData>,
): YearBracketData {
  // Exact match — return directly
  if (taxBrackets[String(year)]) {
    return taxBrackets[String(year)];
  }

  // Find the most recent available year that is <= target year
  const availableYears = Object.keys(taxBrackets).map(Number).sort((a, b) => b - a);
  const baseYear = availableYears.find(y => y <= year) ?? availableYears[0];
  const baseData = taxBrackets[String(baseYear)];
  const yearsToInflate = year - baseYear;

  if (yearsToInflate <= 0) return baseData;

  const inflationMultiplier = Math.pow(1 + inflationRate, yearsToInflate);

  // Inflate brackets for all filing statuses
  const inflatedBrackets: Record<FilingStatus, TaxBracket[]> = {} as any;
  for (const status of ['single', 'mfj', 'mfs', 'hoh'] as FilingStatus[]) {
    inflatedBrackets[status] = baseData.brackets[status].map(b => ({
      min: Math.round((b.min * inflationMultiplier) / 50) * 50,
      max: b.max !== null ? Math.round((b.max * inflationMultiplier) / 50) * 50 : null,
      rate: b.rate,
    }));
  }

  // Inflate standard deductions
  const inflatedDeductions: Record<FilingStatus, number> = {} as any;
  for (const status of ['single', 'mfj', 'mfs', 'hoh'] as FilingStatus[]) {
    inflatedDeductions[status] =
      Math.round((baseData.standardDeduction[status] * inflationMultiplier) / 50) * 50;
  }

  return {
    brackets: inflatedBrackets,
    standardDeduction: inflatedDeductions,
    ssProvisionalThresholds: baseData.ssProvisionalThresholds, // Never inflated
  };
}

/**
 * Progressive tax calculation over a set of brackets.
 *
 * Walks each bracket and taxes only the portion of income that falls within
 * [bracket.min, bracket.max). The last bracket has max === null (unbounded).
 */
function calculateProgressiveTax(taxableIncome: number, brackets: TaxBracket[]): number {
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;
    const upper = bracket.max !== null ? Math.min(taxableIncome, bracket.max) : taxableIncome;
    tax += (upper - bracket.min) * bracket.rate;
  }
  return tax;
}

/**
 * Calculate the taxable portion of Social Security benefits.
 *
 * Uses IRS provisional-income method:
 *   provisionalIncome = ordinaryIncome + 0.5 * ssIncome
 *
 * Tiers (thresholds are NOT inflation-indexed):
 *   - provisionalIncome <= tier1 → 0% taxable
 *   - provisionalIncome <= tier2 → up to 50% taxable
 *   - provisionalIncome >  tier2 → up to 85% taxable
 */
function calculateTaxableSS(
  ssIncome: number,
  ordinaryIncome: number,
  thresholds: { tier1: number; tier2: number },
): number {
  const provisionalIncome = ordinaryIncome + ssIncome * 0.5;

  if (provisionalIncome <= thresholds.tier1) {
    return 0;
  } else if (provisionalIncome <= thresholds.tier2) {
    const excess = provisionalIncome - thresholds.tier1;
    return Math.min(excess * 0.5, ssIncome * 0.5);
  } else {
    const tier1Amount = (thresholds.tier2 - thresholds.tier1) * 0.5;
    const tier2Excess = provisionalIncome - thresholds.tier2;
    return Math.min(tier1Amount + tier2Excess * 0.85, ssIncome * 0.85);
  }
}

/**
 * Calculate annual federal tax independently from the engine.
 *
 * @param ordinaryIncome  W-2, pension, interest, RMD income (sum of all non-SS, non-penalty)
 * @param ssIncome        Total Social Security benefits received
 * @param penaltyTotal    Early withdrawal penalty amounts (added on top of progressive tax)
 * @param filingStatus    Tax filing status
 * @param year            Calendar year for bracket lookup / inflation
 * @param inflationRate   Annual inflation rate for bracket threshold indexing
 * @param taxBrackets     Raw bracket data (from taxBrackets.json), keyed by year string
 *
 * @returns tax            Total federal tax (progressive + penalties)
 * @returns effectiveRate  tax / (ordinaryIncome + ssIncome), or 0 if no income
 * @returns ssTaxableAmount Portion of SS benefits subject to tax
 */
export function calculateAnnualFederalTax(
  ordinaryIncome: number,
  ssIncome: number,
  penaltyTotal: number,
  filingStatus: FilingStatus,
  year: number,
  inflationRate: number,
  taxBrackets: Record<string, any>,
): { tax: number; effectiveRate: number; ssTaxableAmount: number } {
  const yearData = getBracketDataForYear(year, inflationRate, taxBrackets);
  const brackets = yearData.brackets[filingStatus];
  const standardDeduction = yearData.standardDeduction[filingStatus];
  const ssThresholds = yearData.ssProvisionalThresholds[filingStatus];

  // Step 1: Determine taxable portion of Social Security
  const ssTaxableAmount = calculateTaxableSS(ssIncome, ordinaryIncome, ssThresholds);

  // Step 2: Gross income = ordinary + taxable SS
  const grossIncome = ordinaryIncome + ssTaxableAmount;

  // Step 3: Apply standard deduction
  const taxableIncome = Math.max(0, grossIncome - standardDeduction);

  // Step 4: Progressive tax on taxable income
  const progressiveTax = calculateProgressiveTax(taxableIncome, brackets);

  // Step 5: Total tax = progressive + penalties
  const totalTax = progressiveTax + penaltyTotal;

  // Step 6: Effective rate
  const totalIncome = ordinaryIncome + ssIncome;
  const effectiveRate = totalIncome > 0 ? totalTax / totalIncome : 0;

  return {
    tax: totalTax,
    effectiveRate,
    ssTaxableAmount,
  };
}
