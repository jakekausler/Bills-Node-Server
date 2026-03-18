import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { HistoricRates } from './types';
import { load } from '../io/io';
import type { DebugLogger } from './debug-logger';

dayjs.extend(utc);

// Module-level cache
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
 * ACA Manager: Handles COBRA, ACA Silver premiums, subsidies, and OOP costs
 * COBRA: first 18 months after retirement
 * ACA: month 19 until age 65
 * Subsidy calculation based on MAGI vs Federal Poverty Level (FPL)
 */
/**
 * Clears module-level cache for ACA historic rates.
 * Used by the cache-clear endpoint to force re-reads from disk.
 */
export function clearAcaCache() {
  cachedHistoricRates = null;
}

export class AcaManager {
  private readonly DEFAULT_HEALTHCARE_INFLATION = 0.05; // 5% default
  private debugLogger: DebugLogger | null;

  constructor(debugLogger?: DebugLogger | null) {
    // Constructor is minimal; historicRates loaded on-demand
    this.debugLogger = debugLogger ?? null;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(0, { component: 'aca', event, ...data });
  }

  /**
   * Get COBRA monthly premium
   * COBRA = 102% of employer premium, inflated at healthcare CPI
   * @param year - Year for which to get the premium
   * @returns Monthly COBRA premium
   */
  getCobraMonthlyPremium(year: number): number {
    const rates = getHistoricRates();
    const employerPremium = rates.employerPremium || {};

    // Get the base premium (2026 = $1,124.32)
    const basePremiumYear = '2026';
    const basePremium = employerPremium[basePremiumYear] as number | undefined;

    if (!basePremium) {
      return 0;
    }

    // Apply COBRA markup: 102% = 1.02x
    const cobraPremium = basePremium * 1.02;

    // Inflate forward from 2026 at 5% healthcare CPI
    if (year <= 2026) {
      return Math.round(cobraPremium * 100) / 100;
    }

    let inflatedPremium = cobraPremium;
    for (let y = 2027; y <= year; y++) {
      const inflationRate = this.getHealthcareInflationRate(y);
      inflatedPremium *= 1 + inflationRate;
    }

    return Math.round(inflatedPremium * 100) / 100;
  }

  /**
   * Get healthcare inflation rate for a given year
   * @private
   */
  private getHealthcareInflationRate(year: number): number {
    // TODO: #13 - Consider loading from configuration, for now use default 5%
    return this.DEFAULT_HEALTHCARE_INFLATION;
  }

  /**
   * Get ACA premium for one person at a given age
   * Premium = benchmark premium (age 40) * (ageCurve[age] / ageCurve[40])
   * @param age - Age of person
   * @param year - Year for which to get the premium
   * @returns Monthly ACA premium for one person
   */
  getAcaPremiumForPerson(age: number, year: number): number {
    const rates = getHistoricRates();
    const benchmarkData = rates.acaBenchmarkPremium || {};
    const ageCurveData = rates.acaAgeCurve || {};

    // Get benchmark premium from latest known year
    const knownBenchmarkYears = Object.keys(benchmarkData)
      .map(y => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownBenchmarkYears.length === 0) {
      return 0;
    }

    const latestBenchmarkYear = knownBenchmarkYears[0];
    const latestBenchmarkPremium = benchmarkData[latestBenchmarkYear.toString()] as number;

    // Inflate benchmark to requested year if needed
    let benchmarkForYear = latestBenchmarkPremium;
    if (year > latestBenchmarkYear) {
      for (let y = latestBenchmarkYear + 1; y <= year; y++) {
        const inflationRate = this.getHealthcareInflationRate(y);
        benchmarkForYear *= 1 + inflationRate;
      }
    }

    // Get age curve factors
    // Clamp age to available range (typically 0-64)
    const clampedAge = Math.min(Math.max(age, 0), 64);
    const ageStr = clampedAge.toString();
    const ageFactor = (ageCurveData[ageStr] as number) || 1.0;
    const baseFactor = (ageCurveData['40'] as number) || 1.278; // 40-year-old baseline

    // Calculate premium for this age
    const ageAdjustedFactor = ageFactor / baseFactor;
    const premiumForAge = benchmarkForYear * ageAdjustedFactor;

    return Math.round(premiumForAge * 100) / 100;
  }

