import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getActivitiesInMonth,
  getActivitiesByName,
  getActivitiesInDateRange,
} from '../helpers';
import {
  calculateAIME,
  calculatePIA,
  getFullRetirementAge,
  applyFRAFactor,
  applyCOLA,
  calculateSpousalBenefit,
} from '../calculators/ss-calculator';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const wageIndex: Record<string, number> = JSON.parse(
  readFileSync(join(__dirname, '../../../data/averageWageIndex.json'), 'utf-8'),
);
const bendPoints: Record<string, { first: number; second: number }> = JSON.parse(
  readFileSync(join(__dirname, '../../../data/bendPoints.json'), 'utf-8'),
);
const historicRates = JSON.parse(
  readFileSync(join(__dirname, '../../../data/historicRates.json'), 'utf-8'),
);
const pensionSSData = JSON.parse(
  readFileSync(join(__dirname, '../../../data/pension_and_social_security.json'), 'utf-8'),
);

// SS wage base caps (top-level key in historicRates)
const wageBaseCaps: Record<number, number> = {};
for (const [yr, cap] of Object.entries(historicRates.ssWageBase as Record<string, number>)) {
  wageBaseCaps[Number(yr)] = cap;
}

// ---------------------------------------------------------------------------
// Variables (from variables.csv — Default column)
// ---------------------------------------------------------------------------
const SS_COLA_RATE = 0.025;
const ALICE_BIRTH_YEAR = 1970; // 1970-03-15
const ALICE_SS_START = '2037-03-15'; // claiming at exactly 67 (FRA)
const BOB_BIRTH_YEAR = 1973; // 1973-06-20
const BOB_SS_START = '2040-06-20'; // claiming at exactly 67 (FRA)
const RAISE_RATE = 0.03;
const ALICE_PAYCHECK_BIWEEKLY = 4200; // $4,200 every 2 weeks
const BOB_PAYCHECK_BIWEEKLY = 2800; // $2,800 every 2 weeks
const RETIRE_DATE = '2028-07-01';

// ---------------------------------------------------------------------------
// Build Alice's earnings history (prior + simulated paychecks)
// ---------------------------------------------------------------------------
const aliceSSConfig = pensionSSData.socialSecurities.find(
  (s: any) => s.name === 'Alice Social Security',
)!;

function buildAliceEarnings(): Record<number, number> {
  const earnings: Record<number, number> = {};

  // Prior incomes from config
  for (let i = 0; i < aliceSSConfig.priorAnnualNetIncomeYears.length; i++) {
    earnings[aliceSSConfig.priorAnnualNetIncomeYears[i]] =
      aliceSSConfig.priorAnnualNetIncomes[i];
  }

  // Simulation-period earnings from biweekly paychecks with annual raises
  // Alice Paycheck: $4,200 biweekly from 2025-01-10, 3% raise on 01/01 each year, ends 2028-07-01
  // ~26 pay periods per year
  let currentAmount = ALICE_PAYCHECK_BIWEEKLY;
  for (let year = 2025; year <= 2028; year++) {
    if (year > 2025) {
      currentAmount *= 1 + RAISE_RATE;
    }
    // Count pay periods in this year
    const startDate = year === 2025 ? new Date(2025, 0, 10) : new Date(year, 0, 1);
    const endDate =
      year === 2028
        ? new Date(2028, 6, 1) // July 1 retirement
        : new Date(year, 11, 31);

    let payDate = new Date(2025, 0, 10); // first pay date
    // Advance to the start of the year
    while (payDate < startDate) {
      payDate.setDate(payDate.getDate() + 14);
    }

    let yearTotal = 0;
    while (payDate <= endDate) {
      // Apply the raise for the current year
      const payYear = payDate.getFullYear();
      if (payYear === year) {
        yearTotal += currentAmount;
      }
      payDate.setDate(payDate.getDate() + 14);
    }
    if (yearTotal > 0) {
      earnings[year] = yearTotal;
    }
  }

  return earnings;
}

// ---------------------------------------------------------------------------
// Build Bob's earnings history
// ---------------------------------------------------------------------------
const bobSSConfig = pensionSSData.socialSecurities.find(
  (s: any) => s.name === 'Bob Social Security',
)!;

