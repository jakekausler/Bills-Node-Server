import { HistoricRates } from './types';
import { load } from '../io/io';

/**
 * IRMAA (Income-Related Monthly Adjustment Amount) bracket definition
 */
interface IRMABracket {
  maxIncome: number;
  partBSurcharge: number;
  partDSurcharge: number;
}

// Module-level cache for historic rates
let cachedHistoricRates: HistoricRates | null = null;

/**
 * Load historic rates from data file (cached at module level)
 */
function getHistoricRates(): HistoricRates {
  if (!cachedHistoricRates) {
    cachedHistoricRates = load<HistoricRates>('historicRates.json');
  }
  return cachedHistoricRates;
}

/**
 * Medicare manager for handling IRMAA surcharges, Part B/D premiums,
 * and hospital admission generation with Poisson distribution.
 */
export class MedicareManager {
  // 2024 IRMAA brackets for Married Filing Jointly
  // Based on IRS Modified Adjusted Gross Income (MAGI) thresholds
  private readonly IRMAA_BRACKETS_MFJ_2024: IRMABracket[] = [
    { maxIncome: 206000, partBSurcharge: 0, partDSurcharge: 0 },
    { maxIncome: 258000, partBSurcharge: 70.9, partDSurcharge: 12.9 },
    { maxIncome: 322000, partBSurcharge: 177, partDSurcharge: 33.3 },
    { maxIncome: 386000, partBSurcharge: 283.2, partDSurcharge: 53.8 },
    { maxIncome: 750000, partBSurcharge: 389.3, partDSurcharge: 74.2 },
    { maxIncome: Infinity, partBSurcharge: 419.3, partDSurcharge: 81 },
  ];

  // 2024 IRMAA brackets for Single
  private readonly IRMAA_BRACKETS_SINGLE_2024: IRMABracket[] = [
    { maxIncome: 137000, partBSurcharge: 0, partDSurcharge: 0 },
    { maxIncome: 171500, partBSurcharge: 70.9, partDSurcharge: 12.9 },
    { maxIncome: 214500, partBSurcharge: 177, partDSurcharge: 33.3 },
    { maxIncome: 257500, partBSurcharge: 283.2, partDSurcharge: 53.8 },
    { maxIncome: 500000, partBSurcharge: 389.3, partDSurcharge: 74.2 },
    { maxIncome: Infinity, partBSurcharge: 419.3, partDSurcharge: 81 },
  ];

  // Hospital admission rates (Poisson lambda) by age
  // Represents expected number of hospital admissions per year
  private readonly HOSPITAL_ADMISSION_RATES: Record<number, number> = {
    65: 0.15,
    70: 0.2,
    75: 0.25,
    80: 0.35,
    85: 0.45,
    90: 0.5,
  };

  // Default Medigap supplement premium (monthly, 2024)
  private readonly MEDIGAP_MONTHLY_PREMIUM_2024 = 200;

  constructor() {
    // Constructor is minimal; historicRates loaded on-demand via getHistoricRates()
  }

  /**
   * Get IRMAA bracket for a given income and filing status.
   * Assumes 2-year lookback (modified adjusted gross income from 2 years prior).
   */
  private getIRMABracket(magi: number, filingStatus: 'mfj' | 'single'): IRMABracket {
    const brackets = filingStatus === 'mfj' ? this.IRMAA_BRACKETS_MFJ_2024 : this.IRMAA_BRACKETS_SINGLE_2024;
    for (const bracket of brackets) {
      if (magi <= bracket.maxIncome) {
        return bracket;
      }
    }
    // Return highest bracket
    return brackets[brackets.length - 1];
  }

  /**
   * Get IRMAA surcharge for Part B and Part D based on MAGI and filing status.
   * Returns monthly surcharge amounts.
   */
  getIRMAASurcharge(
    magi: number,
    filingStatus: 'mfj' | 'single',
  ): { partBSurcharge: number; partDSurcharge: number } {
    const bracket = this.getIRMABracket(magi, filingStatus);
    return {
      partBSurcharge: bracket.partBSurcharge,
      partDSurcharge: bracket.partDSurcharge,
    };
  }

