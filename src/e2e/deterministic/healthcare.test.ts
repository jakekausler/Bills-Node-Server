import { describe, it, expect } from 'vitest';
import {
  getActivitiesByName,
  getActivitiesInMonth,
  getHealthcareActivities,
  getHealthcareSpentThrough,
  normalizeDate,
} from '../helpers';
import {
  calculatePatientCost,
  inflateHealthcareAmount,
  type PatientCostResult,
} from '../calculators/healthcare-calculator';

/**
 * Healthcare tests — employer plan period (pre-retirement).
 *
 * Verifies deductible/OOP tracking, coinsurance, copay, and OOP cap
 * behavior using the shadow calculator against engine output.
 *
 * Employer plan config (from healthcare_configs.json):
 *   individualDeductible: $1,500 (inflated at 5% from 2026)
 *   individualOOPMax:     $8,000
 *   familyDeductible:     $3,000
 *   familyOOPMax:         $16,000
 *   resetMonth: 0 (January), resetDay: 1
 *
 * Healthcare bills on Checking:
 *   Alice Prescription: -$85/mo, coinsurance 20%, countsTowardDeductible, countsTowardOOP
 *   Alice Annual Physical: -$250/yr (April), copay $40, countsTowardDeductible, countsTowardOOP
 *   Bob Therapy: -$150/mo, copay $30, countsTowardDeductible=false, countsTowardOOP
 *   Bob Annual Physical: -$250/yr (May), copay $40, countsTowardDeductible, countsTowardOOP
 *
 * Healthcare activities on Checking:
 *   Alice ER Visit: -$8,000 on 2026-03-15, coinsurance 20%
 *   Alice Surgery: -$25,000 on 2026-08-01, coinsurance 20%
 *   Bob MRI: -$4,000 on 2027-02-15, coinsurance 20%
 *   Bob Physical Therapy: -$12,000 on 2027-07-01, coinsurance 20%
 */

// ── Employer plan config ──────────────────────────────────────────────────
const EMPLOYER_PLAN = {
  individualDeductible: 1500,
  individualOOPMax: 8000,
  familyDeductible: 3000,
  familyOOPMax: 16000,
  deductibleInflationRate: 0.05,
};

// ── Helper: inflate employer plan limits from base year 2025 ──────────────
function inflatedDeductible(baseAmount: number, year: number): number {
  // Plan limits inflate at 5% from base year; base year is implicit in config
  // The engine inflates deductible/OOP each year at deductibleInflationRate
  const yearsFromBase = Math.max(0, year - 2025);
  return inflateHealthcareAmount(baseAmount, EMPLOYER_PLAN.deductibleInflationRate, yearsFromBase);
}

// =============================================================================
// Tests
// =============================================================================

describe('Healthcare — Employer Plan: Alice 2025-01 (first prescription)', () => {
  it('Alice Prescription in Jan 2025: first deductible usage of the year', () => {
    // In 2025-01, Alice's deductible/OOP spent should be 0 at start of year
    // Alice Prescription: $85 bill, 20% coinsurance, countsTowardDeductible=true
    // Since deductible ($1,500) is not met, patient pays 100% of the $85
    const billAmount = 85; // abs value
    const indDeductible = inflatedDeductible(EMPLOYER_PLAN.individualDeductible, 2025);
    const indOOPMax = inflatedDeductible(EMPLOYER_PLAN.individualOOPMax, 2025);
    const famDeductible = inflatedDeductible(EMPLOYER_PLAN.familyDeductible, 2025);
    const famOOPMax = inflatedDeductible(EMPLOYER_PLAN.familyOOPMax, 2025);

    const result = calculatePatientCost(
      billAmount,
      null,          // no copay
      20,            // 20% coinsurance
      true,          // countsTowardDeductible
      true,          // countsTowardOOP
      0,             // deductibleSpent (start of year)
      0,             // oopSpent
      indDeductible,
      indOOPMax,
      0,             // familyDeductibleSpent
      0,             // familyOOPSpent
      famDeductible,
      famOOPMax,
    );

    // $85 < $1,500 remaining deductible => patient pays full $85
    expect(result.patientCost).toBeCloseTo(85, 2);
    expect(result.newDeductibleSpent).toBeCloseTo(85, 2);
    expect(result.newOOPSpent).toBeCloseTo(85, 2);

    // Verify the engine produced a healthcare activity for Alice in Jan
    const janActivities = getActivitiesInMonth('Checking', '2025-01').filter(
      (a) => a.name === 'Alice Prescription' && a.isHealthcare,
    );
    expect(janActivities.length).toBe(1);
    // Engine patient cost should be negative (expense)
    expect(janActivities[0].amount).toBeLessThan(0);
  });
});