  /**
   * Get combined ACA premium for a couple (two individual premiums)
   * Skips any person who is 65+ (on Medicare).
   * @param age1 - Age of first person
   * @param age2 - Age of second person
   * @param year - Year for which to get the premium
   * @returns Combined monthly ACA premium for couple
   */
  getAcaCoupleGrossPremium(age1: number, age2: number, year: number): number {
    const premium1 = age1 < 65 ? this.getAcaPremiumForPerson(age1, year) : 0;
    const premium2 = age2 < 65 ? this.getAcaPremiumForPerson(age2, year) : 0;
    return Math.round((premium1 + premium2) * 100) / 100;
  }

  /**
   * Calculate monthly ACA subsidy based on MAGI vs FPL
   * Uses IRA-enhanced brackets through 2025; cliff returns in 2026+
   * @param householdMAGI - Household Modified Adjusted Gross Income (annual)
   * @param householdSize - Number of people in household
   * @param year - Year for subsidy calculation
   * @param grossMonthlyPremium - Gross monthly premium (before subsidy)
   * @returns Monthly subsidy amount
   */
  calculateMonthlySubsidy(
    householdMAGI: number,
    householdSize: number,
    year: number,
    grossMonthlyPremium: number,
  ): number {
    const rates = getHistoricRates();
    const fplData = rates.fpl || {};

    // Get FPL for this year
    const fplYear = Math.min(year, Math.max(...Object.keys(fplData).map(y => parseInt(y, 10))));
    const fplForYear = fplData[fplYear.toString()] as {
      firstPerson: number;
      additionalPerson: number;
    } | undefined;

    if (!fplForYear) {
      return 0;
    }

    // Calculate household FPL
    const householdFPL = fplForYear.firstPerson +
      (householdSize - 1) * fplForYear.additionalPerson;

    // Calculate FPL percentage
    const fplPercent = (householdMAGI / householdFPL) * 100;

    // Determine expected contribution percentage based on FPL bracket
    let expectedContributionPct = 0;

    if (fplPercent <= 150) {
      expectedContributionPct = 0;
    } else if (fplPercent <= 200) {
      // Linear interpolation: 0% → 2%
      expectedContributionPct = ((fplPercent - 150) / 50) * 0.02;
    } else if (fplPercent <= 250) {
      // Linear interpolation: 2% → 4%
      expectedContributionPct = 0.02 + ((fplPercent - 200) / 50) * 0.02;
    } else if (fplPercent <= 300) {
      // Linear interpolation: 4% → 6%
      expectedContributionPct = 0.04 + ((fplPercent - 250) / 50) * 0.02;
    } else if (fplPercent <= 400) {
      // Linear interpolation: 6% → 8.5%
      expectedContributionPct = 0.06 + ((fplPercent - 300) / 100) * 0.025;
    } else if (year >= 2026) {
      // Cliff: 2026+ if > 400% FPL, no subsidy
      expectedContributionPct = 100; // No subsidy
    } else {
      // Through 2025: 8.5% cap at > 400% FPL
      expectedContributionPct = 0.085;
    }

    // If cliff applies, no subsidy
    if (expectedContributionPct >= 100) {
      return 0;
    }

    // Calculate expected annual contribution
    const expectedAnnualContribution = householdMAGI * expectedContributionPct;

    // Calculate monthly subsidy
    const monthlySubsidy = Math.max(0, grossMonthlyPremium - expectedAnnualContribution / 12);

    // Cap subsidy at gross premium
    return Math.min(monthlySubsidy, grossMonthlyPremium);
  }

  /**
   * Get net monthly ACA premium after subsidy
   * @param age1 - Age of first person
   * @param age2 - Age of second person
   * @param householdMAGI - Household Modified Adjusted Gross Income (annual)
   * @param householdSize - Number of people in household
   * @param year - Year for premium calculation
   * @returns Net monthly premium (gross - subsidy)
   */
  getNetMonthlyPremium(
    age1: number,
    age2: number,
    householdMAGI: number,
    householdSize: number,
    year: number,
  ): number {
    const grossPremium = this.getAcaCoupleGrossPremium(age1, age2, year);
    const subsidy = this.calculateMonthlySubsidy(householdMAGI, householdSize, year, grossPremium);
    return Math.max(0, grossPremium - subsidy);
  }

