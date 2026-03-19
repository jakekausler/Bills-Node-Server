/**
 * Shadow calculator for Medicare premiums, IRMAA surcharges, deductibles,
 * and hospital admission generation.
 * No engine imports -- all data passed as parameters.
 */

/**
 * IRMAA bracket definition (matches irmaaBrackets.json structure).
 */
interface IRMABracket {
  tier: number;
  singleMin: number;
  singleMax: number;
  marriedMin: number;
  marriedMax: number;
  partBPremium: number;
  partDSurcharge: number;
}

/**
 * Medicare data structure expected by these functions.
 * Each field maps year (string) -> value (number).
 * changeRatios maps field name -> { year -> ratio }.
 */
interface MedicareData {
  partBPremium: Record<string, number>;
  partDBasePremium: Record<string, number>;
  partADeductible: Record<string, number>;
  partBDeductible: Record<string, number>;
  medigapPlanG: Record<string, number>;
  changeRatios?: Record<string, Record<string, number>>;
}

// Default fallback values (2024 approximate)
const DEFAULTS: Record<string, number> = {
  partBPremium: 174.7,
  partDBasePremium: 36,
  partADeductible: 1600,
  partBDeductible: 240,
  medigapPlanG: 200,
};

// Medicare uses 3% healthcare inflation (per engine)
const MEDICARE_INFLATION = 0.03;

// Hospital admission rates (Poisson lambda) by age bracket
const HOSPITAL_ADMISSION_RATES: Record<number, number> = {
  65: 0.15,
  70: 0.2,
  75: 0.25,
  80: 0.35,
  85: 0.45,
  90: 0.5,
};

/**
 * Get a projected Medicare value for a given year using historical data and
 * optional change ratios. Falls back to 3% healthcare CPI inflation.
 */
function getMedicareValue(
  field: keyof Omit<MedicareData, 'changeRatios'>,
  year: number,
  medicareData: MedicareData,
): number {
  const data = medicareData[field] || {};
  const changeRatios = medicareData.changeRatios?.[field] || {};
  const defaultValue = DEFAULTS[field] || 0;

  const knownYears = Object.keys(data)
    .map(y => parseInt(y, 10))
    .sort((a, b) => b - a);

  if (knownYears.length === 0) return defaultValue;

  const latestYear = knownYears[0];
  const latestValue = data[latestYear.toString()];

  if (year <= latestYear) {
    return data[year.toString()] || latestValue;
  }

  // Project forward using change ratios, then fall back to CPI
  let projected = latestValue;
  for (let y = latestYear + 1; y <= year; y++) {
    const ratio = changeRatios[y.toString()];
    if (ratio) {
      projected *= ratio;
    } else {
      projected *= 1 + MEDICARE_INFLATION;
    }
  }

  return Math.round(projected * 100) / 100;
}

/**
 * Calculate base Medicare premiums (Part B, Part D, Medigap) for a year.
 *
 * @param year - Calendar year
 * @param medicareData - Historical Medicare data with optional change ratios
 * @returns Object with partB, partD, and medigap monthly premiums
 */
export function calculateMedicarePremiums(
  year: number,
  medicareData: MedicareData,
): { partB: number; partD: number; medigap: number } {
  return {
    partB: getMedicareValue('partBPremium', year, medicareData),
    partD: getMedicareValue('partDBasePremium', year, medicareData),
    medigap: getMedicareValue('medigapPlanG', year, medicareData),
  };
}

/**
 * Calculate IRMAA surcharges for Part B and Part D based on MAGI and filing status.
 * Surcharge = matched bracket premium - base bracket (tier 0) premium.
 *
 * @param magi - Modified Adjusted Gross Income
 * @param filingStatus - 'mfj' (married filing jointly) or 'single'
 * @param year - Calendar year
 * @param irmaaBrackets - Map of year (string) -> IRMABracket[]
 * @returns Monthly Part B and Part D surcharge amounts
 */