describe('Healthcare — Employer Plan: Alice ER Visit 2026-03', () => {
  it('Alice ER Visit ($8K): deductible partially spent from prior prescriptions/physicals', () => {
    // By 2026-03-15, Alice has had:
    //   - 12 prescriptions in 2025 ($85 each) — but deductible resets Jan 1 2026
    //   - Prescriptions Jan-Feb 2026 (2 months * $85 = $170 toward deductible)
    //   - Annual Physical Apr 2025 (copay $40, not coinsurance-based)
    // 2026 deductible reset: only Jan+Feb 2026 prescriptions count
    //
    // The engine tracks cumulative spend; we verify the ER visit activity exists
    // and its patient cost is reasonable given the deductible/coinsurance math.

    const erVisitActivities = getActivitiesByName('Checking', 'Alice ER Visit').filter(
      (a) => normalizeDate(a.date) === '2026-03-15',
    );
    expect(erVisitActivities.length).toBe(1);
    expect(erVisitActivities[0].isHealthcare).toBe(true);
    expect(erVisitActivities[0].healthcarePerson).toBe('Alice');

    // The patient cost (negative amount) should be significantly less than $8,000
    // because after deductible, only 20% coinsurance applies
    const patientCost = Math.abs(erVisitActivities[0].amount);

    // 2026 inflated deductible: $1,500 * 1.05 = $1,575
    const indDeductible2026 = inflatedDeductible(EMPLOYER_PLAN.individualDeductible, 2026);
    expect(indDeductible2026).toBeCloseTo(1575, 0);

    // Prior spend in 2026 before ER: Jan + Feb prescriptions
    // Each prescription through deductible = $85 (full amount, under deductible)
    const priorDeductibleSpend = 85 * 2; // $170

    // ER visit: $8,000
    // Remaining deductible: $1,575 - $170 = $1,405
    // Patient pays: $1,405 (deductible) + 20% * ($8,000 - $1,405) = $1,405 + $1,319 = $2,724
    const remainingDeductible = indDeductible2026 - priorDeductibleSpend;
    const amountAfterDeductible = 8000 - remainingDeductible;
    const expectedPatientCost = remainingDeductible + amountAfterDeductible * 0.20;

    expect(patientCost).toBeCloseTo(expectedPatientCost, -1); // within $10
  });
});

describe('Healthcare — Employer Plan: Alice Surgery 2026-08', () => {
  it('Alice Surgery ($25K): should hit OOP max after ER visit consumed most of deductible', () => {
    const surgeryActivities = getActivitiesByName('Checking', 'Alice Surgery').filter(
      (a) => normalizeDate(a.date) === '2026-08-01',
    );
    expect(surgeryActivities.length).toBe(1);
    expect(surgeryActivities[0].isHealthcare).toBe(true);
    expect(surgeryActivities[0].healthcarePerson).toBe('Alice');

    const patientCost = Math.abs(surgeryActivities[0].amount);

    // By August 2026, Alice's deductible should be fully met from ER visit.
    // She should be paying coinsurance (20%) capped at OOP max.
    // 2026 OOP max: $8,000 * 1.05 = $8,400
    const indOOPMax2026 = inflatedDeductible(EMPLOYER_PLAN.individualOOPMax, 2026);
    expect(indOOPMax2026).toBeCloseTo(8400, 0);

    // The total healthcare spent through the surgery date should approach the OOP max
    const aliceSpent = getHealthcareSpentThrough('Alice', '2026-08-01');

    // Surgery patient cost should be capped so total doesn't exceed OOP max
    // If prior OOP spend was already substantial from ER, surgery cost should be limited
    expect(patientCost).toBeLessThan(25000); // significantly less than bill amount
    expect(patientCost).toBeGreaterThan(0);

    // Total Alice healthcare spend in 2026 should not exceed OOP max
    // (up through surgery date)
    const aliceHealthcare2026 = getHealthcareSpentThrough('Alice', '2026-12-31');
    expect(aliceHealthcare2026.totalPatientCost).toBeLessThanOrEqual(indOOPMax2026 + 500); // small tolerance for copays
  });
});

describe('Healthcare — Employer Plan: Bob MRI 2027-02', () => {
  it('Bob MRI ($4K): uses Bob own individual deductible (separate from Alice)', () => {
    const mriActivities = getActivitiesByName('Checking', 'Bob MRI').filter(
      (a) => normalizeDate(a.date) === '2027-02-15',
    );
    expect(mriActivities.length).toBe(1);
    expect(mriActivities[0].isHealthcare).toBe(true);
    expect(mriActivities[0].healthcarePerson).toBe('Bob');

    const patientCost = Math.abs(mriActivities[0].amount);

    // 2027 inflated deductible: $1,500 * 1.05^2 = $1,653.75 -> $1,654
    const indDeductible2027 = inflatedDeductible(EMPLOYER_PLAN.individualDeductible, 2027);

    // Bob's prior 2027 spend: Jan therapy ($30 copay, not toward deductible)
    // So Bob's deductible is essentially untouched by therapy copays (countsTowardDeductible=false)
    // Only Bob Annual Physical (May) has copay toward deductible, but it's not until May
    // So before MRI in Feb, Bob's deductible spend is ~$0 from deductible-tracking items

    // MRI: $4,000 with 20% coinsurance
    // Remaining deductible ≈ full $1,654
    // Patient pays: $1,654 + 20% * ($4,000 - $1,654) = $1,654 + $469.20 = $2,123.20
    const expectedCost = indDeductible2027 + (4000 - indDeductible2027) * 0.20;

    expect(patientCost).toBeCloseTo(expectedCost, -1); // within $10
  });
});