function buildBobEarnings(): Record<number, number> {
  const earnings: Record<number, number> = {};
  for (let i = 0; i < bobSSConfig.priorAnnualNetIncomeYears.length; i++) {
    earnings[bobSSConfig.priorAnnualNetIncomeYears[i]] =
      bobSSConfig.priorAnnualNetIncomes[i];
  }

  // Simulation-period earnings from biweekly paychecks with annual raises
  // Bob Paycheck: $2,800 biweekly from 2025-01-10, 3% raise on 01/01, ends 2028-07-01
  let currentAmount = BOB_PAYCHECK_BIWEEKLY;
  for (let year = 2025; year <= 2028; year++) {
    if (year > 2025) {
      currentAmount *= 1 + RAISE_RATE;
    }
    const startDate = year === 2025 ? new Date(2025, 0, 10) : new Date(year, 0, 1);
    const endDate =
      year === 2028
        ? new Date(2028, 6, 1) // July 1 retirement
        : new Date(year, 11, 31);

    let payDate = new Date(2025, 0, 10); // first pay date
    while (payDate < startDate) {
      payDate.setDate(payDate.getDate() + 14);
    }

    let yearTotal = 0;
    while (payDate <= endDate) {
      const payYear = payDate.getFullYear();
      if (payYear === year) {
        yearTotal += currentAmount;
      }
      payDate.setDate(payDate.getDate() + 14);
    }
    if (yearTotal > 0) {
      earnings[year] = (earnings[year] || 0) + yearTotal;
    }
  }

  return earnings;
}

// ---------------------------------------------------------------------------
// Precompute expected benefits
// ---------------------------------------------------------------------------

// Alice: born 1970, turns 60 in 2030, turns 62 in 2032, FRA at 67 (2037)
const aliceYearTurn60 = ALICE_BIRTH_YEAR + 60; // 2030
const aliceYearTurn62 = ALICE_BIRTH_YEAR + 62; // 2032
const aliceFRA = getFullRetirementAge(ALICE_BIRTH_YEAR);

const aliceEarnings = buildAliceEarnings();
const aliceAIME = calculateAIME(aliceEarnings, aliceYearTurn60, wageIndex, wageBaseCaps);
const alicePIA = calculatePIA(aliceAIME, aliceYearTurn62, bendPoints);
// Claiming at 67 = FRA → factor = 1.0
const aliceClaimingAge = 67;
const aliceMonthlyBenefit = applyFRAFactor(alicePIA, aliceClaimingAge, ALICE_BIRTH_YEAR);

// Bob: born 1973, turns 60 in 2033, turns 62 in 2035, FRA at 67 (2040)
const bobYearTurn60 = BOB_BIRTH_YEAR + 60; // 2033
const bobYearTurn62 = BOB_BIRTH_YEAR + 62; // 2035
const bobFRA = getFullRetirementAge(BOB_BIRTH_YEAR);

