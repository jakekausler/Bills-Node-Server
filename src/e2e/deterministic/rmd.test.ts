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

function ageAtEndOfYear(dob: string, year: number): number {
  const birthYear = parseInt(dob.substring(0, 4));
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
  describe('2043-01: Alice first RMD (age 73)', () => {
    const year = 2043;
    const aliceAge = ageAtEndOfYear(ALICE_DOB, year);

    it('Alice should be 73 in 2043', () => {
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

      // Find engine RMD activity in January (RMDs are taken in January)
      const rmdActivities = findRMDActivities('Alice 401(k)', `${year}-01`);
      expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

      // Engine RMD amount (negative = withdrawal) should match shadow
      const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
      expect(engineRMD).toBeCloseTo(expectedRMD, 0);
    });

    it('no Alice RMD should appear before 2043', () => {
      // Check 2042 — should have no RMD activity
      const activities2042 = getActivitiesInDateRange('Alice 401(k)', '2042-01-01', '2042-12-31');
      const rmdActivities = activities2042.filter(
        (a) => a.name.toUpperCase().includes('RMD') && a.amount < 0,
      );
      expect(rmdActivities).toHaveLength(0);
    });
  });

  describe('2046-01: Bob first RMD (age 73)', () => {
    const year = 2046;
    const bobAge = ageAtEndOfYear(BOB_DOB, year);

    it('Bob should be 73 in 2046', () => {
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

    it('no Bob RMD should appear before 2046', () => {
      const activities2045 = getActivitiesInDateRange('Bob 401(k)', '2045-01-01', '2045-12-31');
      const rmdActivities = activities2045.filter(
        (a) => a.name.toUpperCase().includes('RMD') && a.amount < 0,
      );
      expect(rmdActivities).toHaveLength(0);
    });
  });

  describe('2050-12: RMDs continue with updated ages and divisors', () => {
    const year = 2050;
    const aliceAge = ageAtEndOfYear(ALICE_DOB, year); // 80
    const bobAge = ageAtEndOfYear(BOB_DOB, year); // 77

    it('Alice should be 80 and Bob 77 in 2050', () => {
      expect(aliceAge).toBe(80);
      expect(bobAge).toBe(77);
    });

    it('Alice 401(k) 2050 RMD uses age-80 divisor', () => {
      const priorYearEndBalance = getMonthEndBalance('Alice 401(k)', `${year - 1}-12`);

      // Balance may be 0 if fully converted to Roth — only test if positive
      if (priorYearEndBalance > 0) {
        const expectedRMD = calculateRMD(priorYearEndBalance, aliceAge, rmdTable);
        expect(expectedRMD).toBeGreaterThan(0);

        const rmdActivities = findRMDActivities('Alice 401(k)', `${year}-01`);
        expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

        const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
        expect(engineRMD).toBeCloseTo(expectedRMD, 0);
      }
    });

    it('Bob 401(k) 2050 RMD uses age-77 divisor', () => {
      const priorYearEndBalance = getMonthEndBalance('Bob 401(k)', `${year - 1}-12`);

      if (priorYearEndBalance > 0) {
        const expectedRMD = calculateRMD(priorYearEndBalance, bobAge, rmdTable);
        expect(expectedRMD).toBeGreaterThan(0);

        const rmdActivities = findRMDActivities('Bob 401(k)', `${year}-01`);
        expect(rmdActivities.length).toBeGreaterThanOrEqual(1);

        const engineRMD = Math.abs(rmdActivities.reduce((sum, a) => sum + a.amount, 0));
        expect(engineRMD).toBeCloseTo(expectedRMD, 0);
      }
    });

    it('RMD divisor decreases with age (larger distribution fraction)', () => {
      // Age 73 divisor > age 80 divisor
      expect(rmdTable['73']).toBeGreaterThan(rmdTable['80']);
      // Age 77 divisor > age 80 divisor
      expect(rmdTable['77']).toBeGreaterThan(rmdTable['80']);
    });
  });
});
