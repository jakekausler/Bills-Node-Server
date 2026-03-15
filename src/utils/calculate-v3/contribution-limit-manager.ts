import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

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

// Annual inflation rate for contribution limits
const ANNUAL_INFLATION_RATE = 0.025; // 2.5%

export type ContributionLimitType = '401k' | 'ira' | 'hsa';

/**
 * Tracks annual contribution limits per person per limit type.
 * Handles IRS contribution limits with age-based catch-up provisions.
 */
export class ContributionLimitManager {
  // Map of personKey -> year -> limitType -> amount contributed
  private contributionsByPerson: Map<string, Map<number, Map<string, number>>> = new Map();

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
   * Inflate a base limit from 2024 to a given year
   */
  private inflateLimitToYear(baseLimit: number, targetYear: number): number {
    const yearsDiff = targetYear - 2024;
    if (yearsDiff <= 0) return baseLimit;
    return Math.round(baseLimit * Math.pow(1 + ANNUAL_INFLATION_RATE, yearsDiff));
  }

  /**
   * Get the base contribution limit for a given limit type, year, and age
   */
  private getBaseLimit(limitType: ContributionLimitType, year: number, ageAtYear: number): number {
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
   * Get the remaining contribution limit for a person in a given year
   */
  getRemainingLimit(
    personDOB: Date | null,
    year: number,
    limitType: ContributionLimitType,
  ): number {
    const personKey = this.createPersonKey(personDOB);

    if (!personDOB) {
      // If no DOB, cannot apply limits
      return Infinity;
    }

    const ageAtYear = this.getAgeAtYear(personDOB, year);
    const totalLimit = this.getBaseLimit(limitType, year, ageAtYear);

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
