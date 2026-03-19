import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getMonthEndBalance,
  getActivitiesInMonth,
  getActivitiesInDateRange,
} from '../helpers';
import { calculateRMD } from '../calculators/rmd-calculator';

// Load IRS Uniform Lifetime Table
const rmdTable: Record<string, number> = JSON.parse(
  readFileSync(join(__dirname, '../../../data/rmd.json'), 'utf-8'),
);

// Birth dates from variables.csv
const ALICE_DOB = '1970-03-15'; // turns 73 in 2043
const BOB_DOB = '1973-06-20'; // turns 73 in 2046

/**
 * Age at end of year (calendar year minus birth year).
 */
function ageAtEndOfYear(dob: string, year: number): number {
  const birthYear = parseInt(dob.substring(0, 4));
  return year - birthYear;
}

/**
 * Age on January 1 of a given year — this is what the engine uses for RMD
 * event ownerAge (dayjs.utc(jan1).diff(dob, 'year')).
 * For someone born after Jan 1, this is one less than ageAtEndOfYear.
 */
function ageOnJan1(dob: string, year: number): number {
  const birthMonth = parseInt(dob.substring(5, 7));
  const birthDay = parseInt(dob.substring(8, 10));
  const birthYear = parseInt(dob.substring(0, 4));
  // On Jan 1 of `year`, if birthday is after Jan 1 the person hasn't turned yet
  if (birthMonth > 1 || (birthMonth === 1 && birthDay > 1)) {
    return year - birthYear - 1;
  }
  return year - birthYear;
}

/**
 * Find RMD withdrawal activities in a given month for a given account.
 * Engine names RMD activities with "RMD" in the name.
 */
function findRMDActivities(accountName: string, yearMonth: string) {
  return getActivitiesInMonth(accountName, yearMonth).filter(
    (a) => a.name.toUpperCase().includes('RMD') && a.amount < 0,
  );
}

describe('Required Minimum Distributions (RMD)', () => {
  describe('2044-01: Alice first RMD (age 73 on Jan 1)', () => {
    // Engine computes ownerAge via dayjs.utc(jan1).diff(dob, 'year').
    // Alice born 1970-03-15 → age on Jan 1, 2044 = 73 (first year in RMD table).
    const year = 2044;
    const aliceAge = ageOnJan1(ALICE_DOB, year);

    it('Alice should be 73 on Jan 1, 2044', () => {
      expect(aliceAge).toBe(73);
    });

    it('should have a divisor of 26.5 for age 73', () => {
      expect(rmdTable['73']).toBe(26.5);
    });

    it('Alice 401(k) RMD should match shadow calculation', () => {
      // Prior year-end balance (Dec 31 of year before RMD)
      const priorYearEndBalance = getMonthEndBalance('Alice 401(k)', `${year - 1}-12`);
      expect(priorYearEndBalance).toBeGreaterThan(0);

      // Shadow RMD calculation
      const expectedRMD = calculateRMD(priorYearEndBalance, aliceAge, rmdTable);
      expect(expectedRMD).toBeGreaterThan(0);

      // Find engine RMD activity in January (RMDs are taken on Jan 1)
      const rmdActivities = findRMDActivities('Alice 401(k)', `${year}-01`);
      expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

      // Engine RMD amount (negative = withdrawal) should match shadow
      const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
      expect(engineRMD).toBeCloseTo(expectedRMD, 0);
    });

    it('no Alice RMD should appear before 2044', () => {
      // Check 2043 — should have no RMD activity (Alice is only 72 on Jan 1, 2043)
      const activities2043 = getActivitiesInDateRange('Alice 401(k)', '2043-01-01', '2043-12-31');
      const rmdActivities = activities2043.filter(
        (a) => a.name.toUpperCase().includes('RMD') && a.amount < 0,
      );
      expect(rmdActivities).toHaveLength(0);
    });
  });

  describe('2047-01: Bob first RMD (age 73 on Jan 1)', () => {
    // Bob born 1973-06-20 → age on Jan 1, 2047 = 73 (first year in RMD table).
    const year = 2047;
    const bobAge = ageOnJan1(BOB_DOB, year);

    it('Bob should be 73 on Jan 1, 2047', () => {
      expect(bobAge).toBe(73);
    });

    it('Bob 401(k) RMD should match shadow calculation', () => {
      const priorYearEndBalance = getMonthEndBalance('Bob 401(k)', `${year - 1}-12`);
      expect(priorYearEndBalance).toBeGreaterThan(0);

      const expectedRMD = calculateRMD(priorYearEndBalance, bobAge, rmdTable);
      expect(expectedRMD).toBeGreaterThan(0);

      const rmdActivities = findRMDActivities('Bob 401(k)', `${year}-01`);
      expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

      const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
      expect(engineRMD).toBeCloseTo(expectedRMD, 0);
    });

    it('no Bob RMD should appear before 2047', () => {
      const activities2046 = getActivitiesInDateRange('Bob 401(k)', '2046-01-01', '2046-12-31');
      const rmdActivities = activities2046.filter(
        (a) => a.name.toUpperCase().includes('RMD') && a.amount < 0,
      );
      expect(rmdActivities).toHaveLength(0);
    });
  });

  describe('2050: RMDs continue with updated ages and divisors', () => {
    const year = 2050;
    // Engine uses age-on-Jan-1 for RMD lookup
    const aliceAge = ageOnJan1(ALICE_DOB, year); // 79
    const bobAge = ageOnJan1(BOB_DOB, year); // 76

    it('Alice should be 79 and Bob 76 on Jan 1, 2050', () => {
      expect(aliceAge).toBe(79);
      expect(bobAge).toBe(76);
    });

    it('Alice 401(k) 2050 RMD uses age-79 divisor', () => {
      const priorYearEndBalance = getMonthEndBalance('Alice 401(k)', `${year - 1}-12`);

      // Balance may be 0 if fully converted to Roth — only test if positive
      if (priorYearEndBalance > 0) {
        const expectedRMD = calculateRMD(priorYearEndBalance, aliceAge, rmdTable);
        expect(expectedRMD).toBeGreaterThan(0);

        const rmdActivities = findRMDActivities('Alice 401(k)', `${year}-01`);
        expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

        // Allow ~5% tolerance: the shadow calc uses Dec month-end balance while
        // the engine uses the running balance at the moment of Jan 1 processing,
        // which can differ due to other Jan 1 events (Roth conversions, tax, etc.)
        const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
        const pctDiff = Math.abs(engineRMD - expectedRMD) / expectedRMD;
        expect(pctDiff).toBeLessThan(0.05);
      }
    });

    it('Bob 401(k) 2050 RMD uses age-76 divisor', () => {
      const priorYearEndBalance = getMonthEndBalance('Bob 401(k)', `${year - 1}-12`);

      if (priorYearEndBalance > 0) {
        const expectedRMD = calculateRMD(priorYearEndBalance, bobAge, rmdTable);
        expect(expectedRMD).toBeGreaterThan(0);

        const rmdActivities = findRMDActivities('Bob 401(k)', `${year}-01`);
        expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

        const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
        const pctDiff = Math.abs(engineRMD - expectedRMD) / expectedRMD;
        expect(pctDiff).toBeLessThan(0.05);
      }
    });

    it('RMD divisor decreases with age (larger distribution fraction)', () => {
      // Age 73 divisor > age 79 divisor
      expect(rmdTable['73']).toBeGreaterThan(rmdTable['79']);
      // Age 76 divisor > age 79 divisor
      expect(rmdTable['76']).toBeGreaterThan(rmdTable['79']);
    });
  });
});