  /**
   * Determine if a date is within COBRA period (first 18 months after retirement)
   * @param retirementDate - Date of retirement
   * @param currentDate - Current date to check
   * @returns True if within COBRA period
   */
  isCobraPeriod(retirementDate: Date, currentDate: Date): boolean {
    const monthsElapsed = dayjs.utc(currentDate).diff(dayjs.utc(retirementDate), 'month');
    return monthsElapsed < 18;
  }

  /**
   * Get the number of persons on ACA (not yet on Medicare)
   * @param date - Current date
   * @param birthDate1 - Birth date of first person
   * @param birthDate2 - Birth date of second person
   * @returns 2 if both under 65, 1 if one on Medicare, 0 if both on Medicare
   */
  getAcaPersonCount(date: Date, birthDate1: Date, birthDate2: Date): number {
    const age1 = dayjs.utc(date).diff(dayjs.utc(birthDate1), 'year');
    const age2 = dayjs.utc(date).diff(dayjs.utc(birthDate2), 'year');

    let count = 0;
    if (age1 < 65) count++;
    if (age2 < 65) count++;
    return count;
  }

  /**
   * Get monthly healthcare premium (COBRA or ACA depending on period)
   * @param retirementDate - Date of retirement
   * @param currentDate - Current date
   * @param age1 - Age of first person
   * @param age2 - Age of second person
   * @param householdMAGI - Household Modified Adjusted Gross Income (annual)
   * @param householdSize - Number of people in household
   * @param year - Year for premium calculation
   * @returns Monthly healthcare premium
   */
  getMonthlyHealthcarePremium(
    retirementDate: Date,
    currentDate: Date,
    age1: number,
    age2: number,
    householdMAGI: number,
    householdSize: number,
    year: number,
  ): number {
    if (this.isCobraPeriod(retirementDate, currentDate)) {
      // COBRA period: return couple premium (COBRA applies to both)
      return this.getCobraMonthlyPremium(year);
    } else {
      // ACA period
      return this.getNetMonthlyPremium(age1, age2, householdMAGI, householdSize, year);
    }
  }

  /**
   * Get ACA Silver plan deductible
   * @param year - Year for which to get the deductible
   * @returns Object with individual and family deductibles
   */
  getAcaDeductible(year: number): { individual: number; family: number } {
    // Silver plan deductible ≈ 50% of OOP max; delegate inflation to getAcaOOPMax
    const oopMax = this.getAcaOOPMax(year);

    return {
      individual: Math.round(oopMax.individual * 0.5 * 100) / 100,
      family: Math.round(oopMax.family * 0.5 * 100) / 100,
    };
  }

  /**
   * Get ACA Silver plan out-of-pocket maximum
   * @param year - Year for which to get the OOP max
   * @returns Object with individual and family OOP max values
   */
  getAcaOOPMax(year: number): { individual: number; family: number } {
    const rates = getHistoricRates();
    const oopMaxData = rates.acaOutOfPocketMax || {};

    // Get the most recent OOP max data
    const knownYears = Object.keys(oopMaxData)
      .map(y => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownYears.length === 0) {
      return { individual: 9450, family: 18900 }; // Reasonable default for 2024
    }

    // Find the most recent year <= requested year
    let latestYear = knownYears[0];
    for (const ky of knownYears) {
      if (ky <= year) {
        latestYear = ky;
        break;
      }
    }

    const latestOOPMax = oopMaxData[latestYear.toString()] as {
      individual: number;
      family: number;
    } | undefined;

    if (!latestOOPMax) {
      return { individual: 9450, family: 18900 };
    }

    // If requesting a future year, inflate forward
    if (year > latestYear) {
      let individual = latestOOPMax.individual;
      let family = latestOOPMax.family;

      for (let y = latestYear + 1; y <= year; y++) {
        const inflationRate = this.getHealthcareInflationRate(y);
        individual *= 1 + inflationRate;
        family *= 1 + inflationRate;
      }

      return {
        individual: Math.round(individual * 100) / 100,
        family: Math.round(family * 100) / 100,
      };
    }

    return latestOOPMax;
  }
}
