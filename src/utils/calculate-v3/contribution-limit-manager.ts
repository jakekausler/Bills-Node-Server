import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { HistoricRates } from './types';
import { load } from '../io/io';

dayjs.extend(utc);

const BASE_LIMITS_2024 = {
  '401k': 23500,
  'ira': 7000,
  'hsa_individual': 4150,
  'hsa_family': 8300,
};

const CATCHUP_LIMITS_2024 = {
  '401k': 7500, // Age 50+
  'ira': 1000, // Age 50+
  'hsa': 1000, // Age 55+
};

// Annual inflation rate for contribution limits (fallback for future years)
const ANNUAL_INFLATION_RATE = 0.025; // 2.5%

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
 * Clears module-level cache for contribution limit historic rates.
 * Used by the cache-clear endpoint to force re-reads from disk.
 */
export function clearContributionLimitCache() {
  cachedHistoricRates = null;
}

export type ContributionLimitType = '401k' | 'ira' | 'hsa';

/**
 * Tracks annual contribution limits per person per limit type.
 * Handles IRS contribution limits with age-based catch-up provisions.
 */
export class ContributionLimitManager {
  // Map of personKey -> year -> limitType -> amount contributed
  private contributionsByPerson: Map<string, Map<number, Map<string, number>>> = new Map();
  // Cache of computed base limits (without catch-up) for MC ratio compounding
  private cachedBaseLimits: Map<string, number> = new Map();

  /**
   * Creates a person key from DOB for tracking contributions per person
   */
  private createPersonKey(dob: Date | null): string {
    if (!dob) return 'unknown';
    return dob.getTime().toString();
  }

  /**
   * Calculate the person's age at a given year
   */
  private getAgeAtYear(dob: Date, year: number): number {
    const birthYear = dob.getUTCFullYear();
    const birthMonth = dob.getUTCMonth();
    const birthDate = dob.getUTCDate();

    // Assume age reached by end of year
    let age = year - birthYear;
    // Check if birthday has passed by Dec 31
    if (birthMonth > 11 || (birthMonth === 11 && birthDate > 31)) {
      // Birthday hasn't passed yet by end of year
      age--;
    }
    return age;
  }

  /**
   * Get the historical limit for a given year, or null if not available
   */
  private getHistoricalLimit(limitType: ContributionLimitType, year: number): number | null {
    const historicRates = getHistoricRates();
    const yearStr = String(year);

    if (limitType === '401k' && historicRates.contributionLimits?.['401k']) {
      const limit = historicRates.contributionLimits['401k'][yearStr];
      return limit !== undefined ? limit : null;
    } else if (limitType === 'ira' && historicRates.contributionLimits?.['ira']) {
      const limit = historicRates.contributionLimits['ira'][yearStr];
      return limit !== undefined ? limit : null;
    } else if (limitType === 'hsa' && historicRates.contributionLimits?.['hsa']) {
      const limit = historicRates.contributionLimits['hsa'][yearStr];
      return limit !== undefined ? limit : null;
    }

    return null;
  }

  /**
   * Inflate a base limit from 2024 to a given year
   */
  private inflateLimitToYear(baseLimit: number, targetYear: number): number {
    const yearsDiff = targetYear - 2024;
    if (yearsDiff <= 0) return baseLimit;
    return Math.round(baseLimit * Math.pow(1 + ANNUAL_INFLATION_RATE, yearsDiff));
  }

