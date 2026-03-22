import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LifeInsuranceManager,
  LifeInsurancePolicyConfig,
  EmploymentGate,
} from './life-insurance-manager';
import { MonteCarloSampleType, MCRateGetter } from './types';

// Mock loadVariable for deterministic inflation lookup
vi.mock('../simulation/variable', () => ({
  loadVariable: vi.fn(() => 0.03),
}));

import { loadVariable } from '../simulation/variable';

// ===== Test helpers =====

function makeConfig(overrides?: Partial<LifeInsurancePolicyConfig>): LifeInsurancePolicyConfig {
  return {
    id: 'policy-1',
    name: 'Employer Basic Life',
    type: 'employer',
    insuredPerson: 'Jake',
    beneficiary: 'Kendall',
    depositAccountId: 'acct-checking',
    coverage: {
      formula: 'multiplier',
      multiplier: 2,
      fixedAmount: undefined,
      maxCoverage: 500_000,
      maxCoverageInflationVariable: 'INFLATION',
      cappedByPolicyId: undefined,
    },
    employmentTied: true,
    linkedPaycheckBillName: 'Paycheck - Jake',
    enabled: true,
    ...overrides,
  };
}

function makeEmploymentGate(overrides?: Partial<EmploymentGate>): EmploymentGate {
  return {
    isUnemployed: vi.fn(() => false),
    ...overrides,
  };
}

function makeSalaries(entries: [string, number][]): Map<string, number> {
  return new Map(entries);
}

function makeRetirementDates(entries: [string, Date][]): Map<string, Date> {
  return new Map(entries);
}

// ===== Tests =====

