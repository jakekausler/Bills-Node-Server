import { readFileSync } from 'fs';
import { join } from 'path';
import type { MCRateGetter } from './types';
import { MonteCarloSampleType } from './types';
import { compoundMCInflation } from './mc-utils';
import type { TaxScenario } from './tax-profile-types';

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

interface YearBracketData {
  brackets: Record<FilingStatus, TaxBracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  personalExemption: number;
  ssProvisionalThresholds: Record<FilingStatus, { tier1: number; tier2: number }>;
}

let bracketData: Record<string, YearBracketData> | null = null;
let currentScenario: TaxScenario = {
  name: 'currentPolicy',
  bracketEvolution: 'tcjaPermanent',
  customRates: null,
};

function loadBracketData(): Record<string, YearBracketData> {
  if (!bracketData) {
    const path = join(process.cwd(), 'data', 'taxBrackets.json');
    bracketData = JSON.parse(readFileSync(path, 'utf-8'));
  }
  return bracketData!;
}

/**
 * Set the tax scenario for bracket evolution in future years
 */
export function setTaxScenario(scenario: TaxScenario): void {
  currentScenario = scenario;
}

/**
 * Compute compound inflation multiplier from baseYear to targetYear.
 * Delegates to shared compoundMCInflation utility.
 */
function compoundInflationMultiplier(
  baseYear: number,
  targetYear: number,
  fixedRate: number,
  mcRateGetter?: MCRateGetter | null,
): number {
  return compoundMCInflation(baseYear, targetYear, fixedRate, mcRateGetter ?? null, MonteCarloSampleType.INFLATION);
}

// Get bracket data for a year — if year not in data, inflate from most recent year
// Scenario-aware: applies bracket evolution policy for future years
function getBracketDataForYear(
  year: number,
  filingStatus: FilingStatus,
  inflationRate: number = 0.03,
  mcRateGetter?: MCRateGetter | null,
): YearBracketData {
  const data = loadBracketData();
  if (data[String(year)]) return data[String(year)];

  // Find most recent available year
  const availableYears = Object.keys(data).map(Number).sort((a, b) => b - a);
  const baseYear = availableYears.find(y => y <= year) || availableYears[0];
  const baseData = data[String(baseYear)];
  const yearsToInflate = year - baseYear;

  if (yearsToInflate <= 0) return baseData;

  // Determine scenario-based bracket evolution
  let scenarioBaseYear = baseYear;
  let scenarioBaseData = baseData;

  if (currentScenario.bracketEvolution === 'tcjaExpires' && year >= 2026) {
    // For tcjaExpires: use 2017 pre-TCJA brackets as the base for future years
    scenarioBaseYear = 2017;
    scenarioBaseData = data['2017'];
    if (!scenarioBaseData) {
      // Fallback if 2017 data not available
      scenarioBaseData = baseData;
      scenarioBaseYear = baseYear;
    }
  }

  // Calculate inflation multiplier from scenario base year to target year
  let effectiveInflationRate = inflationRate;

  if (currentScenario.bracketEvolution === 'rateCreep') {
    // Rate creep: 80% of full inflation
    effectiveInflationRate = inflationRate * 0.8;
  }

  const inflationMultiplier = compoundInflationMultiplier(scenarioBaseYear, year, effectiveInflationRate, mcRateGetter);
  const inflatedBrackets: Record<FilingStatus, TaxBracket[]> = {} as any;

  for (const status of ['single', 'mfj', 'mfs', 'hoh'] as FilingStatus[]) {
    inflatedBrackets[status] = scenarioBaseData.brackets[status].map(b => {
      let multiplier = inflationMultiplier;

      // Apply custom bracket multiplier if specified
      if (currentScenario.bracketEvolution === 'custom' && currentScenario.customRates) {
        const customRate = currentScenario.customRates.find(r => r.year === year);
        if (customRate) {
          // For custom, use the bracket multiplier directly on thresholds
          multiplier = customRate.bracketMultiplier;
        }
      }

      return {
        min: Math.round(b.min * multiplier / 50) * 50, // Round to $50 (IRS convention)
        max: b.max ? Math.round(b.max * multiplier / 50) * 50 : null,
        rate: b.rate, // Rates don't inflate
      };
    });
  }

  // Handle standard deduction scenario logic
  let deductionData = scenarioBaseData;
  if (currentScenario.bracketEvolution === 'tcjaExpires' && year >= 2026) {
    // For tcjaExpires: revert to pre-TCJA standard deduction from 2017
    deductionData = data['2017'] || scenarioBaseData;
  }

  const inflatedDeductions: Record<FilingStatus, number> = {} as any;
  for (const status of ['single', 'mfj', 'mfs', 'hoh'] as FilingStatus[]) {
    let deductionMultiplier = inflationMultiplier;

    // For tcjaExpires with pre-2017 deduction base
    if (currentScenario.bracketEvolution === 'tcjaExpires' && year >= 2026) {
      deductionMultiplier = compoundInflationMultiplier(2017, year, effectiveInflationRate, mcRateGetter);
    }

    // Apply custom multiplier if specified
    if (currentScenario.bracketEvolution === 'custom' && currentScenario.customRates) {
      const customRate = currentScenario.customRates.find(r => r.year === year);
      if (customRate) {
        deductionMultiplier = customRate.bracketMultiplier;
      }
    }

    inflatedDeductions[status] = Math.round(deductionData.standardDeduction[status] * deductionMultiplier / 50) * 50;
  }

  // Compute personal exemption
  let personalExemption = 0;
  if (currentScenario.bracketEvolution === 'tcjaExpires' && year >= 2026) {
    // Personal exemption: $4,050 in 2017, inflated to target year
    const baseExemption = 4050; // 2017 value
    const exemptionMultiplier = compoundInflationMultiplier(2017, year, effectiveInflationRate, mcRateGetter);
    personalExemption = Math.round(baseExemption * exemptionMultiplier / 50) * 50;
  }

  return {
    brackets: inflatedBrackets,
    standardDeduction: inflatedDeductions,
    personalExemption,
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
  mcRateGetter?: MCRateGetter | null,
): { tax: number; effectiveRate: number; marginalRate: number; taxableIncome: number; taxableSS: number; standardDeduction: number; ssThresholds: { tier1: number; tier2: number } } {
  const yearData = getBracketDataForYear(year, filingStatus, inflationRate, mcRateGetter);
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