  /**
   * Get the base contribution limit for a given limit type, year, and age
   * Optionally use a MC change ratio to compound from previous year
   */
  private getBaseLimit(limitType: ContributionLimitType, year: number, ageAtYear: number, mcChangeRatio?: number): number {
    // If MC ratio is provided, use it to compound from previous year
    if (mcChangeRatio !== undefined && year > 2024) {
      const cacheKey = `${limitType}_${year - 1}_base`;
      let prevBaseLimit = this.cachedBaseLimits.get(cacheKey);

      if (prevBaseLimit === undefined) {
        // Recursively compute previous year's base limit
        prevBaseLimit = this.getBaseLimit(limitType, year - 1, this.getAgeAtYearStatic(year - 1), undefined);
        this.cachedBaseLimits.set(cacheKey, prevBaseLimit);
      }

      const compoundedBase = Math.round(prevBaseLimit * mcChangeRatio);

      // Add catch-up for current year
      let totalLimit = compoundedBase;
      if (limitType === '401k' && ageAtYear >= 50) {
        totalLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['401k'], year);
      } else if (limitType === 'ira' && ageAtYear >= 50) {
        totalLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['ira'], year);
      } else if (limitType === 'hsa' && ageAtYear >= 55) {
        totalLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['hsa'], year);
      }

      return totalLimit;
    }

    // Try to get historical limit first
    const historicalLimit = this.getHistoricalLimit(limitType, year);
    if (historicalLimit !== null) {
      let baseLimit = historicalLimit;
      // Add catch-up if applicable (historical limits are base limits only)
      if (limitType === '401k' && ageAtYear >= 50) {
        baseLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['401k'], year);
      } else if (limitType === 'ira' && ageAtYear >= 50) {
        baseLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['ira'], year);
      } else if (limitType === 'hsa' && ageAtYear >= 55) {
        baseLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['hsa'], year);
      }
      return baseLimit;
    }

    // Fall back to inflation calculation
    let baseLimit = 0;

    if (limitType === '401k') {
      baseLimit = this.inflateLimitToYear(BASE_LIMITS_2024['401k'], year);
      if (ageAtYear >= 50) {
        baseLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['401k'], year);
      }
    } else if (limitType === 'ira') {
      baseLimit = this.inflateLimitToYear(BASE_LIMITS_2024['ira'], year);
      if (ageAtYear >= 50) {
        baseLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['ira'], year);
      }
    } else if (limitType === 'hsa') {
      baseLimit = this.inflateLimitToYear(BASE_LIMITS_2024['hsa_individual'], year);
      if (ageAtYear >= 55) {
        baseLimit += this.inflateLimitToYear(CATCHUP_LIMITS_2024['hsa'], year);
      }
    }

    return baseLimit;
  }

  /**
   * Static helper to compute age at a given year (no DOB context)
   */
  private getAgeAtYearStatic(year: number): number {
    // Return a representative age (50) for determining catch-up eligibility
    // This is used only in MC ratio compounding fallback
    return 50;
  }

  /**
   * Get the remaining contribution limit for a person in a given year
   * Optionally with MC change ratio for future year projections
   */
  getRemainingLimit(
    personDOB: Date | null,
    year: number,
    limitType: ContributionLimitType,
    mcChangeRatio?: number,
  ): number {
    const personKey = this.createPersonKey(personDOB);

    if (!personDOB) {
      // If no DOB, cannot apply limits
      return Infinity;
    }

    const ageAtYear = this.getAgeAtYear(personDOB, year);
    const totalLimit = this.getBaseLimit(limitType, year, ageAtYear, mcChangeRatio);

    const yearMap = this.contributionsByPerson.get(personKey);
    if (!yearMap || !yearMap.has(year)) {
      return totalLimit;
    }

    const yearContributions = yearMap.get(year);
    if (!yearContributions || !yearContributions.has(limitType)) {
      return totalLimit;
    }

    const alreadyContributed = yearContributions.get(limitType) || 0;
    return Math.max(0, totalLimit - alreadyContributed);
  }

  /**
   * Get the annual limit for a person in a given year (before any contributions)
   * Used by retirement and other managers to get the total limit
   * Optionally with MC change ratio for future year projections
   */
  getAnnualLimit(
    personDOB: Date | null,
    year: number,
    limitType: ContributionLimitType,
    mcChangeRatio?: number,
  ): number {
    if (!personDOB) {
      return Infinity;
    }

    const ageAtYear = this.getAgeAtYear(personDOB, year);
    return this.getBaseLimit(limitType, year, ageAtYear, mcChangeRatio);
  }

  /**
   * Record a contribution for a person in a given year
   */
  recordContribution(
    personDOB: Date | null,
    year: number,
    limitType: ContributionLimitType,
    amount: number,
  ): void {
    if (!personDOB || amount <= 0) {
      return;
    }

    const personKey = this.createPersonKey(personDOB);

    if (!this.contributionsByPerson.has(personKey)) {
      this.contributionsByPerson.set(personKey, new Map());
    }

    const yearMap = this.contributionsByPerson.get(personKey)!;
    if (!yearMap.has(year)) {
      yearMap.set(year, new Map());
    }

    const yearContributions = yearMap.get(year)!;
    const currentAmount = yearContributions.get(limitType) || 0;
    yearContributions.set(limitType, currentAmount + amount);
  }
}