export function calculateIRMAA(
  magi: number,
  filingStatus: 'mfj' | 'single',
  year: number,
  irmaaBrackets: Record<string, IRMABracket[]>,
): { partBSurcharge: number; partDSurcharge: number } {
  // Find the appropriate year bracket set
  let yearStr = year.toString();
  if (!(yearStr in irmaaBrackets)) {
    const availableYears = Object.keys(irmaaBrackets)
      .map(y => parseInt(y, 10))
      .sort((a, b) => b - a);
    for (const ay of availableYears) {
      if (ay <= year) {
        yearStr = ay.toString();
        break;
      }
    }
    if (!(yearStr in irmaaBrackets)) {
      yearStr = availableYears[0].toString();
    }
  }

  const brackets = irmaaBrackets[yearStr] || [];
  const minField = filingStatus === 'mfj' ? 'marriedMin' : 'singleMin';
  const maxField = filingStatus === 'mfj' ? 'marriedMax' : 'singleMax';

  // Find matching bracket
  let matched: IRMABracket | null = null;
  for (const bracket of brackets) {
    if (magi >= bracket[minField] && magi <= bracket[maxField]) {
      matched = bracket;
      break;
    }
  }

  // If income exceeds all brackets, use the highest
  if (!matched) {
    matched = brackets[brackets.length - 1];
  }

  if (!matched) {
    return { partBSurcharge: 0, partDSurcharge: 0 };
  }

  // Surcharge = matched - base (tier 0)
  const base = brackets[0];
  const basePremium = base?.partBPremium || 0;
  const basePartD = base?.partDSurcharge || 0;

  return {
    partBSurcharge: Math.max(0, (matched.partBPremium || 0) - basePremium),
    partDSurcharge: (matched.partDSurcharge || 0) - basePartD,
  };
}

/**
 * Get total monthly Medicare cost for one person, including Part B, Part D,
 * Medigap, and IRMAA surcharges. Returns 0 if age < 65.
 *
 * @param age - Person's age
 * @param magi - Modified Adjusted Gross Income
 * @param filingStatus - 'mfj' or 'single'
 * @param year - Calendar year
 * @param medicareData - Historical Medicare data
 * @param irmaaBrackets - IRMAA bracket data
 * @returns Total monthly Medicare cost
 */
export function getMonthlyMedicareCost(
  age: number,
  magi: number,
  filingStatus: 'mfj' | 'single',
  year: number,
  medicareData: MedicareData,
  irmaaBrackets: Record<string, IRMABracket[]>,
): number {
  if (age < 65) return 0;

  const premiums = calculateMedicarePremiums(year, medicareData);
  const irmaa = calculateIRMAA(magi, filingStatus, year, irmaaBrackets);

  const total = premiums.partB + irmaa.partBSurcharge
    + premiums.partD + irmaa.partDSurcharge
    + premiums.medigap;

  return Math.round(total * 100) / 100;
}

/**
 * Generate expected hospital admissions for a given age (deterministic mode).
 * Uses Poisson lambda values by age bracket, returns Math.round(lambda).
 *
 * @param age - Person's age
 * @param year - Calendar year (unused, for API compatibility)
 * @returns Expected number of hospital admissions (rounded lambda)
 */
export function generateHospitalAdmissions(age: number, _year: number): number {
  let lambda = 0.15; // Default

  const ageKeys = Object.keys(HOSPITAL_ADMISSION_RATES)
    .map(k => parseInt(k, 10))
    .sort((a, b) => a - b);

  for (let i = ageKeys.length - 1; i >= 0; i--) {
    if (age >= ageKeys[i]) {
      lambda = HOSPITAL_ADMISSION_RATES[ageKeys[i]];
      break;
    }
  }

  return Math.round(lambda);
}

/**
 * Get Part A deductible (per hospital admission) for a given year.
 *
 * @param year - Calendar year
 * @param medicareData - Historical Medicare data
 * @returns Part A deductible amount
 */
export function getPartADeductible(year: number, medicareData: MedicareData): number {
  return Math.round(getMedicareValue('partADeductible', year, medicareData));
}

/**
 * Get Part B deductible (annual) for a given year.
 *
 * @param year - Calendar year
 * @param medicareData - Historical Medicare data
 * @returns Part B deductible amount
 */
export function getPartBDeductible(year: number, medicareData: MedicareData): number {
  return Math.round(getMedicareValue('partBDeductible', year, medicareData));
}