const bobEarnings = buildBobEarnings();
const bobAIME = calculateAIME(bobEarnings, bobYearTurn60, wageIndex, wageBaseCaps);
const bobPIA = calculatePIA(bobAIME, bobYearTurn62, bendPoints);
const bobClaimingAge = 67;
const bobOwnBenefit = applyFRAFactor(bobPIA, bobClaimingAge, BOB_BIRTH_YEAR);
// Spousal check: Bob gets max(own benefit, 50% of Alice's benefit at Bob's claiming time)
// Alice's benefit at the time Bob claims (2040) has had COLA applied for 3 years (2037→2040)
const aliceBenefitAtBobClaim = applyCOLA(aliceMonthlyBenefit, SS_COLA_RATE, 3);
const bobEffectiveBenefit = calculateSpousalBenefit(bobOwnBenefit, aliceBenefitAtBobClaim);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Social Security Benefits', () => {
  describe('Shadow calculator sanity checks', () => {
    it('should compute FRA = 67 for birth year 1970', () => {
      expect(aliceFRA).toBe(67);
    });

    it('should compute FRA = 67 for birth year 1973', () => {
      expect(bobFRA).toBe(67);
    });

    it('should compute a positive AIME for Alice', () => {
      expect(aliceAIME).toBeGreaterThan(0);
    });

    it('should compute a positive PIA for Alice', () => {
      expect(alicePIA).toBeGreaterThan(0);
    });

    it('should have FRA factor = 1.0 for Alice (claiming at 67)', () => {
      expect(aliceMonthlyBenefit).toBeCloseTo(alicePIA, 2);
    });
  });

  describe('2037-04: Alice SS first payment', () => {
    it('should have Alice Social Security activity in April 2037', () => {
      const activities = getActivitiesInMonth('Checking', '2037-04');
      const ssActivities = activities.filter((a) => a.name.includes('Alice Social Security'));
      expect(ssActivities.length).toBeGreaterThanOrEqual(1);
    });

    it('should match shadow-calculated first payment within tolerance', () => {
      // First payment: PIA at FRA (factor = 1.0), no COLA yet
      const activities = getActivitiesInMonth('Checking', '2037-04');
      const ssActivity = activities.find((a) => a.name.includes('Alice Social Security'));
      expect(ssActivity).toBeDefined();
      const engineAmount = ssActivity!.amount;

      // Allow 5% tolerance because simulation-period earnings (with raises)
      // may differ slightly from our estimate
      expect(engineAmount).toBeGreaterThan(0);
      const tolerance = aliceMonthlyBenefit * 0.05;
      expect(engineAmount).toBeGreaterThan(aliceMonthlyBenefit - tolerance);
      expect(engineAmount).toBeLessThan(aliceMonthlyBenefit + tolerance);
    });
  });

  describe('2038-04: Alice SS + 1 year COLA', () => {
    it('should show COLA-adjusted benefit after 1 year', () => {
      const activities2037 = getActivitiesInMonth('Checking', '2037-04');
      const ss2037 = activities2037.find((a) => a.name.includes('Alice Social Security'));
      expect(ss2037).toBeDefined();

      const activities2038 = getActivitiesInMonth('Checking', '2038-04');
      const ss2038 = activities2038.find((a) => a.name.includes('Alice Social Security'));
      expect(ss2038).toBeDefined();

      // After 1 year of COLA (2.5%), benefit should increase
      const expectedWithCOLA = ss2037!.amount * (1 + SS_COLA_RATE);
      expect(ss2038!.amount).toBeCloseTo(expectedWithCOLA, 0);
    });

    it('should match shadow COLA calculation', () => {
      const activities2038 = getActivitiesInMonth('Checking', '2038-04');
      const ss2038 = activities2038.find((a) => a.name.includes('Alice Social Security'));
      expect(ss2038).toBeDefined();

      const expectedCOLA = applyCOLA(aliceMonthlyBenefit, SS_COLA_RATE, 1);
      const tolerance = expectedCOLA * 0.05;
      expect(ss2038!.amount).toBeGreaterThan(expectedCOLA - tolerance);
      expect(ss2038!.amount).toBeLessThan(expectedCOLA + tolerance);
    });
  });

  describe('2040-07: Bob SS first payment (with spousal check)', () => {
    it('should have Bob Social Security activity in July 2040', () => {
      const activities = getActivitiesInMonth('Checking', '2040-07');
      const ssActivities = activities.filter((a) => a.name.includes('Bob Social Security'));
      expect(ssActivities.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply spousal benefit if higher than own', () => {
      const activities = getActivitiesInMonth('Checking', '2040-07');
      const bobSS = activities.find((a) => a.name.includes('Bob Social Security'));
      expect(bobSS).toBeDefined();

      // Bob's effective benefit = max(own PIA, 50% of Alice's adjusted benefit)
      // At this point Alice has had ~3 years of COLA
      expect(bobSS!.amount).toBeGreaterThan(0);

      // Verify it's at least 50% of Alice's current benefit (spousal floor)
      const aliceCurrentBenefit = applyCOLA(aliceMonthlyBenefit, SS_COLA_RATE, 3);
      const spousalFloor = aliceCurrentBenefit * 0.5;
      // Bob should get at least the spousal floor (within tolerance for simulation earnings)
      const tolerance = spousalFloor * 0.10;
      expect(bobSS!.amount).toBeGreaterThan(spousalFloor - tolerance);
    });

    it('should compare Bob own vs spousal benefit direction', () => {
      // Bob's own PIA should be less than Alice's (lower earner)
      // so spousal benefit (50% of Alice's) might be relevant
      expect(bobPIA).toBeLessThan(alicePIA);
    });
  });

  describe('2043-01: Both SS continue alongside other income', () => {
    it('should have both Alice and Bob SS payments in January 2043', () => {
      const activities = getActivitiesInMonth('Checking', '2043-01');
      const aliceSS = activities.filter((a) => a.name.includes('Alice Social Security'));
      const bobSS = activities.filter((a) => a.name.includes('Bob Social Security'));
      expect(aliceSS.length).toBeGreaterThanOrEqual(1);
      expect(bobSS.length).toBeGreaterThanOrEqual(1);
    });

    it('should have COLA-adjusted amounts for both after several years', () => {
      const activities = getActivitiesInMonth('Checking', '2043-01');
      const aliceSS = activities.find((a) => a.name.includes('Alice Social Security'));
      const bobSS = activities.find((a) => a.name.includes('Bob Social Security'));
      expect(aliceSS).toBeDefined();
      expect(bobSS).toBeDefined();

      // Alice: ~6 years of COLA from 2037
      const aliceExpected = applyCOLA(aliceMonthlyBenefit, SS_COLA_RATE, 6);
      const aliceTol = aliceExpected * 0.05;
      expect(aliceSS!.amount).toBeGreaterThan(aliceExpected - aliceTol);
      expect(aliceSS!.amount).toBeLessThan(aliceExpected + aliceTol);

      // Bob: ~3 years of COLA from 2040
      const bobBase = bobEffectiveBenefit;
      const bobExpected = applyCOLA(bobBase, SS_COLA_RATE, 3);
      const bobTol = bobExpected * 0.10; // wider tolerance for Bob (spousal + sim earnings)
      expect(bobSS!.amount).toBeGreaterThan(bobExpected - bobTol);
      expect(bobSS!.amount).toBeLessThan(bobExpected + bobTol);
    });
  });

  describe('2050-12: Many years of COLA applied', () => {
    it('should have both SS payments with significant COLA growth', () => {
      const activities = getActivitiesInMonth('Checking', '2050-12');
      const aliceSS = activities.find((a) => a.name.includes('Alice Social Security'));
      const bobSS = activities.find((a) => a.name.includes('Bob Social Security'));
      expect(aliceSS).toBeDefined();
      expect(bobSS).toBeDefined();

      // Alice: ~13-14 years of COLA from 2037
      const aliceExpected = applyCOLA(aliceMonthlyBenefit, SS_COLA_RATE, 13);
      const aliceTol = aliceExpected * 0.05;
      expect(aliceSS!.amount).toBeGreaterThan(aliceExpected - aliceTol);
      expect(aliceSS!.amount).toBeLessThan(aliceExpected + aliceTol);

      // Bob: ~10 years of COLA from 2040
      const bobExpected = applyCOLA(bobEffectiveBenefit, SS_COLA_RATE, 10);
      const bobTol = bobExpected * 0.10;
      expect(bobSS!.amount).toBeGreaterThan(bobExpected - bobTol);
      expect(bobSS!.amount).toBeLessThan(bobExpected + bobTol);
    });

    it('should show COLA compound growth over time', () => {
      // Verify 2050 benefit > 2043 benefit for Alice (continuous COLA)
      const act2043 = getActivitiesInMonth('Checking', '2043-01');
      const act2050 = getActivitiesInMonth('Checking', '2050-12');
      const alice2043 = act2043.find((a) => a.name.includes('Alice Social Security'));
      const alice2050 = act2050.find((a) => a.name.includes('Alice Social Security'));
      expect(alice2043).toBeDefined();
      expect(alice2050).toBeDefined();
      expect(alice2050!.amount).toBeGreaterThan(alice2043!.amount);

      // Growth factor should approximate (1.025)^7 ≈ 1.189
      const growthFactor = alice2050!.amount / alice2043!.amount;
      const expectedGrowth = Math.pow(1 + SS_COLA_RATE, 7);
      expect(growthFactor).toBeCloseTo(expectedGrowth, 1);
    });
  });
});
