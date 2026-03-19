import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getHealthcareActivities,
  getActivitiesInMonth,
} from '../helpers';
import {
  getExpectedMonthlyCost,
  getInsurancePremium,
} from '../calculators/ltc-calculator';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const ltcConfig: Array<{
  personName: string;
  gender: string;
  birthDateVariable: string;
  hasInsurance: boolean;
  insurancePurchaseAge: number;
  annualPremium: number;
  premiumInflationRate: number;
  dailyBenefitCap: number;
  benefitInflationRate: number;
  benefitPeriodYears: number;
  eliminationDays: number;
}> = JSON.parse(
  readFileSync(join(__dirname, '../../../data/ltcConfig.json'), 'utf-8'),
);

const ltcTransitions = JSON.parse(
  readFileSync(join(__dirname, '../../../data/ltcTransitions.json'), 'utf-8'),
);

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
const ALICE_BIRTH_YEAR = 1970; // born 1970-03-15 → turns 65 in 2035
const BOB_BIRTH_YEAR = 1973;   // born 1973-06-20 → turns 65 in 2038
const HEALTHCARE_INFLATION = 0.03;

const aliceConfig = ltcConfig.find((c) => c.personName === 'Alice')!;
const bobConfig = ltcConfig.find((c) => c.personName === 'Bob')!;