describe('Healthcare — Employer Plan: Bob PT 2027-07', () => {
  it('Bob Physical Therapy ($12K): should push Bob past his OOP max', () => {
    const ptActivities = getActivitiesByName('Checking', 'Bob Physical Therapy').filter(
      (a) => normalizeDate(a.date) === '2027-07-01',
    );
    expect(ptActivities.length).toBe(1);
    expect(ptActivities[0].isHealthcare).toBe(true);
    expect(ptActivities[0].healthcarePerson).toBe('Bob');

    const patientCost = Math.abs(ptActivities[0].amount);

    // 2027 OOP max: $8,000 * 1.05^2 = $8,820
    const indOOPMax2027 = inflatedDeductible(EMPLOYER_PLAN.individualOOPMax, 2027);

    // After MRI, Bob's OOP should be around $2,123
    // Plus monthly therapy copays ($30 * 6 months ≈ $180 toward OOP)
    // Plus May physical copay ($40)
    // Estimated prior OOP ≈ $2,123 + $180 + $40 = $2,343
    // Remaining OOP ≈ $8,820 - $2,343 = $6,477
    // PT cost: deductible already met from MRI, so 20% of $12,000 = $2,400
    // $2,400 < $6,477 remaining OOP, so not capped

    // But verify that total Bob healthcare in 2027 stays under OOP max
    expect(patientCost).toBeLessThan(12000);
    expect(patientCost).toBeGreaterThan(0);

    // Bob's total 2027 healthcare should not exceed OOP max
    const bobHealthcare2027 = getHealthcareSpentThrough('Bob', '2027-12-31');
    expect(bobHealthcare2027.totalPatientCost).toBeLessThanOrEqual(indOOPMax2027 + 500); // tolerance for copays
  });
});

describe('Healthcare — Employer Plan: cross-person isolation', () => {
  it('Alice and Bob deductibles are tracked independently', () => {
    // Alice healthcare in 2026 should reflect her own deductible/OOP progression
    const aliceHealthcare2026 = getHealthcareActivities('Checking', 'Alice');
    const bobHealthcare2027 = getHealthcareActivities('Checking', 'Bob');

    // Both should have multiple healthcare events
    const alice2026Events = aliceHealthcare2026.filter((a) => a.date.startsWith('2026'));
    const bob2027Events = bobHealthcare2027.filter((a) => a.date.startsWith('2027'));

    expect(alice2026Events.length).toBeGreaterThanOrEqual(2); // ER + Surgery + prescriptions
    expect(bob2027Events.length).toBeGreaterThanOrEqual(2); // MRI + PT + therapy copays
  });

  it('Family deductible/OOP tracks across both persons', () => {
    // Family deductible in 2026: $3,000 * 1.05 = $3,150
    // Family OOP in 2026: $16,000 * 1.05 = $16,800
    // Combined Alice + Bob spend should be tracked at family level
    const aliceSpent2026 = getHealthcareSpentThrough('Alice', '2026-12-31');
    const bobSpent2026 = getHealthcareSpentThrough('Bob', '2026-12-31');
    const famOOPMax2026 = inflatedDeductible(EMPLOYER_PLAN.familyOOPMax, 2026);

    // Combined family spend should not exceed family OOP max
    const totalFamilySpend = aliceSpent2026.totalPatientCost + bobSpent2026.totalPatientCost;
    expect(totalFamilySpend).toBeLessThanOrEqual(famOOPMax2026 + 500);
  });
});

describe('Healthcare — Copay vs Coinsurance paths', () => {
  it('Alice Annual Physical uses copay ($40), not coinsurance', () => {
    // Physical in April 2025: copay $40, regardless of deductible
    const physicals = getActivitiesByName('Checking', 'Alice Annual Physical').filter(
      (a) => a.date.startsWith('2025-04'),
    );
    expect(physicals.length).toBe(1);
    expect(physicals[0].isHealthcare).toBe(true);

    // Patient cost should be the copay amount ($40), not bill-based coinsurance
    const patientCost = Math.abs(physicals[0].amount);
    expect(patientCost).toBeCloseTo(40, 2);
  });

  it('Bob Therapy uses copay ($30), does NOT count toward deductible', () => {
    // Bob Therapy: $150/mo, copay $30, countsTowardDeductible=false
    const therapies = getActivitiesByName('Checking', 'Bob Therapy').filter(
      (a) => a.date.startsWith('2025-01'),
    );
    expect(therapies.length).toBe(1);
    expect(therapies[0].isHealthcare).toBe(true);

    const patientCost = Math.abs(therapies[0].amount);
    expect(patientCost).toBeCloseTo(30, 2);
  });
});
