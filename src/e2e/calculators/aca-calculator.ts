/**
 * Shadow calculator for ACA premium, couple premium, and subsidy logic.
 * No engine imports -- all data passed as parameters.
 */

const HEALTHCARE_INFLATION = 0.05;

/**
 * Calculate ACA monthly premium for a single person at a given age and year.
 *
 * Premium = benchmark(inflated to year at 5%) * (ageCurve[age] / ageCurve[40])
 * Age is clamped to 0-64; age >= 65 returns 0 (person is on Medicare).
 *
 * @param age - Person's age
 * @param year - Calendar year
 * @param benchmarkData - Map of year (string) -> benchmark premium (number)
 * @param ageCurve - Map of age (string) -> age curve factor (number)
 * @returns Monthly ACA premium for one person
 */
export function calculateAcaPremiumForPerson(
  age: number,
  year: number,
  benchmarkData: Record<string, number>,
  ageCurve: Record<string, number>,
): number {
  if (age >= 65) return 0;

  // Find the latest known benchmark year
  const knownYears = Object.keys(benchmarkData)
    .map(y => parseInt(y, 10))
    .sort((a, b) => b - a);

  if (knownYears.length === 0) return 0;

  const latestYear = knownYears[0];
  const latestPremium = benchmarkData[latestYear.toString()];

  // Inflate benchmark to requested year if needed
  let benchmarkForYear = latestPremium;
  if (year > latestYear) {
    for (let y = latestYear + 1; y <= year; y++) {
      benchmarkForYear *= 1 + HEALTHCARE_INFLATION;
    }
  }

  // Clamp age to 0-64 range
  const clampedAge = Math.min(Math.max(age, 0), 64);
  const ageFactor = ageCurve[clampedAge.toString()] || 1.0;
  const baseFactor = ageCurve['40'] || 1.278; // 40-year-old baseline

  const ageAdjustedFactor = ageFactor / baseFactor;
  const premium = benchmarkForYear * ageAdjustedFactor;

  return Math.round(premium * 100) / 100;
}

/**
 * Calculate combined gross ACA premium for a couple.
 * Skips any person aged 65+ (on Medicare).
 *
 * @param age1 - Age of first person
 * @param age2 - Age of second person
 * @param year - Calendar year
 * @param benchmarkData - Map of year (string) -> benchmark premium (number)
 * @param ageCurve - Map of age (string) -> age curve factor (number)
 * @returns Combined monthly ACA premium
 */
export function calculateCoupleGrossPremium(
  age1: number,
  age2: number,
  year: number,
  benchmarkData: Record<string, number>,
  ageCurve: Record<string, number>,
): number {
  const premium1 = age1 < 65 ? calculateAcaPremiumForPerson(age1, year, benchmarkData, ageCurve) : 0;
  const premium2 = age2 < 65 ? calculateAcaPremiumForPerson(age2, year, benchmarkData, ageCurve) : 0;
  return Math.round((premium1 + premium2) * 100) / 100;
}

/**
 * Calculate the monthly ACA subsidy based on MAGI vs Federal Poverty Level.
 *
 * FPL brackets:
 *   0-150%   FPL -> 0% contribution
 *   150-200% FPL -> 0% to 2% (linear)
 *   200-250% FPL -> 2% to 4% (linear)
 *   250-300% FPL -> 4% to 6% (linear)
 *   300-400% FPL -> 6% to 8.5% (linear)
 *   >400%   FPL -> cliff in 2026+ (no subsidy); 8.5% cap through 2025
 *
 * @param magi - Household Modified Adjusted Gross Income (annual)
 * @param householdSize - Number of people in household
 * @param year - Calendar year
 * @param fplData - Map of year (string) -> { firstPerson: number, additionalPerson: number }
 * @param grossMonthlyPremium - Gross monthly premium before subsidy
 * @returns Monthly subsidy amount
 */
export function calculateSubsidy(
  magi: number,
  householdSize: number,
  year: number,
  fplData: Record<string, { firstPerson: number; additionalPerson: number }>,
  grossMonthlyPremium: number,
): number {
  // Get FPL for this year (cap at latest available year)
  const availableYears = Object.keys(fplData).map(y => parseInt(y, 10));
  const fplYear = Math.min(year, Math.max(...availableYears));
  const fplForYear = fplData[fplYear.toString()];

  if (!fplForYear) return 0;

  // Calculate household FPL threshold
  const householdFPL = fplForYear.firstPerson + (householdSize - 1) * fplForYear.additionalPerson;

  // FPL percentage
  const fplPercent = (magi / householdFPL) * 100;

  // Determine expected contribution percentage
  let expectedContributionPct = 0;

  if (fplPercent <= 150) {
    expectedContributionPct = 0;
  } else if (fplPercent <= 200) {
    // Linear interpolation: 0% -> 2%
    expectedContributionPct = ((fplPercent - 150) / 50) * 0.02;
  } else if (fplPercent <= 250) {
    // Linear interpolation: 2% -> 4%
    expectedContributionPct = 0.02 + ((fplPercent - 200) / 50) * 0.02;
  } else if (fplPercent <= 300) {
    // Linear interpolation: 4% -> 6%
    expectedContributionPct = 0.04 + ((fplPercent - 250) / 50) * 0.02;
  } else if (fplPercent <= 400) {
    // Linear interpolation: 6% -> 8.5%
    expectedContributionPct = 0.06 + ((fplPercent - 300) / 100) * 0.025;
  } else if (year >= 2026) {
    // Cliff: 2026+ above 400% FPL = no subsidy
    return 0;
  } else {
    // Through 2025: 8.5% cap
    expectedContributionPct = 0.085;
  }

  // Monthly subsidy = max(0, grossPremium - expectedContribution/12)
  const expectedAnnualContribution = magi * expectedContributionPct;
  const monthlySubsidy = Math.max(0, grossMonthlyPremium - expectedAnnualContribution / 12);

  // Cap at gross premium
  return Math.min(monthlySubsidy, grossMonthlyPremium);
}
