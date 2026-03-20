import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeWorstCases } from './worstCases';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('./statisticsGraph', () => ({
  runDeterministicForWorstCases: vi.fn().mockResolvedValue(null),
}));

import { readFile } from 'fs/promises';
import { runDeterministicForWorstCases } from './statisticsGraph';

const mockReadFile = vi.mocked(readFile);
const mockRunDeterministic = vi.mocked(runDeterministicForWorstCases);

interface SimResult {
  simulationNumber: number;
  yearlyMinBalances: Record<number, number>;
  yearlyAccountBalances?: Record<number, Record<string, number>>;
  cumulativeInflation?: Record<number, number>;
  fundingFailureYear?: number | null;
}

function buildResultsFile(
  results: SimResult[],
  accountNames: Array<{ id: string; name: string }> = [],
) {
  return JSON.stringify({
    metadata: {
      startDate: '2026-01-01',
      endDate: '2030-12-31',
      seed: 42,
      accountNames,
    },
    results,
  });
}

function makeSim(
  num: number,
  yearlyMin: Record<number, number>,
  opts?: {
    yearlyAccount?: Record<number, Record<string, number>>;
    inflation?: Record<number, number>;
    failureYear?: number | null;
  },
): SimResult {
  return {
    simulationNumber: num,
    yearlyMinBalances: yearlyMin,
    yearlyAccountBalances: opts?.yearlyAccount,
    cumulativeInflation: opts?.inflation,
    fundingFailureYear: opts?.failureYear ?? null,
  };
}

