import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InheritanceManager, BenefactorConfig, MortalityGate } from './inheritance-manager';
import { SSALifeTable } from './ssa-mortality';
import { MonteCarloSampleType, MCRateGetter } from './types';

// Mock loadVariable for deterministic healthcare-inflation lookup
vi.mock('../simulation/variable', () => ({
  loadVariable: vi.fn(() => 0.05),
}));

import { loadVariable } from '../simulation/variable';

// ===== Test helpers =====

/** Minimal SSA life table for testing. */
function makeLifeTable(overrides?: Partial<SSALifeTable>): SSALifeTable {
  // By default: age 80 → 5% annual death, age 90 → 15%, age 100 → 40%
  const male: Record<string, number> = { '80': 0.05, '85': 0.10, '90': 0.15, '95': 0.25, '100': 0.40, '110': 0.80 };
  const female: Record<string, number> = { '80': 0.04, '85': 0.08, '90': 0.12, '95': 0.20, '100': 0.35, '110': 0.75 };
  return { male: { ...male, ...overrides?.male }, female: { ...female, ...overrides?.female } };
}

function makeConfig(overrides?: Partial<BenefactorConfig>): BenefactorConfig {
  return {
    id: 'ben-1',
    name: 'Parents Estate',
    person: null,
    depositAccountId: 'acct-checking',
    estimatedPostTaxEstateValue: 500_000,
    parents: [
      { name: 'Dad', gender: 'male', birthDate: '1945-06-15' },
      { name: 'Mom', gender: 'female', birthDate: '1948-03-20' },
    ],
    drawdown: {
      tiers: [
        { minAge: 70, maxAge: 79, baseRate: 0.02 },
        { minAge: 80, maxAge: 89, baseRate: 0.05 },
        { minAge: 90, maxAge: 120, baseRate: 0.10 },
      ],
      healthcareInflationModulated: false,
      healthcareInflationVariable: 'HEALTHCARE_INFLATION',
      referenceHealthcareRate: 0.05,
    },
    deterministicTriggerAge: 90,
    enabled: true,
    ...overrides,
  };
}

function makeMortalityGate(overrides?: Partial<MortalityGate>): MortalityGate {
  return {
    isDeceased: vi.fn(() => false),
    allDeceased: vi.fn(() => false),
    ...overrides,
  };
}

/** Simple counter-based deterministic PRNG. Returns values cycling through the provided array. */
function makePrng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

// ===== Tests =====

