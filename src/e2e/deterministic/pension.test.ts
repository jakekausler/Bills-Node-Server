import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getActivitiesInMonth } from '../helpers';
import {
  calculateHCA,
  calculateMonthlyPension,
  applyCOLA,
} from '../calculators/pension-calculator';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const pensionSSData = JSON.parse(
  readFileSync(join(__dirname, '../../../data/pension_and_social_security.json'), 'utf-8'),
);

const pensionConfig = pensionSSData.pensions[0]; // "Alice Pension"

// ---------------------------------------------------------------------------
// Variables (from variables.csv — Default column)
// ---------------------------------------------------------------------------
const RETIRE_DATE_YEAR = 2028; // 2028-07-01
const ALICE_WORK_START_YEAR = 2008; // 2008-07-01
const YEARS_WORKED = 20; // 2008-07-01 to 2028-07-01 = exactly 20 years
const ACCRUAL_RATE = pensionConfig.accrualFactor; // 0.015
const BEST_YEARS = pensionConfig.highestCompensationConsecutiveYearsToAverage; // 5
const COLA_TYPE = pensionConfig.cola.type as 'none' | 'fixed' | 'cpiLinked'; // 'fixed'
const COLA_FIXED_RATE = pensionConfig.cola.fixedRate; // 0.02
const RAISE_RATE = 0.03;
const ALICE_PAYCHECK_BIWEEKLY = 4200;

// ---------------------------------------------------------------------------
// Build Alice's annual incomes for HCA calculation
// Prior incomes from pension config + simulated paycheck income during 2025-2028
// ---------------------------------------------------------------------------
function buildAnnualIncomes(): Array<{ year: number; amount: number }> {
  const incomes: Array<{ year: number; amount: number }> = [];

  // Prior incomes from config
  for (let i = 0; i < pensionConfig.priorAnnualNetIncomeYears.length; i++) {
    incomes.push({
      year: pensionConfig.priorAnnualNetIncomeYears[i],
      amount: pensionConfig.priorAnnualNetIncomes[i],
    });
  }

  // Simulation-period earnings from biweekly paychecks with annual raises
  // Alice Paycheck: $4,200 biweekly from 2025-01-10, 3% raise on 01/01, ends 2028-07-01
  let currentAmount = ALICE_PAYCHECK_BIWEEKLY;
  for (let year = 2025; year <= 2027; year++) {
    if (year > 2025) {
      currentAmount *= 1 + RAISE_RATE;
    }
    // ~26 pay periods per year for biweekly
    const annualEstimate = currentAmount * 26;
    incomes.push({ year, amount: annualEstimate });
  }

  return incomes;
}

// ---------------------------------------------------------------------------
// Precompute expected pension
// ---------------------------------------------------------------------------
const annualIncomes = buildAnnualIncomes();

// HCA uses years strictly before workEndYear (2028)
const hca = calculateHCA(annualIncomes, BEST_YEARS, RETIRE_DATE_YEAR);

// Reduction factor = 1.0 (reducedRateByAgeThenYearsOfService is empty → defaults to 1)
const REDUCTION_FACTOR = 1.0;