// LTC base costs (from engine defaults)
const LTC_BASE_COSTS = {
  homeCare: 6000,        // $6,000/month
  assistedLiving: 5000,  // $5,000/month
  nursingHome: 9500,     // $9,500/month
};
const LTC_BASE_YEAR = 2024;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('LTC (Long-Term Care)', () => {
  describe('Shadow calculator sanity checks', () => {
    it('should return 0 expected cost for age < 65', () => {
      const cost = getExpectedMonthlyCost(
        64,
        'female',
        2034,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      expect(cost).toBe(0);
    });

    it('should return positive expected cost for age >= 65', () => {
      const cost = getExpectedMonthlyCost(
        65,
        'female',
        2035,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      expect(cost).toBeGreaterThan(0);
    });

    it('should return 0 premium before purchase age', () => {
      const premium = getInsurancePremium(2025, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      // Alice born 1970, purchase age 60 → premiums start 2030
      // 2025 is before purchase age
      expect(premium).toBe(0);
    });

    it('should return positive premium at purchase age', () => {
      // Alice purchase year = 1970 + 60 = 2030
      const premium = getInsurancePremium(2030, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      expect(premium).toBeGreaterThan(0);
      // First year: $3,500 / 12 ≈ $291.67
      expect(premium).toBeCloseTo(aliceConfig.annualPremium / 12, 0);
    });
  });

  describe('2035-03: Alice turns 65 — LTC premiums active', () => {
    it('should compute Alice LTC insurance premium for 2035', () => {
      const premium = getInsurancePremium(2035, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      // 5 years after purchase (2030→2035), with 5% premium inflation
      const expectedAnnual = aliceConfig.annualPremium * Math.pow(1 + aliceConfig.premiumInflationRate, 5);
      const expectedMonthly = expectedAnnual / 12;
      expect(premium).toBeCloseTo(expectedMonthly, 0);
    });

    it('should have positive expected LTC cost for Alice at 65', () => {
      const cost = getExpectedMonthlyCost(
        65,
        'female',
        2035,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      // Expected cost is transition probability * inflated care costs
      expect(cost).toBeGreaterThan(0);
      // Should be modest at age 65 (low transition probabilities)
      expect(cost).toBeLessThan(500);
    });
  });

  describe('2035-12: LTC premium check', () => {
    it('should compute correct premium with inflation for Alice', () => {
      const premium = getInsurancePremium(2035, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      expect(premium).toBeGreaterThan(0);
      // 5 years of 5% inflation on $3,500/yr
      const inflatedAnnual = 3500 * Math.pow(1.05, 5);
      expect(premium).toBeCloseTo(inflatedAnnual / 12, 2);
    });

    it('should compute correct premium for Bob (not yet 65 but premiums started at 60)', () => {
      // Bob born 1973, purchase age 60 → premiums start 2033
      // 2035 is 2 years after purchase
      const premium = getInsurancePremium(2035, BOB_BIRTH_YEAR, {
        purchaseAge: bobConfig.insurancePurchaseAge,
        annualPremium: bobConfig.annualPremium,
        premiumInflationRate: bobConfig.premiumInflationRate,
      });
      const expectedAnnual = bobConfig.annualPremium * Math.pow(1 + bobConfig.premiumInflationRate, 2);
      expect(premium).toBeCloseTo(expectedAnnual / 12, 0);
    });

    it('should have both Alice and Bob paying LTC premiums in 2035', () => {
      const alicePremium = getInsurancePremium(2035, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      const bobPremium = getInsurancePremium(2035, BOB_BIRTH_YEAR, {
        purchaseAge: bobConfig.insurancePurchaseAge,
        annualPremium: bobConfig.annualPremium,
        premiumInflationRate: bobConfig.premiumInflationRate,
      });
      expect(alicePremium).toBeGreaterThan(0);
      expect(bobPremium).toBeGreaterThan(0);
      // Alice started earlier, so her premium should be higher due to more inflation
      expect(alicePremium).toBeGreaterThan(bobPremium);
    });
  });

  describe('2038-07: Bob turns 65 — Bob LTC expected cost begins', () => {
    it('should compute positive expected LTC cost for Bob at 65', () => {
      const cost = getExpectedMonthlyCost(
        65,
        'male',
        2038,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      expect(cost).toBeGreaterThan(0);
    });

    it('should have male transition probabilities higher than female for age 65-69', () => {
      // Male has higher transition rates in ltcTransitions
      const maleCost = getExpectedMonthlyCost(
        65,
        'male',
        2038,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      const femaleCost = getExpectedMonthlyCost(
        65,
        'female',
        2038,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      // Male healthy_to_homeCare (0.0008) > female (0.0006) for 65-69
      expect(maleCost).toBeGreaterThan(femaleCost);
    });

    it('should have Bob LTC premium inflated 5 years from purchase', () => {
      // Bob purchase year = 1973 + 60 = 2033; 2038 is 5 years later
      const premium = getInsurancePremium(2038, BOB_BIRTH_YEAR, {
        purchaseAge: bobConfig.insurancePurchaseAge,
        annualPremium: bobConfig.annualPremium,
        premiumInflationRate: bobConfig.premiumInflationRate,
      });
      const expectedAnnual = bobConfig.annualPremium * Math.pow(1 + bobConfig.premiumInflationRate, 5);
      expect(premium).toBeCloseTo(expectedAnnual / 12, 0);
    });
  });

  describe('2050-12: Both in later years — premium inflation verified', () => {
    it('should have significantly higher premiums in 2050 due to inflation', () => {
      // Alice: 2030→2050 = 20 years of 5% inflation
      const alicePremium2035 = getInsurancePremium(2035, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      const alicePremium2050 = getInsurancePremium(2050, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      // 15 years of 5% inflation → factor of ~2.08
      const expectedFactor = Math.pow(1.05, 15);
      const actualFactor = alicePremium2050 / alicePremium2035;
      expect(actualFactor).toBeCloseTo(expectedFactor, 1);
    });

    it('should have higher expected LTC costs at age 80 than 65', () => {
      const costAt65 = getExpectedMonthlyCost(
        65,
        'female',
        2035,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      const costAt80 = getExpectedMonthlyCost(
        80,
        'female',
        2050,
        ltcTransitions,
        LTC_BASE_COSTS,
        LTC_BASE_YEAR,
        HEALTHCARE_INFLATION,
      );
      // Higher age bracket has higher transition probabilities + more inflation
      expect(costAt80).toBeGreaterThan(costAt65);
    });

    it('should compute reasonable combined annual LTC premium for both in 2050', () => {
      const alicePremium = getInsurancePremium(2050, ALICE_BIRTH_YEAR, {
        purchaseAge: aliceConfig.insurancePurchaseAge,
        annualPremium: aliceConfig.annualPremium,
        premiumInflationRate: aliceConfig.premiumInflationRate,
      });
      const bobPremium = getInsurancePremium(2050, BOB_BIRTH_YEAR, {
        purchaseAge: bobConfig.insurancePurchaseAge,
        annualPremium: bobConfig.annualPremium,
        premiumInflationRate: bobConfig.premiumInflationRate,
      });
      const combinedAnnual = (alicePremium + bobPremium) * 12;
      // Should be substantial but not unreasonable
      expect(combinedAnnual).toBeGreaterThan(10000);
      expect(combinedAnnual).toBeLessThan(100000);
    });

    it('should show LTC expected costs increase with age bands', () => {
      // Verify monotonic increase across age bands for same gender/year
      const ages = [65, 70, 75, 80, 85, 90];
      const costs = ages.map((age) =>
        getExpectedMonthlyCost(
          age,
          'female',
          2050,
          ltcTransitions,
          LTC_BASE_COSTS,
          LTC_BASE_YEAR,
          HEALTHCARE_INFLATION,
        ),
      );
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeGreaterThan(costs[i - 1]);
      }
    });
  });
});