describe('InheritanceManager', () => {
  let lifeTable: SSALifeTable;
  let gate: MortalityGate;

  beforeEach(() => {
    vi.clearAllMocks();
    lifeTable = makeLifeTable();
    gate = makeMortalityGate();
  });

  // ----- Test 1: Drawdown tiers apply correctly by oldest parent age -----
  it('applies drawdown tier based on oldest living parent age', () => {
    const config = makeConfig({
      parents: [
        { name: 'Dad', gender: 'male', birthDate: '1945-01-01' },
        { name: 'Mom', gender: 'female', birthDate: '1950-01-01' },
      ],
    });
    const mgr = new InheritanceManager([config], lifeTable, gate, 'test-sim');

    // Year 2025: Dad=80, Mom=75. Oldest living = Dad at 80 → tier 80-89 → 5%
    mgr.evaluateYear(2025);
    const results = mgr.getResults();
    expect(results[0].finalEstateValue).toBeCloseTo(500_000 * (1 - 0.05), 2);

    // Year 2026: Dad=81 → still tier 80-89 → 5%
    mgr.evaluateYear(2026);
    const results2 = mgr.getResults();
    expect(results2[0].finalEstateValue).toBeCloseTo(500_000 * (1 - 0.05) * (1 - 0.05), 2);
  });

  // ----- Test 2: Healthcare inflation modulation scales drawdown rate -----
  it('modulates drawdown rate by healthcare inflation ratio', () => {
    const config = makeConfig({
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1945-01-01' }],
      drawdown: {
        tiers: [{ minAge: 70, maxAge: 120, baseRate: 0.04 }],
        healthcareInflationModulated: true,
        healthcareInflationVariable: 'HEALTHCARE_INFLATION',
        referenceHealthcareRate: 0.05,
      },
    });

    // MC mode: healthcare inflation = 0.10 → modulated rate = 0.04 * (0.10 / 0.05) = 0.08
    const mcGetter: MCRateGetter = (type, _year) => {
      if (type === MonteCarloSampleType.HEALTHCARE_INFLATION) return 0.10;
      return null;
    };

    const mgr = new InheritanceManager([config], lifeTable, gate, 'test-sim');
    mgr.setMCRateGetter(mcGetter);

    mgr.evaluateYear(2025); // Dad=80
    const results = mgr.getResults();
    // With 2x inflation modulation: rate = 0.08
    expect(results[0].finalEstateValue).toBeCloseTo(500_000 * (1 - 0.08), 2);
  });

  // ----- Test 3: Estate approaches zero for very old parents -----
  it('draws estate toward zero over many years of drawdown', () => {
    const config = makeConfig({
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1930-01-01' }],
      drawdown: {
        tiers: [{ minAge: 0, maxAge: 200, baseRate: 0.10 }],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
      // High trigger age so deterministic won't kill parents during drawdown test
      deterministicTriggerAge: 200,
    });

    const mgr = new InheritanceManager([config], lifeTable, gate, 'test-sim');

    // Run 50 years of drawdown (deterministic, no PRNG, trigger age unreachable)
    for (let y = 2030; y < 2080; y++) {
      mgr.evaluateYear(y);
    }

    const results = mgr.getResults();
    // After 50 years at 10%/year: 500000 * (0.9)^50 ≈ 2,623
    expect(results[0].finalEstateValue).toBeLessThan(5000);
    expect(results[0].finalEstateValue).toBeGreaterThan(0);
  });

  // ----- Test 4: MC mode — seeded PRNG produces deterministic parent death ages -----
  it('produces deterministic parent death ages with seeded PRNG in MC mode', () => {
    // Use a life table with high death probability so deaths happen reliably
    const highMortality = makeLifeTable({ male: { '80': 0.60 } });
    const config = makeConfig({
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1945-01-01' }],
      drawdown: {
        tiers: [{ minAge: 0, maxAge: 200, baseRate: 0.01 }],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
    });

    // PRNG returns 0.30 — below 0.60 threshold, so Dad dies at age 80 (year 2025)
    const prng = makePrng([0.30]);
    const mgr = new InheritanceManager([config], highMortality, gate, 'test-sim');

    mgr.evaluateYear(2025, prng);
    const results = mgr.getResults();
    expect(results[0].parentDeathDates['Dad']).not.toBeNull();
    expect(results[0].inheritancePaid).toBe(true);

    // Run again with different seed that doesn't kill
    const mgr2 = new InheritanceManager([config], highMortality, gate, 'test-sim');
    const prng2 = makePrng([0.90]); // above 0.60 threshold → survives
    mgr2.evaluateYear(2025, prng2);
    const results2 = mgr2.getResults();
    expect(results2[0].parentDeathDates['Dad']).toBeNull();
    expect(results2[0].inheritancePaid).toBe(false);
  });

  // ----- Test 5: MC mode — both parents must die before inheritance triggers -----
  it('requires both parents to die before inheritance triggers in MC mode', () => {
    const highMortality = makeLifeTable({
      male: { '80': 0.90 },
      female: { '75': 0.01 },
    });
    const config = makeConfig({
      parents: [
        { name: 'Dad', gender: 'male', birthDate: '1945-01-01' },
        { name: 'Mom', gender: 'female', birthDate: '1950-01-01' },
      ],
      drawdown: {
        tiers: [{ minAge: 0, maxAge: 200, baseRate: 0.01 }],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
    });

    // PRNG: first call (Dad roll) = 0.05 < 0.90 → dies;
    //       second call (Mom roll) = 0.50 > 0.01 → lives
    const prng = makePrng([0.05, 0.50]);
    const mgr = new InheritanceManager([config], highMortality, gate, 'test-sim');

    mgr.evaluateYear(2025, prng);
    const results = mgr.getResults();

    // Dad dead, Mom alive → no inheritance yet
    expect(results[0].parentDeathDates['Dad']).not.toBeNull();
    expect(results[0].parentDeathDates['Mom']).toBeNull();
    expect(results[0].inheritancePaid).toBe(false);
    expect(mgr.getPayoutActivities()).toHaveLength(0);
  });

  // ----- Test 6: Deterministic mode — triggers at deterministicTriggerAge -----
  it('triggers inheritance when youngest parent reaches deterministicTriggerAge', () => {
    const config = makeConfig({
      parents: [
        { name: 'Dad', gender: 'male', birthDate: '1940-01-01' },
        { name: 'Mom', gender: 'female', birthDate: '1945-01-01' }, // younger
      ],
      deterministicTriggerAge: 85,
      drawdown: {
        tiers: [{ minAge: 0, maxAge: 200, baseRate: 0.02 }],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
    });

    const mgr = new InheritanceManager([config], lifeTable, gate, 'test-sim');

    // Year 2029: Mom=84, Dad=89 → youngest < 85 → no trigger
    mgr.evaluateYear(2029);
    let results = mgr.getResults();
    expect(results[0].inheritancePaid).toBe(false);

    // Year 2030: Mom=85 → youngest >= 85 → trigger
    mgr.evaluateYear(2030);
    results = mgr.getResults();
    expect(results[0].inheritancePaid).toBe(true);
    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].targetAccountId).toBe('acct-checking');
  });

  // ----- Test 7: Person gating — blocked when tied person is deceased -----
  it('blocks payout when tied person is deceased', () => {
    const deceaseGate = makeMortalityGate({
      isDeceased: vi.fn(() => true),
    });

    const config = makeConfig({
      person: 'Jake',
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1940-01-01' }],
      deterministicTriggerAge: 80,
      drawdown: {
        tiers: [],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
    });

    const mgr = new InheritanceManager([config], lifeTable, deceaseGate, 'test-sim');

    // Year 2020: Dad=80 → deterministic trigger fires, but Jake is deceased → blocked
    mgr.evaluateYear(2020);
    const results = mgr.getResults();
    expect(results[0].inheritancePaid).toBe(true);
    expect(mgr.getPayoutActivities()).toHaveLength(0);
  });

  // ----- Test 8: Person gating — null person deposits if anyone alive -----
  it('deposits when person is null and someone is alive', () => {
    const config = makeConfig({
      person: null,
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1940-01-01' }],
      deterministicTriggerAge: 80,
      drawdown: {
        tiers: [],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
    });

    const aliveGate = makeMortalityGate({
      allDeceased: vi.fn(() => false),
    });

    const mgr = new InheritanceManager([config], lifeTable, aliveGate, 'test-sim');

    mgr.evaluateYear(2020); // Dad=80 → trigger
    const payouts = mgr.getPayoutActivities();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].activity.amount).toBe(500_000);
  });

  // ----- Test 9: Person gating — null person blocked if all deceased -----
  it('blocks payout when person is null and all tracked persons are deceased', () => {
    const allDeadGate = makeMortalityGate({
      allDeceased: vi.fn(() => true),
    });

    const config = makeConfig({
      person: null,
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1940-01-01' }],
      deterministicTriggerAge: 80,
      drawdown: {
        tiers: [],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
    });

    const mgr = new InheritanceManager([config], lifeTable, allDeadGate, 'test-sim');

    mgr.evaluateYear(2020); // trigger
    const results = mgr.getResults();
    expect(results[0].inheritancePaid).toBe(true);
    expect(mgr.getPayoutActivities()).toHaveLength(0);
  });

  // ----- Test 10: Checkpoint/restore round-trip preserves state -----
  it('checkpoint/restore round-trip preserves all state', () => {
    const config = makeConfig({
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1945-01-01' }],
      drawdown: {
        tiers: [{ minAge: 0, maxAge: 200, baseRate: 0.05 }],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
      deterministicTriggerAge: 200,
    });

    const mgr = new InheritanceManager([config], lifeTable, gate, 'test-sim');

    // Drawdown one year
    mgr.evaluateYear(2025);
    const beforeResults = mgr.getResults();
    const checkpointData = mgr.checkpoint();

    // Drawdown another year (mutates state)
    mgr.evaluateYear(2026);
    const afterResults = mgr.getResults();
    expect(afterResults[0].finalEstateValue).not.toBeCloseTo(beforeResults[0].finalEstateValue, 2);

    // Restore and verify
    mgr.restore(checkpointData);
    const restoredResults = mgr.getResults();
    expect(restoredResults[0].finalEstateValue).toBeCloseTo(beforeResults[0].finalEstateValue, 2);
  });

  // ----- Test 11: lastDrawdownYear prevents double-drawdown -----
  it('prevents double-drawdown when evaluateYear called twice for the same year', () => {
    const config = makeConfig({
      parents: [{ name: 'Dad', gender: 'male', birthDate: '1945-01-01' }],
      drawdown: {
        tiers: [{ minAge: 0, maxAge: 200, baseRate: 0.10 }],
        healthcareInflationModulated: false,
        healthcareInflationVariable: '',
        referenceHealthcareRate: 0.05,
      },
      deterministicTriggerAge: 200,
    });

    const mgr = new InheritanceManager([config], lifeTable, gate, 'test-sim');

    mgr.evaluateYear(2025);
    const afterFirst = mgr.getResults()[0].finalEstateValue;

    // Call again for the same year — should NOT drawdown again
    mgr.evaluateYear(2025);
    const afterSecond = mgr.getResults()[0].finalEstateValue;

    expect(afterSecond).toBeCloseTo(afterFirst, 2);
    expect(afterFirst).toBeCloseTo(500_000 * 0.90, 2);
  });
});