describe('LifeInsuranceManager', () => {
  let gate: EmploymentGate;

  beforeEach(() => {
    vi.clearAllMocks();
    gate = makeEmploymentGate();
  });

  // ----- Test 1: Multiplier formula — coverage = multiplier * salary, capped at max -----
  it('calculates coverage as multiplier * salary, capped at maxCoverage', () => {
    const config = makeConfig({
      coverage: {
        formula: 'multiplier',
        multiplier: 3,
        maxCoverage: 400_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
    });

    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    const salaries = makeSalaries([['Jake', 150_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // 3 * 150,000 = 450,000, max inflated by loadVariable(0.03) = 400,000 * 1.03 = 412,000
    expect(mgr.getCurrentCoverage('policy-1')).toBe(412_000);
  });

  // ----- Test 2: Fixed formula — coverage = fixedAmount -----
  it('calculates coverage as fixedAmount for fixed formula', () => {
    const config = makeConfig({
      coverage: {
        formula: 'fixed',
        fixedAmount: 250_000,
        maxCoverage: 500_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
    });

    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    expect(mgr.getCurrentCoverage('policy-1')).toBe(250_000);
  });

  // ----- Test 3: cappedByPolicyId constraint enforced (two-pass ordering) -----
  it('caps coverage at referenced policy coverage via cappedByPolicyId', () => {
    const basePolicy = makeConfig({
      id: 'policy-base',
      name: 'Base Life',
      coverage: {
        formula: 'multiplier',
        multiplier: 1,
        maxCoverage: 200_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
    });

    const cappedPolicy = makeConfig({
      id: 'policy-capped',
      name: 'Supplemental Life',
      coverage: {
        formula: 'multiplier',
        multiplier: 5,
        maxCoverage: 1_000_000,
        maxCoverageInflationVariable: 'INFLATION',
        cappedByPolicyId: 'policy-base',
      },
    });

    const mgr = new LifeInsuranceManager([cappedPolicy, basePolicy], gate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // Base: 1 * 100,000 = 100,000 (under 200k max)
    expect(mgr.getCurrentCoverage('policy-base')).toBe(100_000);
    // Capped: 5 * 100,000 = 500,000, under 1M max, but capped at base's 100,000
    expect(mgr.getCurrentCoverage('policy-capped')).toBe(100_000);
  });

  // ----- Test 4: Max coverage inflates year over year -----
  it('inflates maxCoverage year over year via MC rate getter', () => {
    const config = makeConfig({
      coverage: {
        formula: 'multiplier',
        multiplier: 10,
        maxCoverage: 500_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
    });

    const mcGetter: MCRateGetter = (type, _year) => {
      if (type === MonteCarloSampleType.INFLATION) return 0.05;
      return null;
    };

    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    mgr.setMCRateGetter(mcGetter);

    const salaries = makeSalaries([['Jake', 200_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    // Year 1: max = 500,000 * (1 + 0.05) = 525,000
    mgr.evaluateYear(2025, salaries, retDates);
    const coverage2025 = mgr.getCurrentCoverage('policy-1');
    expect(coverage2025).toBeCloseTo(525_000, 0);

    // Year 2: max = 525,000 * 1.05 = 551,250
    mgr.evaluateYear(2026, salaries, retDates);
    const coverage2026 = mgr.getCurrentCoverage('policy-1');
    expect(coverage2026).toBeCloseTo(551_250, 0);
  });

  // ----- Test 5: Death while employed — payout triggers -----
  it('creates payout when insured person dies while employed', () => {
    const config = makeConfig();
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);
    // Coverage = 2 * 100,000 = 200,000

    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].targetAccountId).toBe('acct-checking');
    expect(payouts[0].activity.amount).toBe(200_000);
    expect(payouts[0].incomeSourceName).toBe('Income.LifeInsurance');

    const results = mgr.getResults();
    const policyResult = results.find((r) => r.policyId === 'policy-1')!;
    expect(policyResult.coverageActiveAtDeath).toBe(true);
    expect(policyResult.payoutAmount).toBe(200_000);
  });

  // ----- Test 6: Death during job loss — no payout -----
  it('does not create payout when insured person dies during unemployment', () => {
    const unemployedGate = makeEmploymentGate({
      isUnemployed: vi.fn(() => true),
    });

    const config = makeConfig();
    const mgr = new LifeInsuranceManager([config], unemployedGate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(0);

    const results = mgr.getResults();
    const policyResult = results.find((r) => r.policyId === 'policy-1')!;
    expect(policyResult.coverageActiveAtDeath).toBe(false);
  });

  // ----- Test 7: Death after retirement — no payout -----
  it('does not create payout when insured person dies after retirement', () => {
    const config = makeConfig();
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    // Retired in 2024 (before evaluation year)
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2024, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(0);

    const results = mgr.getResults();
    const policyResult = results.find((r) => r.policyId === 'policy-1')!;
    expect(policyResult.coverageActiveAtDeath).toBe(false);
  });

  // ----- Test 8: Job loss then re-employment then death — payout triggers -----
  it('restores coverage on re-employment and pays out on death', () => {
    let unemployed = true;
    const dynamicGate = makeEmploymentGate({
      isUnemployed: vi.fn(() => unemployed),
    });

    const config = makeConfig();
    const mgr = new LifeInsuranceManager([config], dynamicGate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    // Year 2025: unemployed → coverage inactive
    mgr.evaluateYear(2025, salaries, retDates);
    expect(mgr.getCurrentCoverage('policy-1')).toBe(200_000); // coverage amount still calculated
    // But policy state should show inactive

    // Year 2026: re-employed → coverage active
    unemployed = false;
    mgr.evaluateYear(2026, salaries, retDates);

    mgr.evaluateDeath('Jake', new Date(Date.UTC(2026, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(200_000);
  });

  // ----- Test 9: Beneficiary dies — policy becomes inactive -----
  it('deactivates policy when beneficiary dies', () => {
    const config = makeConfig({
      insuredPerson: 'Jake',
      beneficiary: 'Kendall',
    });

    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    const salaries = makeSalaries([['Jake', 100_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // Beneficiary dies
    mgr.evaluateDeath('Kendall', new Date(Date.UTC(2025, 3, 10)));

    // Now insured person dies
    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 6, 15)));

    const payouts = mgr.getPayoutActivities();
    // No payout because beneficiary is already dead (policy inactive)
    expect(payouts).toHaveLength(0);
  });

  // ----- Test 10: Checkpoint/restore round-trip preserves state -----
  it('checkpoint/restore round-trip preserves all state', () => {
    // Use high multiplier so coverage is capped by maxCoverage (which inflates)
    const config = makeConfig({
      coverage: {
        formula: 'multiplier',
        multiplier: 10,
        maxCoverage: 500_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
    });

    const mcGetter: MCRateGetter = (type, _year) => {
      if (type === MonteCarloSampleType.INFLATION) return 0.04;
      return null;
    };

    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    mgr.setMCRateGetter(mcGetter);

    const salaries = makeSalaries([['Jake', 200_000]]);
    const retDates = makeRetirementDates([['Jake', new Date(Date.UTC(2060, 0, 1))]]);

    // 10 * 200k = 2M, capped at 500k * 1.04 = 520k
    mgr.evaluateYear(2025, salaries, retDates);
    const coverageBefore = mgr.getCurrentCoverage('policy-1');
    expect(coverageBefore).toBeCloseTo(520_000, 0);

    const checkpointData = mgr.checkpoint();

    // Year 2: max = 520k * 1.04 = 540,800
    mgr.evaluateYear(2026, salaries, retDates);
    const coverageAfter = mgr.getCurrentCoverage('policy-1');
    expect(coverageAfter).toBeCloseTo(540_800, 0);
    expect(coverageAfter).not.toBe(coverageBefore);

    // Restore
    mgr.restore(checkpointData);
    const coverageRestored = mgr.getCurrentCoverage('policy-1');
    expect(coverageRestored).toBeCloseTo(coverageBefore, 0);

    // Verify results also restored
    const results = mgr.getResults();
    const policyResult = results.find((r) => r.policyId === 'policy-1')!;
    expect(policyResult.payoutDate).toBeNull();
    expect(policyResult.payoutAmount).toBe(0);
  });
});
