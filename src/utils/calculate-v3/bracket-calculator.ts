import { readFileSync } from 'fs';
import { join } from 'path';

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

let bracketData: Record<string, YearBracketData> | null = null;

function loadBracketData(): Record<string, YearBracketData> {
  if (!bracketData) {
    const path = join(process.cwd(), 'data', 'taxBrackets.json');
    bracketData = JSON.parse(readFileSync(path, 'utf-8'));
  }
  return bracketData!;
}

// Get bracket data for a year — if year not in data, inflate from most recent year
function getBracketDataForYear(year: number, filingStatus: FilingStatus, inflationRate: number = 0.03): YearBracketData {
  const data = loadBracketData();
  if (data[String(year)]) return data[String(year)];

  // Find most recent available year
  const availableYears = Object.keys(data).map(Number).sort((a, b) => b - a);
  const baseYear = availableYears.find(y => y <= year) || availableYears[0];
  const baseData = data[String(baseYear)];
  const yearsToInflate = year - baseYear;

  if (yearsToInflate <= 0) return baseData;

  // Inflate bracket thresholds and standard deduction
  const inflationMultiplier = Math.pow(1 + inflationRate, yearsToInflate);
  const inflatedBrackets: Record<FilingStatus, TaxBracket[]> = {} as any;

  for (const status of ['single', 'mfj', 'mfs', 'hoh'] as FilingStatus[]) {
    inflatedBrackets[status] = baseData.brackets[status].map(b => ({
      min: Math.round(b.min * inflationMultiplier / 50) * 50, // Round to $50 (IRS convention)
      max: b.max ? Math.round(b.max * inflationMultiplier / 50) * 50 : null,
      rate: b.rate, // Rates don't inflate
    }));
  }

  const inflatedDeductions: Record<FilingStatus, number> = {} as any;
  for (const status of ['single', 'mfj', 'mfs', 'hoh'] as FilingStatus[]) {
    inflatedDeductions[status] = Math.round(baseData.standardDeduction[status] * inflationMultiplier / 50) * 50;
  }

  return {
    brackets: inflatedBrackets,
    standardDeduction: inflatedDeductions,
    ssProvisionalThresholds: baseData.ssProvisionalThresholds, // Never inflated
  };
}

// Calculate progressive tax on taxable income
export function calculateProgressiveTax(taxableIncome: number, brackets: TaxBracket[]): number {
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;
    const upper = bracket.max !== null ? Math.min(taxableIncome, bracket.max) : taxableIncome;
    tax += (upper - bracket.min) * bracket.rate;
  }
  return tax;
}

// Calculate taxable portion of Social Security income
export function calculateTaxableSS(
  ssIncome: number,
  otherIncome: number,
  filingStatus: FilingStatus,
  thresholds: { tier1: number; tier2: number },
): number {
  const provisionalIncome = otherIncome + ssIncome * 0.5;

  if (provisionalIncome <= thresholds.tier1) {
    return 0; // 0% of SS taxable
  } else if (provisionalIncome <= thresholds.tier2) {
    // Up to 50% of SS taxable
    const excess = provisionalIncome - thresholds.tier1;
    return Math.min(excess * 0.5, ssIncome * 0.5);
  } else {
    // Up to 85% of SS taxable
    const tier1Amount = (thresholds.tier2 - thresholds.tier1) * 0.5;
    const tier2Excess = provisionalIncome - thresholds.tier2;
    return Math.min(tier1Amount + tier2Excess * 0.85, ssIncome * 0.85);
  }
}

// Main function: compute total federal tax for a year
export function computeAnnualFederalTax(
  ordinaryIncome: number,      // Interest, withdrawals, RMDs, pension
  ssIncome: number,            // Social Security total
  filingStatus: FilingStatus,
  year: number,
  inflationRate: number = 0.03,
): { tax: number; effectiveRate: number; marginalRate: number; taxableIncome: number; taxableSS: number; standardDeduction: number; ssThresholds: { tier1: number; tier2: number } } {
  const yearData = getBracketDataForYear(year, filingStatus, inflationRate);
  const brackets = yearData.brackets[filingStatus];
  const standardDeduction = yearData.standardDeduction[filingStatus];
  const ssThresholds = yearData.ssProvisionalThresholds[filingStatus];

  // Calculate taxable SS
  const taxableSS = calculateTaxableSS(ssIncome, ordinaryIncome, filingStatus, ssThresholds);

  // Total gross income = ordinary + taxable SS
  const grossIncome = ordinaryIncome + taxableSS;

  // Apply standard deduction
  const taxableIncome = Math.max(0, grossIncome - standardDeduction);

  // Progressive tax
  const tax = calculateProgressiveTax(taxableIncome, brackets);

  // Rates
  const effectiveRate = grossIncome > 0 ? tax / grossIncome : 0;

  // Find marginal rate
  let marginalRate = 0;
  for (const bracket of brackets) {
    if (taxableIncome > bracket.min) {
      marginalRate = bracket.rate;
    }
  }

  return { tax, effectiveRate, marginalRate, taxableIncome, taxableSS, standardDeduction, ssThresholds };
}

// Export for testing
export { getBracketDataForYear, loadBracketData };
