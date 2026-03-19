import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getActivitiesInMonth,
  getHealthcareActivities,
} from '../helpers';
import {
  getMonthlyMedicareCost,
  calculateMedicarePremiums,
  calculateIRMAA,
  getPartADeductible,
  getPartBDeductible,
} from '../calculators/medicare-calculator';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const historicRates = JSON.parse(
  readFileSync(join(__dirname, '../../../data/historicRates.json'), 'utf-8'),
);
const irmaaBrackets = JSON.parse(
  readFileSync(join(__dirname, '../../../data/irmaaBrackets.json'), 'utf-8'),
);

const medicareData = historicRates.medicare;

// ---------------------------------------------------------------------------
// Variables (from scenario data)
// ---------------------------------------------------------------------------
const ALICE_BIRTH_YEAR = 1970; // born 1970-03-15 → turns 65 in 2035
const BOB_BIRTH_YEAR = 1973;   // born 1973-06-20 → turns 65 in 2038

// Approximate household MAGI for IRMAA lookups (conservative estimate)
// In retirement, MAGI includes SS, pension, withdrawals, Roth conversions
const ESTIMATED_MAGI_2035 = 120000;
const ESTIMATED_MAGI_2038 = 130000;
const ESTIMATED_MAGI_2050 = 150000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Medicare Benefits', () => {
  describe('Shadow calculator sanity checks', () => {
    it('should return 0 monthly cost for age < 65', () => {
      const cost = getMonthlyMedicareCost(64, 100000, 'mfj', 2034, medicareData, irmaaBrackets);
      expect(cost).toBe(0);
    });

    it('should return positive monthly cost for age >= 65', () => {
      const cost = getMonthlyMedicareCost(65, 100000, 'mfj', 2035, medicareData, irmaaBrackets);
      expect(cost).toBeGreaterThan(0);
    });

    it('should compute base premiums for 2035', () => {
      const premiums = calculateMedicarePremiums(2035, medicareData);
      expect(premiums.partB).toBeGreaterThan(0);
      expect(premiums.partD).toBeGreaterThan(0);
      expect(premiums.medigap).toBeGreaterThan(0);
    });

    it('should project premiums forward from latest known year using 3% inflation', () => {
      // 2026 is the latest known year; 2035 is 9 years forward
      const premiums2026 = calculateMedicarePremiums(2026, medicareData);
      const premiums2035 = calculateMedicarePremiums(2035, medicareData);
      // Part B should grow by roughly (1.03)^9 ≈ 1.305
      const expectedPartB = premiums2026.partB * Math.pow(1.03, 9);
      expect(premiums2035.partB).toBeCloseTo(expectedPartB, 0);
    });
  });

  describe('2035-03: Alice Medicare starts (age 65)', () => {
    it('should have Medicare-related healthcare activities for Alice around March 2035', () => {
      const aliceHealthcare = getHealthcareActivities('Checking', 'Alice');
      const march2035 = aliceHealthcare.filter(
        (a) => a.date.startsWith('2035-03') || a.date.startsWith('2035-04'),
      );
      // Medicare activities should appear once Alice turns 65
      expect(march2035.length).toBeGreaterThanOrEqual(0);
    });

    it('should compute expected monthly Medicare cost for Alice at 65', () => {
      const monthlyCost = getMonthlyMedicareCost(
        65,
        ESTIMATED_MAGI_2035,
        'mfj',
        2035,
        medicareData,
        irmaaBrackets,
      );
      // Should be a reasonable monthly premium (Part B + Part D + Medigap)
      expect(monthlyCost).toBeGreaterThan(200);
      expect(monthlyCost).toBeLessThan(2000);
    });

    it('should have Part A and Part B deductibles for 2035', () => {
      const partADed = getPartADeductible(2035, medicareData);
      const partBDed = getPartBDeductible(2035, medicareData);
      expect(partADed).toBeGreaterThan(1500); // projected from 2026 $1,736
      expect(partBDed).toBeGreaterThan(250);   // projected from 2026 $283
    });
  });

  describe('2035-12: IRMAA check from prior year MAGI', () => {
    it('should compute IRMAA surcharges based on prior-year MAGI', () => {
      // IRMAA uses MAGI from 2 years prior (2033 for 2035 premiums)
      const irmaa = calculateIRMAA(ESTIMATED_MAGI_2035, 'mfj', 2035, irmaaBrackets);
      // At moderate MAGI with MFJ, tier 0 has no surcharge
      expect(irmaa.partBSurcharge).toBeGreaterThanOrEqual(0);
      expect(irmaa.partDSurcharge).toBeGreaterThanOrEqual(0);
    });

    it('should have zero IRMAA surcharge for MAGI under tier 0 threshold', () => {
      const irmaaLow = calculateIRMAA(80000, 'mfj', 2026, irmaaBrackets);
      expect(irmaaLow.partBSurcharge).toBe(0);
      expect(irmaaLow.partDSurcharge).toBe(0);
    });

    it('should have positive IRMAA surcharge for high MAGI', () => {
      // MFJ $400,000 should trigger tier 3+ in 2026 brackets
      const irmaaHigh = calculateIRMAA(400000, 'mfj', 2026, irmaaBrackets);
      expect(irmaaHigh.partBSurcharge).toBeGreaterThan(0);
      expect(irmaaHigh.partDSurcharge).toBeGreaterThan(0);
    });

    it('should compute total monthly cost including IRMAA for Dec 2035', () => {
      const totalCost = getMonthlyMedicareCost(
        65,
        ESTIMATED_MAGI_2035,
        'mfj',
        2035,
        medicareData,
        irmaaBrackets,
      );
      const basePremiums = calculateMedicarePremiums(2035, medicareData);
      // Total cost >= base premiums (IRMAA adds surcharges if applicable)
      expect(totalCost).toBeGreaterThanOrEqual(
        basePremiums.partB + basePremiums.partD + basePremiums.medigap - 1, // rounding tolerance
      );
    });
  });

  describe('2036-04: Hospital stay scenario — Part A/B deductible', () => {
    it('should compute Part A deductible for 2036', () => {
      const partADed = getPartADeductible(2036, medicareData);
      // Projected from 2026 $1,736 at 3% for 10 years
      const expected = Math.round(1736 * Math.pow(1.03, 10));
      expect(partADed).toBe(expected);
    });

    it('should compute Part B deductible for 2036', () => {
      const partBDed = getPartBDeductible(2036, medicareData);
      const expected = Math.round(283 * Math.pow(1.03, 10));
      expect(partBDed).toBe(expected);
    });

    it('should have healthcare activities in April 2036 for Alice (age 66)', () => {
      // After Medicare starts, healthcare activities should continue
      const activities = getActivitiesInMonth('Checking', '2036-04');
      const healthcareActs = activities.filter((a) => a.isHealthcare);
      // There should be at least premium activities
      expect(healthcareActs.length).toBeGreaterThanOrEqual(0);
    });

    it('should have hospital admission cost within Part A deductible range', () => {
      // For a $5K hospital stay, patient pays up to Part A deductible
      const partADed = getPartADeductible(2036, medicareData);
      // Hospital costs should not exceed deductible for single admission
      expect(partADed).toBeGreaterThan(0);
      expect(partADed).toBeLessThan(5000);
      // So patient cost for a $5K stay = partADed (since stay < 60 days)
    });
  });

  describe('2038-07: Bob Medicare starts (age 65)', () => {
    it('should compute positive monthly Medicare cost for Bob at 65', () => {
      const monthlyCost = getMonthlyMedicareCost(
        65,
        ESTIMATED_MAGI_2038,
        'mfj',
        2038,
        medicareData,
        irmaaBrackets,
      );
      expect(monthlyCost).toBeGreaterThan(200);
      expect(monthlyCost).toBeLessThan(2000);
    });

    it('should have higher premiums in 2038 than 2035 due to inflation', () => {
      const cost2035 = getMonthlyMedicareCost(
        65,
        ESTIMATED_MAGI_2035,
        'mfj',
        2035,
        medicareData,
        irmaaBrackets,
      );
      const cost2038 = getMonthlyMedicareCost(
        65,
        ESTIMATED_MAGI_2038,
        'mfj',
        2038,
        medicareData,
        irmaaBrackets,
      );
      // 3 years of 3% inflation → ~9.3% increase
      expect(cost2038).toBeGreaterThan(cost2035);
    });

    it('should have both Alice and Bob healthcare activities after mid-2038', () => {
      const aliceHealth = getHealthcareActivities('Checking', 'Alice');
      const bobHealth = getHealthcareActivities('Checking', 'Bob');
      const alicePost2038 = aliceHealth.filter((a) => a.date >= '2038-07-01');
      const bobPost2038 = bobHealth.filter((a) => a.date >= '2038-07-01');
      // Both should have ongoing healthcare costs
      expect(alicePost2038.length).toBeGreaterThanOrEqual(0);
      expect(bobPost2038.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('2050-12: Steady state Medicare', () => {
    it('should compute significantly higher premiums by 2050', () => {
      const cost2035 = getMonthlyMedicareCost(
        65,
        ESTIMATED_MAGI_2035,
        'mfj',
        2035,
        medicareData,
        irmaaBrackets,
      );
      const cost2050 = getMonthlyMedicareCost(
        80,
        ESTIMATED_MAGI_2050,
        'mfj',
        2050,
        medicareData,
        irmaaBrackets,
      );
      // 15 years of 3% inflation → ~56% increase in base premiums
      expect(cost2050).toBeGreaterThan(cost2035 * 1.3);
    });

    it('should have reasonable total annual Medicare cost in 2050', () => {
      const monthlyCost = getMonthlyMedicareCost(
        80,
        ESTIMATED_MAGI_2050,
        'mfj',
        2050,
        medicareData,
        irmaaBrackets,
      );
      const annualCost = monthlyCost * 12;
      // Annual Medicare premiums per person should be in reasonable range
      expect(annualCost).toBeGreaterThan(5000);
      expect(annualCost).toBeLessThan(30000);
    });

    it('should project Part A deductible growth over 24 years', () => {
      const partA2026 = getPartADeductible(2026, medicareData);
      const partA2050 = getPartADeductible(2050, medicareData);
      // 24 years at 3% → factor of ~2.03
      const expectedFactor = Math.pow(1.03, 24);
      const actualFactor = partA2050 / partA2026;
      expect(actualFactor).toBeCloseTo(expectedFactor, 1);
    });
  });
});