  /**
   * Get Part B premium for a given year (monthly amount in dollars).
   * Inflates from latest known data using healthcare CPI.
   */
  getPartBPremium(year: number): number {
    const rates = getHistoricRates();
    const medicare = rates.medicare || {};
    const partBPremiums = medicare.partBPremium || {};

    // Find the most recent known year
    const knownYears = Object.keys(partBPremiums)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownYears.length === 0) {
      // Default to approximately $174.70/month (2024 estimate)
      return 174.7;
    }

    const latestYear = knownYears[0];
    const latestPremium = partBPremiums[latestYear.toString()];

    if (year <= latestYear) {
      return partBPremiums[year.toString()] || latestPremium;
    }

    // Inflate forward using healthcare CPI (3% annual default)
    const yearsAfter = year - latestYear;

    let inflatedPremium = latestPremium;
    for (let i = 0; i < yearsAfter; i++) {
      const inflationRate = this.getHealthcareInflationRate(latestYear + i + 1);
      inflatedPremium *= 1 + inflationRate;
    }

    return Math.round(inflatedPremium * 100) / 100;
  }

  /**
   * Get Part D base premium for a given year (monthly amount in dollars).
   * Inflates from latest known data using healthcare CPI.
   */
  getPartDBasePremium(year: number): number {
    const rates = getHistoricRates();
    const medicare = rates.medicare || {};
    const partDPremiums = medicare.partDBasePremium || {};

    // Find the most recent known year
    const knownYears = Object.keys(partDPremiums)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownYears.length === 0) {
      // Default to approximately $36/month (2024 estimate)
      return 36;
    }

    const latestYear = knownYears[0];
    const latestPremium = partDPremiums[latestYear.toString()];

    if (year <= latestYear) {
      return partDPremiums[year.toString()] || latestPremium;
    }

    // Inflate forward using healthcare CPI (3% annual default)
    const yearsAfter = year - latestYear;

    let inflatedPremium = latestPremium;
    for (let i = 0; i < yearsAfter; i++) {
      const inflationRate = this.getHealthcareInflationRate(latestYear + i + 1);
      inflatedPremium *= 1 + inflationRate;
    }

    return Math.round(inflatedPremium * 100) / 100;
  }

  /**
   * Get Part A deductible (hospital inpatient deductible, per admission).
   * Inflates from latest known data using healthcare CPI.
   */
  getPartADeductible(year: number): number {
    const rates = getHistoricRates();
    const medicare = rates.medicare || {};
    const partADeductibles = medicare.partADeductible || {};

    // Find the most recent known year
    const knownYears = Object.keys(partADeductibles)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownYears.length === 0) {
      // Default to approximately $1600 per admission (2024 estimate)
      return 1600;
    }

    const latestYear = knownYears[0];
    const latestDeductible = partADeductibles[latestYear.toString()];

    if (year <= latestYear) {
      return partADeductibles[year.toString()] || latestDeductible;
    }

    // Inflate forward using healthcare CPI (3% annual default)
    const yearsAfter = year - latestYear;

    let inflatedDeductible = latestDeductible;
    for (let i = 0; i < yearsAfter; i++) {
      const inflationRate = this.getHealthcareInflationRate(latestYear + i + 1);
      inflatedDeductible *= 1 + inflationRate;
    }

    return Math.round(inflatedDeductible);
  }

  /**
   * Get Part B deductible (annual deductible for Part B services).
   * Inflates from latest known data using healthcare CPI.
   */
  getPartBDeductible(year: number): number {
    const rates = getHistoricRates();
    const medicare = rates.medicare || {};
    const partBDeductibles = medicare.partBDeductible || {};

    // Find the most recent known year
    const knownYears = Object.keys(partBDeductibles)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownYears.length === 0) {
      // Default to approximately $240 annually (2024 estimate)
      return 240;
    }

    const latestYear = knownYears[0];
    const latestDeductible = partBDeductibles[latestYear.toString()];

    if (year <= latestYear) {
      return partBDeductibles[year.toString()] || latestDeductible;
    }

    // Inflate forward using healthcare CPI (3% annual default)
    const yearsAfter = year - latestYear;

    let inflatedDeductible = latestDeductible;
    for (let i = 0; i < yearsAfter; i++) {
      const inflationRate = this.getHealthcareInflationRate(latestYear + i + 1);
      inflatedDeductible *= 1 + inflationRate;
    }

    return Math.round(inflatedDeductible);
  }

  /**
   * Calculate total monthly Medicare cost including Part B, Part D, Medigap,
   * and IRMAA surcharge based on prior-year MAGI.
   */
  getMonthlyMedicareCost(
    age: number,
    magi: number,
    filingStatus: 'mfj' | 'single',
    year: number,
  ): number {
    // If not yet 65, return 0
    if (age < 65) {
      return 0;
    }

    const partBPremium = this.getPartBPremium(year);
    const partDBasePremium = this.getPartDBasePremium(year);
    const medigapPremium = this.getMedigapMonthlyPremium(year);

    // Get IRMAA surcharge based on MAGI
    const { partBSurcharge, partDSurcharge } = this.getIRMAASurcharge(magi, filingStatus);

    const totalMonthly = partBPremium + partBSurcharge + partDBasePremium + partDSurcharge + medigapPremium;

    return Math.round(totalMonthly * 100) / 100;
  }

  /**
   * Get Medigap (supplement) monthly premium.
   * Inflates from 2024 base of ~$200/month using healthcare CPI.
   */
  private getMedigapMonthlyPremium(year: number): number {
    const baseYear = 2024;
    const basePremium = this.MEDIGAP_MONTHLY_PREMIUM_2024;

    if (year <= baseYear) {
      return basePremium;
    }

    // Inflate forward using healthcare CPI
    const yearsAfter = year - baseYear;
    let inflatedPremium = basePremium;

    for (let i = 0; i < yearsAfter; i++) {
      const inflationRate = this.getHealthcareInflationRate(baseYear + i + 1);
      inflatedPremium *= 1 + inflationRate;
    }

    return Math.round(inflatedPremium * 100) / 100;
  }

  /**
   * Get healthcare inflation rate for a given year.
   * Uses historical rates or defaults to 3%.
   */
  private getHealthcareInflationRate(year: number): number {
    const rates = getHistoricRates();
    const healthcareCpi = rates.healthcareCpi || {};
    const rateArray = healthcareCpi[year] || [];

    if (rateArray.length > 0) {
      // Use first element or calculate average
      return rateArray[0] / 100;
    }

    // Default 3% healthcare inflation
    return 0.03;
  }

  /**
   * Generate Poisson-distributed hospital admissions for a given age and year.
   * Used in Monte Carlo simulations. In deterministic mode, return the expected value.
   */
  generateHospitalAdmissions(age: number, year: number, random?: () => number): number {
    // Get lambda (expected admissions per year) based on age
    let lambda = 0.15; // Default

    // Find closest age bracket
    const ageKeys = Object.keys(this.HOSPITAL_ADMISSION_RATES)
      .map((k) => parseInt(k, 10))
      .sort((a, b) => a - b);

    for (let i = ageKeys.length - 1; i >= 0; i--) {
      if (age >= ageKeys[i]) {
        lambda = this.HOSPITAL_ADMISSION_RATES[ageKeys[i]];
        break;
      }
    }

    // If no random function provided, return expected value
    if (!random) {
      return Math.round(lambda);
    }

    // Generate Poisson random variable using Knuth's algorithm
    return this.poissonRandom(lambda, random);
  }

  /**
   * Poisson random variable generator (Knuth's algorithm).
   * Generates a random count from a Poisson distribution with parameter lambda.
   */
  private poissonRandom(lambda: number, random: () => number): number {
    let count = 0;
    let p = Math.exp(-lambda);
    let s = p;
    const u = random();

    while (u > s) {
      count++;
      p *= lambda / count;
      s += p;
    }

    return count;
  }
}