describe('computeWorstCases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunDeterministic.mockResolvedValue(null);
  });

  it('selects correct N% of simulations (5% of 100 = 5 sims)', async () => {
    // Create 100 simulations with varying worst balances
    const results: SimResult[] = [];
    for (let i = 1; i <= 100; i++) {
      results.push(
        makeSim(i, { 2026: i * 1000, 2027: i * 500, 2028: i * 200 }),
      );
    }
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 5);

    expect(result.simulations).toHaveLength(5);
    // Should be sorted by worst balance ascending (sim 1-5 have lowest minimums)
    expect(result.simulations.map((s) => s.simulationNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('selects minimum 1 sim when 5% rounds to 0', async () => {
    // 10 simulations: 5% of 10 = 0.5, floor = 0, clamped to 1
    const results: SimResult[] = [];
    for (let i = 1; i <= 10; i++) {
      results.push(makeSim(i, { 2026: i * 1000, 2027: i * 500 }));
    }
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 5);

    expect(result.simulations).toHaveLength(1);
    expect(result.simulations[0].simulationNumber).toBe(1);
  });

  it('sorts by worst balance across all years (not terminal)', async () => {
    // Sim 1: ends high but dips low in the middle
    // Sim 2: ends low but stays moderate throughout
    // Sim 3: uniformly high
    const results = [
      makeSim(1, { 2026: 100000, 2027: -5000, 2028: 200000 }), // worst = -5000
      makeSim(2, { 2026: 50000, 2027: 30000, 2028: 10000 }),   // worst = 10000
      makeSim(3, { 2026: 80000, 2027: 70000, 2028: 60000 }),   // worst = 60000
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50);

    // 50% of 3 = floor(1.5) = 1 sim
    expect(result.simulations).toHaveLength(1);
    // Sim 1 has worst balance of -5000
    expect(result.simulations[0].simulationNumber).toBe(1);
    expect(result.simulations[0].finalBalance).toBe(-5000);
  });

  it('filters by account when accountId is provided', async () => {
    const results = [
      makeSim(1, { 2026: 100000, 2027: 80000 }, {
        yearlyAccount: {
          2026: { 'acc-1': 60000, 'acc-2': 40000 },
          2027: { 'acc-1': 30000, 'acc-2': 50000 },
        },
      }),
      makeSim(2, { 2026: 90000, 2027: 70000 }, {
        yearlyAccount: {
          2026: { 'acc-1': 50000, 'acc-2': 40000 },
          2027: { 'acc-1': 45000, 'acc-2': 25000 },
        },
      }),
      makeSim(3, { 2026: 80000, 2027: 60000 }, {
        yearlyAccount: {
          2026: { 'acc-1': 70000, 'acc-2': 10000 },
          2027: { 'acc-1': 55000, 'acc-2': 5000 },
        },
      }),
    ];
    mockReadFile.mockResolvedValue(
      buildResultsFile(results, [
        { id: 'acc-1', name: 'Checking' },
        { id: 'acc-2', name: 'Savings' },
      ]),
    );

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50, 'acc-1');

    // Per account acc-1: sim1 worst=30000, sim2 worst=45000, sim3 worst=55000
    // 50% of 3 = 1 sim, worst is sim 1
    expect(result.simulations).toHaveLength(1);
    expect(result.simulations[0].simulationNumber).toBe(1);
    // Data should be acc-1 values
    expect(result.simulations[0].data).toEqual([60000, 30000]);
  });

  it('deflates real values by cumulative inflation', async () => {
    const results = [
      makeSim(1, { 2026: 100000, 2027: 110000 }, {
        inflation: { 2026: 1.0, 2027: 1.1 },
      }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50);

    expect(result.simulations).toHaveLength(1);
    expect(result.simulations[0].data).toEqual([100000, 110000]);
    // realData: 100000/1.0 = 100000, 110000/1.1 = 100000
    expect(result.simulations[0].realData[0]).toBeCloseTo(100000);
    expect(result.simulations[0].realData[1]).toBeCloseTo(100000);
  });

  it('clamps percentile: 0 becomes 1', async () => {
    const results = [
      makeSim(1, { 2026: 10000 }),
      makeSim(2, { 2026: 20000 }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 0);

    // 1% of 2 = floor(0.02) = 0, clamped to 1
    expect(result.simulations).toHaveLength(1);
  });

  it('clamps percentile: 100 becomes 50', async () => {
    const results = [
      makeSim(1, { 2026: 10000 }),
      makeSim(2, { 2026: 20000 }),
      makeSim(3, { 2026: 30000 }),
      makeSim(4, { 2026: 40000 }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 100);

    // Clamped to 50: 50% of 4 = 2
    expect(result.simulations).toHaveLength(2);
  });

  it('returns empty simulations array for missing/invalid accountId', async () => {
    const results = [
      makeSim(1, { 2026: 100000 }, {
        yearlyAccount: { 2026: { 'acc-1': 100000 } },
      }),
    ];
    mockReadFile.mockResolvedValue(
      buildResultsFile(results, [{ id: 'acc-1', name: 'Checking' }]),
    );

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 5, 'nonexistent-acc');

    expect(result.simulations).toEqual([]);
  });

  it('includes failure year from simulation data', async () => {
    const results = [
      makeSim(1, { 2026: -5000, 2027: -10000 }, { failureYear: 2026 }),
      makeSim(2, { 2026: 50000, 2027: 60000 }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50);

    expect(result.simulations).toHaveLength(1);
    expect(result.simulations[0].failureYear).toBe(2026);
  });

  it('includes deterministic data when available', async () => {
    const results = [
      makeSim(1, { 2026: 100000, 2027: 90000 }, {
        inflation: { 2026: 1.0, 2027: 1.05 },
      }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));
    mockRunDeterministic.mockResolvedValue({
      combined: { 2026: 120000, 2027: 115000 },
    });

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50);

    expect(result.deterministic.data).toEqual([120000, 115000]);
    expect(result.deterministic.realData[0]).toBeCloseTo(120000); // /1.0
    expect(result.deterministic.realData[1]).toBeCloseTo(115000 / 1.05);
  });

  it('returns empty simulations array for empty results (0 simulations)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      metadata: { startDate: '2026-01-01', endDate: '2030-12-31', seed: 42 },
      results: [],
    }));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 5);

    expect(result.labels).toEqual([]);
    expect(result.simulations).toEqual([]);
    expect(result.deterministic).toEqual({ data: [], realData: [] });
  });

  it('uses perAccount deterministic data when accountId is provided', async () => {
    const results = [
      makeSim(1, { 2026: 100000, 2027: 90000 }, {
        yearlyAccount: {
          2026: { 'acc-1': 60000, 'acc-2': 40000 },
          2027: { 'acc-1': 50000, 'acc-2': 40000 },
        },
        inflation: { 2026: 1.0, 2027: 1.05 },
      }),
    ];
    mockReadFile.mockResolvedValue(
      buildResultsFile(results, [
        { id: 'acc-1', name: 'Checking' },
        { id: 'acc-2', name: 'Savings' },
      ]),
    );
    mockRunDeterministic.mockResolvedValue({
      combined: { 2026: 120000, 2027: 115000 },
      perAccount: {
        2026: { 'acc-1': 70000, 'acc-2': 50000 },
        2027: { 'acc-1': 65000, 'acc-2': 50000 },
      },
    });

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50, 'acc-1');

    // Deterministic data should come from perAccount, not combined
    expect(result.deterministic.data).toEqual([70000, 65000]);
    expect(result.deterministic.realData[0]).toBeCloseTo(70000); // /1.0
    expect(result.deterministic.realData[1]).toBeCloseTo(65000 / 1.05);
  });

  it('throws when results file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));
    await expect(computeWorstCases('00000000-0000-0000-0000-000000000000')).rejects.toThrow('ENOENT');
  });

  it('throws for invalid simulation ID format', async () => {
    await expect(computeWorstCases('../etc/passwd')).rejects.toThrow('Invalid simulation ID format');
  });

  it('returns correct labels as year strings', async () => {
    const results = [
      makeSim(1, { 2026: 100000, 2027: 90000, 2028: 80000 }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(results));

    const result = await computeWorstCases('aabbccdd-1234-5678-9abc-def012345678', 50);

    expect(result.labels).toEqual(['2026', '2027', '2028']);
  });
});
