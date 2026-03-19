import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getYTDContributions, getActivitiesInDateRange } from '../helpers';
import { getAnnualLimit, getRemainingLimit } from '../calculators/contribution-calculator';

// Load contribution limits from historicRates.json
const historicRates = JSON.parse(
  readFileSync(join(__dirname, '../../../data/historicRates.json'), 'utf-8'),
);
const contributionLimits = historicRates.contributionLimits;

// Birth dates from variables.csv
const ALICE_DOB = '1970-03-15'; // age 55 in 2025
const BOB_DOB = '1973-06-20'; // age 52 in 2025

// Contribution amounts from variables.csv
const ALICE_401K_PER_PERIOD = 1800; // biweekly
const BOB_401K_PER_PERIOD = 600; // biweekly
const HSA_PER_MONTH = 170;

// Biweekly: ~26 pay periods per year
const BIWEEKLY_PERIODS_PER_YEAR = 26;

function ageAtEndOfYear(dob: string, year: number): number {
  const birthYear = parseInt(dob.substring(0, 4));
  return year - birthYear;
}

describe('Contribution Limits', () => {
  describe('Annual limit calculations (shadow calculator)', () => {
    it('should compute 401k limit for 2025 with catch-up for Alice (age 55)', () => {
      const age = ageAtEndOfYear(ALICE_DOB, 2025);
      expect(age).toBe(55);
      const limit = getAnnualLimit('401k', age, 2025, contributionLimits);
      // 2025 not in historicRates → fallback: 23500 * 1.025^1 = ~24088 rounded
      // Plus catch-up: 7500 * 1.025^1 = ~7688 rounded
      // Total ~31775
      expect(limit).toBeGreaterThan(23500);
      expect(limit).toBeLessThan(40000);
    });

    it('should compute 401k limit for 2025 with catch-up for Bob (age 52)', () => {
      const age = ageAtEndOfYear(BOB_DOB, 2025);
      expect(age).toBe(52);
      const limit = getAnnualLimit('401k', age, 2025, contributionLimits);
      // Bob is 50+ so gets catch-up too
      expect(limit).toBeGreaterThan(23500);
    });

    it('should compute HSA limit for 2025 — Alice age 55 gets catch-up', () => {
      const age = ageAtEndOfYear(ALICE_DOB, 2025);
      const limit = getAnnualLimit('hsa', age, 2025, contributionLimits);
      // HSA individual base ~4254 + catch-up ~1025 = ~5279
      expect(limit).toBeGreaterThan(4000);
      expect(limit).toBeLessThan(7000);
    });
  });

  describe('2025-01: First contributions', () => {
    it('should have Alice 401(k) contributions in January 2025', () => {
      const ytd = getYTDContributions('Alice 401(k)', 2025, 1);
      // At least 1 biweekly contribution (~$1,800) and possibly 2
      expect(ytd).toBeGreaterThan(0);
      expect(ytd).toBeLessThanOrEqual(ALICE_401K_PER_PERIOD * 3);
    });

    it('should have Bob 401(k) contributions in January 2025', () => {
      const ytd = getYTDContributions('Bob 401(k)', 2025, 1);
      expect(ytd).toBeGreaterThan(0);
      expect(ytd).toBeLessThanOrEqual(BOB_401K_PER_PERIOD * 3);
    });

    it('should have HSA contributions in January 2025', () => {
      const ytd = getYTDContributions('HSA', 2025, 1);
      expect(ytd).toBeGreaterThanOrEqual(HSA_PER_MONTH);
      expect(ytd).toBeLessThanOrEqual(HSA_PER_MONTH * 2);
    });
  });

  describe('2025-12: Year-end — Alice 401(k) should hit annual cap', () => {
    it('Alice 401(k) YTD contributions should be capped below uncapped amount', () => {
      const ytd = getYTDContributions('Alice 401(k)', 2025, 12);
      const aliceAge = ageAtEndOfYear(ALICE_DOB, 2025);
      const annualLimit = getAnnualLimit('401k', aliceAge, 2025, contributionLimits);

      // Uncapped amount: $1,800 * 26 periods = $46,800 — exceeds any 401k limit
      const uncapped = ALICE_401K_PER_PERIOD * BIWEEKLY_PERIODS_PER_YEAR;
      expect(uncapped).toBeGreaterThan(annualLimit);

      // Actual YTD must be capped at or below the annual limit
      expect(ytd).toBeLessThanOrEqual(annualLimit);
      expect(ytd).toBeGreaterThan(0);

      // The capped amount should be meaningfully less than the uncapped amount
      expect(ytd).toBeLessThan(uncapped);
    });

    it('Alice 401(k) remaining limit should be zero or near-zero at year end', () => {
      const ytd = getYTDContributions('Alice 401(k)', 2025, 12);
      const aliceAge = ageAtEndOfYear(ALICE_DOB, 2025);
      const remaining = getRemainingLimit(ytd, '401k', aliceAge, 2025, contributionLimits);
      // After a full year of $1,800 biweekly contributions, remaining should be small
      // (could be exactly 0 if last contribution was perfectly capped, or a small
      // residual if the last contribution was skipped/reduced)
      expect(remaining).toBeLessThan(ALICE_401K_PER_PERIOD);
    });

    it('Bob 401(k) YTD should be under the annual limit (not capped)', () => {
      const ytd = getYTDContributions('Bob 401(k)', 2025, 12);
      const bobAge = ageAtEndOfYear(BOB_DOB, 2025);
      const annualLimit = getAnnualLimit('401k', bobAge, 2025, contributionLimits);

      // Uncapped: $600 * 26 = $15,600 — well under any 401k limit
      const uncapped = BOB_401K_PER_PERIOD * BIWEEKLY_PERIODS_PER_YEAR;
      expect(uncapped).toBeLessThan(annualLimit);

      // YTD should be close to uncapped (all contributions went through)
      // Allow some tolerance for raise adjustments
      expect(ytd).toBeGreaterThan(uncapped * 0.8);
      expect(ytd).toBeLessThanOrEqual(annualLimit);
    });

    it('HSA YTD should be under the annual limit', () => {
      const ytd = getYTDContributions('HSA', 2025, 12);
      const aliceAge = ageAtEndOfYear(ALICE_DOB, 2025);
      const annualLimit = getAnnualLimit('hsa', aliceAge, 2025, contributionLimits);

      // $170/mo * 12 = $2,040 — well under HSA limit
      const uncapped = HSA_PER_MONTH * 12;
      expect(uncapped).toBeLessThan(annualLimit);

      // All contributions should have passed through
      expect(ytd).toBeGreaterThanOrEqual(uncapped * 0.9);
      expect(ytd).toBeLessThanOrEqual(annualLimit);
    });
  });

  describe('2028-07: Last contributions before retirement', () => {
    // Retirement date is 2028-07-01, so contributions stop mid-year

    it('Alice 401(k) contributions should stop at retirement', () => {
      const ytdJune = getYTDContributions('Alice 401(k)', 2028, 6);
      const ytdDec = getYTDContributions('Alice 401(k)', 2028, 12);

      // No contributions should occur after retirement (July 2028)
      // YTD through December should equal YTD through June (or July if last one lands early)
      expect(ytdDec).toBeCloseTo(ytdJune, -2); // within rounding
    });

    it('Alice 401(k) partial-year contributions should still respect annual limit', () => {
      const ytd = getYTDContributions('Alice 401(k)', 2028, 12);
      const aliceAge = ageAtEndOfYear(ALICE_DOB, 2028);
      const annualLimit = getAnnualLimit('401k', aliceAge, 2028, contributionLimits);
      expect(ytd).toBeLessThanOrEqual(annualLimit);
      expect(ytd).toBeGreaterThan(0);
    });

    it('Bob 401(k) contributions should stop at retirement', () => {
      const ytdJune = getYTDContributions('Bob 401(k)', 2028, 6);
      const ytdDec = getYTDContributions('Bob 401(k)', 2028, 12);
      expect(ytdDec).toBeCloseTo(ytdJune, -2);
    });

    it('HSA contributions should stop at retirement', () => {
      const ytdJune = getYTDContributions('HSA', 2028, 6);
      const ytdDec = getYTDContributions('HSA', 2028, 12);
      expect(ytdDec).toBeCloseTo(ytdJune, -2);
    });

    it('no 401(k) contributions should appear after 2028', () => {
      // Verify no contribution activities in 2029
      const alice2029 = getActivitiesInDateRange('Alice 401(k)', '2029-01-01', '2029-12-31');
      const aliceContribs = alice2029.filter((a) => a.name.includes('Contribution'));
      expect(aliceContribs).toHaveLength(0);

      const bob2029 = getActivitiesInDateRange('Bob 401(k)', '2029-01-01', '2029-12-31');
      const bobContribs = bob2029.filter((a) => a.name.includes('Contribution'));
      expect(bobContribs).toHaveLength(0);
    });
  });
});