// Monthly pension = (HCA * accrualRate * yearsWorked * reductionFactor) / 12
const expectedMonthlyPension = calculateMonthlyPension(hca, ACCRUAL_RATE, YEARS_WORKED, REDUCTION_FACTOR);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Pension Benefits', () => {
  describe('Shadow calculator sanity checks', () => {
    it('should compute a positive HCA from prior + simulated incomes', () => {
      expect(hca).toBeGreaterThan(0);
    });

    it('should compute HCA from the best 5 consecutive years', () => {
      // The best 5 consecutive years should include simulation-period incomes
      // which are higher than prior incomes (>$100K vs max $90K prior)
      // So HCA should be above the best prior-only average
      const priorOnly = calculateHCA(
        pensionConfig.priorAnnualNetIncomeYears.map((yr: number, i: number) => ({
          year: yr,
          amount: pensionConfig.priorAnnualNetIncomes[i],
        })),
        BEST_YEARS,
        RETIRE_DATE_YEAR,
      );
      expect(hca).toBeGreaterThanOrEqual(priorOnly);
    });

    it('should compute a reasonable monthly pension', () => {
      // Formula: HCA * 0.015 * 20 * 1.0 / 12
      // With HCA around $100K+, monthly should be around $2,500+
      expect(expectedMonthlyPension).toBeGreaterThan(2000);
      expect(expectedMonthlyPension).toBeLessThan(5000);
    });

    it('should have reduction factor of 1.0 (empty rate table)', () => {
      expect(REDUCTION_FACTOR).toBe(1);
    });
  });

  describe('2028-07: First pension payment', () => {
    it('should have Alice Pension activity in July 2028', () => {
      const activities = getActivitiesInMonth('Checking', '2028-07');
      const pensionActivities = activities.filter((a) => a.name.includes('Alice Pension'));
      expect(pensionActivities.length).toBeGreaterThanOrEqual(1);
    });

    it('should match shadow-calculated first payment within tolerance', () => {
      const activities = getActivitiesInMonth('Checking', '2028-07');
      const pensionActivity = activities.find((a) => a.name.includes('Alice Pension'));
      expect(pensionActivity).toBeDefined();
      const engineAmount = pensionActivity!.amount;

      // Allow 10% tolerance for paycheck accumulation differences
      expect(engineAmount).toBeGreaterThan(0);
      const tolerance = expectedMonthlyPension * 0.10;
      expect(engineAmount).toBeGreaterThan(expectedMonthlyPension - tolerance);
      expect(engineAmount).toBeLessThan(expectedMonthlyPension + tolerance);
    });
  });

  describe('2029-12: First COLA after ~1.5 years', () => {
    it('should have pension payment in December 2029', () => {
      const activities = getActivitiesInMonth('Checking', '2029-12');
      const pensionActivities = activities.filter((a) => a.name.includes('Alice Pension'));
      expect(pensionActivities.length).toBeGreaterThanOrEqual(1);
    });

    it('should show COLA-adjusted benefit after first year', () => {
      // First payment: July 2028. By December 2029, ~1 full year has passed.
      // COLA is applied annually (fixed 2%).
      const activities2028 = getActivitiesInMonth('Checking', '2028-07');
      const pension2028 = activities2028.find((a) => a.name.includes('Alice Pension'));
      expect(pension2028).toBeDefined();

      const activities2029 = getActivitiesInMonth('Checking', '2029-12');
      const pension2029 = activities2029.find((a) => a.name.includes('Alice Pension'));
      expect(pension2029).toBeDefined();

      // After 1 year of 2% COLA, benefit should increase
      const expectedWithCOLA = pension2028!.amount * (1 + COLA_FIXED_RATE!);
      expect(pension2029!.amount).toBeCloseTo(expectedWithCOLA, 0);
    });

    it('should match shadow COLA calculation', () => {
      const activities2029 = getActivitiesInMonth('Checking', '2029-12');
      const pension2029 = activities2029.find((a) => a.name.includes('Alice Pension'));
      expect(pension2029).toBeDefined();

      // 1 year of COLA from base
      const expected = applyCOLA(expectedMonthlyPension, COLA_TYPE, COLA_FIXED_RATE, 1);
      const tolerance = expected * 0.10;
      expect(pension2029!.amount).toBeGreaterThan(expected - tolerance);
      expect(pension2029!.amount).toBeLessThan(expected + tolerance);
    });
  });

  describe('2037-04: Pension + SS combined', () => {
    it('should have both pension and SS payments in April 2037', () => {
      const activities = getActivitiesInMonth('Checking', '2037-04');
      const pensionActivities = activities.filter((a) => a.name.includes('Alice Pension'));
      const ssActivities = activities.filter((a) => a.name.includes('Alice Social Security'));
      expect(pensionActivities.length).toBeGreaterThanOrEqual(1);
      expect(ssActivities.length).toBeGreaterThanOrEqual(1);
    });

    it('should have COLA-adjusted pension after ~9 years', () => {
      const activities = getActivitiesInMonth('Checking', '2037-04');
      const pension = activities.find((a) => a.name.includes('Alice Pension'));
      expect(pension).toBeDefined();

      // ~9 years of 2% COLA from July 2028
      const expected = applyCOLA(expectedMonthlyPension, COLA_TYPE, COLA_FIXED_RATE, 9);
      const tolerance = expected * 0.10;
      expect(pension!.amount).toBeGreaterThan(expected - tolerance);
      expect(pension!.amount).toBeLessThan(expected + tolerance);
    });

    it('should show pension amount growing steadily with COLA', () => {
      // Verify 2037 pension > 2029 pension (continuous COLA)
      const act2029 = getActivitiesInMonth('Checking', '2029-12');
      const act2037 = getActivitiesInMonth('Checking', '2037-04');
      const pension2029 = act2029.find((a) => a.name.includes('Alice Pension'));
      const pension2037 = act2037.find((a) => a.name.includes('Alice Pension'));
      expect(pension2029).toBeDefined();
      expect(pension2037).toBeDefined();
      expect(pension2037!.amount).toBeGreaterThan(pension2029!.amount);
    });
  });

  describe('2050-12: Many years of COLA', () => {
    it('should have pension payment with significant COLA growth', () => {
      const activities = getActivitiesInMonth('Checking', '2050-12');
      const pension = activities.find((a) => a.name.includes('Alice Pension'));
      expect(pension).toBeDefined();

      // ~22 years of 2% COLA from July 2028
      const expected = applyCOLA(expectedMonthlyPension, COLA_TYPE, COLA_FIXED_RATE, 22);
      const tolerance = expected * 0.10;
      expect(pension!.amount).toBeGreaterThan(expected - tolerance);
      expect(pension!.amount).toBeLessThan(expected + tolerance);
    });

    it('should show compound COLA growth over time', () => {
      // Verify 2050 pension > 2037 pension
      const act2037 = getActivitiesInMonth('Checking', '2037-04');
      const act2050 = getActivitiesInMonth('Checking', '2050-12');
      const pension2037 = act2037.find((a) => a.name.includes('Alice Pension'));
      const pension2050 = act2050.find((a) => a.name.includes('Alice Pension'));
      expect(pension2037).toBeDefined();
      expect(pension2050).toBeDefined();
      expect(pension2050!.amount).toBeGreaterThan(pension2037!.amount);

      // Growth factor should approximate (1.02)^13 ≈ 1.294
      const growthFactor = pension2050!.amount / pension2037!.amount;
      const expectedGrowth = Math.pow(1 + COLA_FIXED_RATE!, 13);
      expect(growthFactor).toBeCloseTo(expectedGrowth, 1);
    });
  });

  describe('2055-12: Late-stage pension payment', () => {
    it('should still have pension payment in December 2055', () => {
      const activities = getActivitiesInMonth('Checking', '2055-12');
      const pensionActivities = activities.filter((a) => a.name.includes('Alice Pension'));
      // Pension is a lifetime benefit — should continue
      expect(pensionActivities.length).toBeGreaterThanOrEqual(1);
    });

    it('should have COLA-adjusted amount after ~27 years', () => {
      const activities = getActivitiesInMonth('Checking', '2055-12');
      const pension = activities.find((a) => a.name.includes('Alice Pension'));
      expect(pension).toBeDefined();

      // ~27 years of 2% COLA from July 2028
      const expected = applyCOLA(expectedMonthlyPension, COLA_TYPE, COLA_FIXED_RATE, 27);
      const tolerance = expected * 0.10;
      expect(pension!.amount).toBeGreaterThan(expected - tolerance);
      expect(pension!.amount).toBeLessThan(expected + tolerance);
    });

    it('should show continued growth beyond 2050', () => {
      const act2050 = getActivitiesInMonth('Checking', '2050-12');
      const act2055 = getActivitiesInMonth('Checking', '2055-12');
      const pension2050 = act2050.find((a) => a.name.includes('Alice Pension'));
      const pension2055 = act2055.find((a) => a.name.includes('Alice Pension'));
      expect(pension2050).toBeDefined();
      expect(pension2055).toBeDefined();
      expect(pension2055!.amount).toBeGreaterThan(pension2050!.amount);

      // Growth factor should approximate (1.02)^5 ≈ 1.104
      const growthFactor = pension2055!.amount / pension2050!.amount;
      const expectedGrowth = Math.pow(1 + COLA_FIXED_RATE!, 5);
      expect(growthFactor).toBeCloseTo(expectedGrowth, 1);
    });
  });
});
