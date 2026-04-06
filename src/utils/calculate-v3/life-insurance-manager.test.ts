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
    const salaries = makeSalaries([['Paycheck - Jake', 150_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // Base: 1 * 100,000 = 100,000 (under 200k max)
    expect(mgr.getCurrentCoverage('policy-base')).toBe(100_000);
    // Capped: 5 * 100,000 = 500,000, under 1M max, but capped at base's 100,000
    expect(mgr.getCurrentCoverage('policy-capped')).toBe(100_000);
  });

  // ----- Test 3b: cappedByPolicyId skipped when reference policy is inactive (retired) -----
  it('does not apply cappedByPolicyId cap when reference policy is inactive', () => {
    const basePolicy = makeConfig({
      id: 'policy-base',
      name: 'Jake Supplemental Life',
      insuredPerson: 'Jake',
      coverage: {
        formula: 'multiplier',
        multiplier: 1,
        maxCoverage: 200_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
      employmentTied: true,
      linkedPaycheckBillName: 'Paycheck - Jake',
    });

    const cappedPolicy = makeConfig({
      id: 'policy-capped',
      name: 'Spouse Supplemental Life',
      insuredPerson: 'Kendall',
      coverage: {
        formula: 'fixed',
        fixedAmount: 150_000,
        maxCoverage: 500_000,
        maxCoverageInflationVariable: 'INFLATION',
        cappedByPolicyId: 'policy-base',
      },
      employmentTied: false,
    });

    const mgr = new LifeInsuranceManager([cappedPolicy, basePolicy], gate, 'test-sim');
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);

    // Year 1: Jake is employed — base coverage = 100k, capped policy capped at 100k
    const retDatesActive = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);
    mgr.evaluateYear(2025, salaries, retDatesActive);
    expect(mgr.getCurrentCoverage('policy-base')).toBe(100_000);
    expect(mgr.getCurrentCoverage('policy-capped')).toBe(100_000); // capped

    // Year 2: Jake retires — base policy goes inactive, cap should NOT apply
    const retDatesRetired = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2025, 0, 1))]]);
    mgr.evaluateYear(2026, salaries, retDatesRetired);

    // Base policy: retired → inactive, coverage amount still calculated but policy inactive
    // Capped policy: reference is inactive → cap skipped → uses own fixedAmount (150k)
    expect(mgr.getCurrentCoverage('policy-capped')).toBe(150_000);
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

    const salaries = makeSalaries([['Paycheck - Jake', 200_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);
    // Coverage = 2 * 100,000 = 200,000

    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].targetAccountId).toBe('acct-checking');
    expect(payouts[0].activity.amount).toBe(200_000);
    expect(payouts[0].incomeSourceName).toBe('Income.LifeInsurance');

    // Verify buffer is cleared after retrieval
    const payouts2 = mgr.getPayoutActivities();
    expect(payouts2).toHaveLength(0);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    // Retired in 2024 (before evaluation year)
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2024, 0, 1))]]);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

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
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // Beneficiary dies
    mgr.evaluateDeath('Kendall', new Date(Date.UTC(2025, 3, 10)));

    // Now insured person dies
    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 6, 15)));

    const payouts = mgr.getPayoutActivities();
    // No payout because beneficiary is already dead (policy inactive)
    expect(payouts).toHaveLength(0);
  });

  // ----- Test 9b: Spouse policy uses employmentPerson for unemployment gating -----
  it('deactivates spouse policy when employmentPerson (not insuredPerson) loses job', () => {
    const jakeUnemployed = vi.fn(
      (person: string, _date: Date) => person === 'Jake',
    );
    const employerGate = makeEmploymentGate({ isUnemployed: jakeUnemployed });

    // Spouse policy: insuredPerson=Kendall, but employmentPerson=Jake
    const spousePolicy = makeConfig({
      id: 'spouse-basic',
      name: 'Spouse Basic Life',
      insuredPerson: 'Kendall',
      beneficiary: 'Jake',
      employmentPerson: 'Jake',
      coverage: {
        formula: 'fixed',
        fixedAmount: 25_000,
        maxCoverage: 50_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
      employmentTied: true,
      linkedPaycheckBillName: 'Paycheck - Jake',
    });

    const mgr = new LifeInsuranceManager([spousePolicy], employerGate, 'test-sim');
    const salaries = makeSalaries([['Paycheck - Jake', 100_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // Kendall dies — but Jake is unemployed, so spouse policy is inactive → no payout
    mgr.evaluateDeath('Kendall', new Date(Date.UTC(2025, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(0);

    // Verify unemployment was checked for Jake, not Kendall
    expect(jakeUnemployed).toHaveBeenCalledWith('Jake', expect.any(Date));
  });

  // ----- Test 9c: Spouse policy without employmentPerson falls back to insuredPerson -----
  it('falls back to insuredPerson for unemployment check when employmentPerson is not set', () => {
    const kendallUnemployed = vi.fn(
      (person: string, _date: Date) => person === 'Kendall',
    );
    const employerGate = makeEmploymentGate({ isUnemployed: kendallUnemployed });

    // No employmentPerson set — should fall back to insuredPerson (Kendall)
    const spousePolicy = makeConfig({
      id: 'spouse-no-emp',
      name: 'Spouse Life (no employmentPerson)',
      insuredPerson: 'Kendall',
      beneficiary: 'Jake',
      coverage: {
        formula: 'fixed',
        fixedAmount: 10_000,
        maxCoverage: 50_000,
        maxCoverageInflationVariable: 'INFLATION',
      },
      employmentTied: true,
      linkedPaycheckBillName: 'Paycheck - Kendall',
    });

    const mgr = new LifeInsuranceManager([spousePolicy], employerGate, 'test-sim');
    const salaries = makeSalaries([['Paycheck - Kendall', 50_000]]);
    const retDates = makeRetirementDates([['Paycheck - Kendall', new Date(Date.UTC(2060, 0, 1))]]);

    mgr.evaluateYear(2025, salaries, retDates);

    // Kendall is unemployed → coverage inactive
    mgr.evaluateDeath('Kendall', new Date(Date.UTC(2025, 5, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(0);

    expect(kendallUnemployed).toHaveBeenCalledWith('Kendall', expect.any(Date));
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

    const salaries = makeSalaries([['Paycheck - Jake', 200_000]]);
    const retDates = makeRetirementDates([['Paycheck - Jake', new Date(Date.UTC(2060, 0, 1))]]);

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

  // ===== TERM LIFE INSURANCE TESTS =====

  // Helper to create term policy config
  function makeTermConfig(overrides?: Partial<LifeInsurancePolicyConfig>): LifeInsurancePolicyConfig {
    return {
      id: 'term-policy-1',
      name: 'Term Life 20yr',
      type: 'term' as const,
      insuredPerson: 'Jake',
      beneficiary: 'Kendall',
      depositAccountId: 'acct-checking',
      enabled: true,
      faceAmount: 500_000,
      termYears: 20,
      startDate: '2025-01-01',
      premiumAmount: 50, // $50/month = $600/year
      premiumFrequency: 'monthly' as const,
      payFromAccountId: 'acct-payment',
      renewalOption: 'expire' as const,
      insuredGender: 'male' as const,
      insuredBirthDate: '1985-06-15',
      ...overrides,
    } as LifeInsurancePolicyConfig;
  }

  // ----- Test 11: Term premium deduction -----
  it('deducts term premium as negative payout on evaluateYear', () => {
    const config = makeTermConfig();
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    mgr.evaluateYear(2025, new Map(), new Map());

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(-600); // $50/month * 12
    expect(payouts[0].targetAccountId).toBe('acct-payment');
    expect(payouts[0].incomeSourceName).toBe('Expense.Insurance.LifeInsurance');
    expect(payouts[0].activity.date).toEqual(new Date('2025-01-01T12:00:00.000Z'));
  });

  // ----- Test 12: Term premium accumulation -----
  it('accumulates totalPremiumsPaid over multiple years', () => {
    const config = makeTermConfig({ premiumAmount: 100, premiumFrequency: 'annual' });
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    // Year 1: $100 premium
    mgr.evaluateYear(2025, new Map(), new Map());
    let payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(-100);

    // Year 2: another $100 premium, total $200
    mgr.evaluateYear(2026, new Map(), new Map());
    payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(-100);

    // Year 3: another $100 premium, total $300
    mgr.evaluateYear(2027, new Map(), new Map());
    payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(-100);

    // Verify cumulative total through checkpoint (internal state)
    const checkpointData = mgr.checkpoint();
    const parsed = JSON.parse(checkpointData);
    expect(parsed['term-policy-1'].totalPremiumsPaid).toBe(300);
  });

  // ----- Test 13: Term expiration — expire option -----
  it('expires term policy when termExpirationYear reached and renewalOption=expire', () => {
    const config = makeTermConfig({
      startDate: '2025-01-01',
      termYears: 5,
      renewalOption: 'expire',
    });
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    // Years 2025-2029: policy active, premiums deducted
    for (let year = 2025; year <= 2029; year++) {
      mgr.evaluateYear(year, new Map(), new Map());
      const payouts = mgr.getPayoutActivities();
      expect(payouts).toHaveLength(1); // premium deduction
      expect(payouts[0].activity.amount).toBe(-600);
    }

    // Year 2030: expiration year reached (2025 + 5 = 2030)
    mgr.evaluateYear(2030, new Map(), new Map());
    const payouts2030 = mgr.getPayoutActivities();
    // Premium is charged, then policy expires
    expect(payouts2030).toHaveLength(1);

    // Year 2031: policy expired, no premium
    mgr.evaluateYear(2031, new Map(), new Map());
    const payouts2031 = mgr.getPayoutActivities();
    expect(payouts2031).toHaveLength(0);

    // Verify termActive and coverageActive are false
    const checkpointData = mgr.checkpoint();
    const parsed = JSON.parse(checkpointData);
    expect(parsed['term-policy-1'].termActive).toBe(false);
    expect(parsed['term-policy-1'].coverageActive).toBe(false);
  });

  // ----- Test 14: Term expiration — renew option -----
  it('renews term policy when termExpirationYear reached and renewalOption=renew', () => {
    const config = makeTermConfig({
      startDate: '2025-01-01',
      termYears: 10,
      renewalOption: 'renew',
      premiumAmount: 50, // monthly
      premiumFrequency: 'monthly',
    });

    // Mock rate table: age 40-49 and 50-59, male, 10-year term
    // Insured born 1985, so at year 2035 renewal they're 50 years old
    const rateTable = [
      { ageMin: 40, ageMax: 49, gender: 'male' as const, termYears: 10, ratePerThousandMonthly: 50 / 1000 },
      { ageMin: 50, ageMax: 59, gender: 'male' as const, termYears: 10, ratePerThousandMonthly: 60 / 1000 },
    ];

    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');
    mgr.setTermRateTable(rateTable);

    // Years 2025-2034: first term (insured born 1985, age 40-49)
    for (let year = 2025; year <= 2034; year++) {
      mgr.evaluateYear(year, new Map(), new Map());
      mgr.getPayoutActivities(); // clear buffer
    }

    // Year 2035: expiration year (2025 + 10 = 2035), old premium charged then renewal triggers
    mgr.evaluateYear(2035, new Map(), new Map());
    const payouts2035 = mgr.getPayoutActivities();
    // Old premium still charged in year 2035: $50/mo * 12 = $600
    expect(payouts2035).toHaveLength(1);
    expect(payouts2035[0].activity.amount).toBeCloseTo(-600, 0);

    // Verify renewal state
    const checkpointData = mgr.checkpoint();
    const parsed = JSON.parse(checkpointData);
    expect(parsed['term-policy-1'].termActive).toBe(true);
    expect(parsed['term-policy-1'].termExpirationYear).toBe(2045); // 2035 + 10
    expect(parsed['term-policy-1'].renewalCount).toBe(1);
    expect(parsed['term-policy-1'].currentPremiumAmount).toBeCloseTo(360, 0);

    // Year 2036: new premium applies
    // ratePerThousandMonthly = 60 / 1000 = 0.06 per month per $1000
    // faceAmount = 500,000
    // Monthly premium = 0.06 * (500,000 / 1000) = 0.06 * 500 = $30/month
    // Annual premium = $30 * 12 = $360/year
    mgr.evaluateYear(2036, new Map(), new Map());
    const payouts2036 = mgr.getPayoutActivities();
    expect(payouts2036).toHaveLength(1);
    expect(payouts2036[0].activity.amount).toBeCloseTo(-360, 0);
  });

  // ----- Test 15: Term death benefit -----
  it('pays out faceAmount when insured dies while term is active', () => {
    const config = makeTermConfig({
      faceAmount: 750_000,
      startDate: '2025-01-01',
      termYears: 20,
    });
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    mgr.evaluateYear(2025, new Map(), new Map());
    mgr.getPayoutActivities(); // clear premium deduction

    // Insured dies mid-term
    mgr.evaluateDeath('Jake', new Date(Date.UTC(2025, 6, 15)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(750_000);
    expect(payouts[0].targetAccountId).toBe('acct-checking');
    expect(payouts[0].incomeSourceName).toBe('Income.LifeInsurance');

    const results = mgr.getResults();
    const policyResult = results.find((r) => r.policyId === 'term-policy-1')!;
    expect(policyResult.payoutAmount).toBe(750_000);
    expect(policyResult.coverageActiveAtDeath).toBe(true);
  });

  // ----- Test 16: Term death after expiration -----
  it('does not pay out when insured dies after term has expired', () => {
    const config = makeTermConfig({
      startDate: '2025-01-01',
      termYears: 5,
      renewalOption: 'expire',
    });
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    // Advance to expiration year
    for (let year = 2025; year <= 2030; year++) {
      mgr.evaluateYear(year, new Map(), new Map());
      mgr.getPayoutActivities(); // clear premiums
    }

    // Policy expired, now insured dies
    mgr.evaluateDeath('Jake', new Date(Date.UTC(2031, 3, 10)));

    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(0);

    const results = mgr.getResults();
    const policyResult = results.find((r) => r.policyId === 'term-policy-1')!;
    expect(policyResult.payoutAmount).toBe(0);
    expect(policyResult.coverageActiveAtDeath).toBe(false);
  });

  // ----- Test 17: Term conversion to whole -----
  it('converts term to whole life when termExpirationYear reached and renewalOption=convertToWhole', () => {
    const config = makeTermConfig({
      startDate: '2025-01-01',
      termYears: 10,
      renewalOption: 'convertToWhole',
    });
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    // Years 2025-2034: policy active
    for (let year = 2025; year <= 2034; year++) {
      mgr.evaluateYear(year, new Map(), new Map());
      mgr.getPayoutActivities(); // clear premiums
    }

    // Year 2035: conversion year
    mgr.evaluateYear(2035, new Map(), new Map());

    // Verify conversion state
    const checkpointData = mgr.checkpoint();
    const parsed = JSON.parse(checkpointData);
    expect(parsed['term-policy-1'].termActive).toBe(false);
    expect(parsed['term-policy-1'].convertedToWholeDate).toBe('2035-01-01');
    expect(parsed['term-policy-1'].coverageActive).toBe(true); // coverage preserved
  });

  // ----- Test 18: Term checkpoint/restore round-trip -----
  it('checkpoint/restore preserves all term policy state fields', () => {
    const config = makeTermConfig({
      startDate: '2025-01-01',
      termYears: 10,
      premiumAmount: 75,
      premiumFrequency: 'monthly',
    });
    const mgr = new LifeInsuranceManager([config], gate, 'test-sim');

    // Advance a few years to build state
    mgr.evaluateYear(2025, new Map(), new Map());
    mgr.getPayoutActivities();
    mgr.evaluateYear(2026, new Map(), new Map());
    mgr.getPayoutActivities();
    mgr.evaluateYear(2027, new Map(), new Map());
    mgr.getPayoutActivities();

    // Checkpoint after 3 years
    const checkpoint1 = mgr.checkpoint();
    const parsed1 = JSON.parse(checkpoint1);

    // Verify initial state
    expect(parsed1['term-policy-1'].termActive).toBe(true);
    expect(parsed1['term-policy-1'].termExpirationYear).toBe(2035);
    expect(parsed1['term-policy-1'].totalPremiumsPaid).toBe(2700); // $900/year * 3
    expect(parsed1['term-policy-1'].currentPremiumAmount).toBe(900); // $75/mo * 12
    expect(parsed1['term-policy-1'].renewalCount).toBe(0);
    expect(parsed1['term-policy-1'].convertedToWholeDate).toBeNull();

    // Advance more years and modify state
    mgr.evaluateYear(2028, new Map(), new Map());
    mgr.getPayoutActivities();
    mgr.evaluateYear(2029, new Map(), new Map());
    mgr.getPayoutActivities();

    const checkpoint2 = mgr.checkpoint();
    const parsed2 = JSON.parse(checkpoint2);
    expect(parsed2['term-policy-1'].totalPremiumsPaid).toBe(4500); // $900/year * 5

    // Restore to checkpoint 1
    mgr.restore(checkpoint1);

    const checkpointRestored = mgr.checkpoint();
    const parsedRestored = JSON.parse(checkpointRestored);

    // Verify all 6 term fields restored correctly
    expect(parsedRestored['term-policy-1'].termActive).toBe(parsed1['term-policy-1'].termActive);
    expect(parsedRestored['term-policy-1'].termExpirationYear).toBe(parsed1['term-policy-1'].termExpirationYear);
    expect(parsedRestored['term-policy-1'].totalPremiumsPaid).toBe(parsed1['term-policy-1'].totalPremiumsPaid);
    expect(parsedRestored['term-policy-1'].currentPremiumAmount).toBe(parsed1['term-policy-1'].currentPremiumAmount);
    expect(parsedRestored['term-policy-1'].renewalCount).toBe(parsed1['term-policy-1'].renewalCount);
    expect(parsedRestored['term-policy-1'].convertedToWholeDate).toBe(parsed1['term-policy-1'].convertedToWholeDate);
  });
});
