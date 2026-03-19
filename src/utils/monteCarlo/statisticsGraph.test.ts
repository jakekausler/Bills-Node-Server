import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock data factories ---

function buildMockResultsFile(overrides: {
  results?: any[];
  metadata?: any;
} = {}) {
  return {
    metadata: {
      startDate: '2026-01-01',
      endDate: '2030-12-31',
      seed: 42,
      accountNames: [
        { id: 'acc1', name: 'Checking' },
        { id: 'acc2', name: 'Savings' },
      ],
      ...overrides.metadata,
    },
    results: overrides.results ?? buildDefaultSimResults(),
  };
}

/**
 * 5 simulations, 3 years (2026-2028).
 * Combined yearlyMinBalances are constructed so percentile math is easy to verify.
 * Per-account balances are provided for filtering tests.
 * Cumulative inflation grows 3% per year from the base year.
 */
function buildDefaultSimResults() {
  // Values chosen so that when sorted for each year the percentile positions are clear:
  // Year 2026 combined: [100, 200, 300, 400, 500]
  // Year 2027 combined: [150, 250, 350, 450, 550]
  // Year 2028 combined: [80, 180, 280, 380, 480]   <-- worst year (median = 280)
  return [
    {
      simulationNumber: 1,
      yearlyMinBalances: { 2026: 300, 2027: 350, 2028: 280 },
      yearlyAccountBalances: {
        2026: { acc1: 200, acc2: 100 },
        2027: { acc1: 250, acc2: 100 },
        2028: { acc1: 180, acc2: 100 },
      },
      cumulativeInflation: { 2026: 1.0, 2027: 1.03, 2028: 1.0609 },
      fundingFailureYear: null,
    },
    {
      simulationNumber: 2,
      yearlyMinBalances: { 2026: 100, 2027: 150, 2028: 80 },
      yearlyAccountBalances: {
        2026: { acc1: 60, acc2: 40 },
        2027: { acc1: 100, acc2: 50 },
        2028: { acc1: 50, acc2: 30 },
      },
      cumulativeInflation: { 2026: 1.0, 2027: 1.04, 2028: 1.0816 },
      fundingFailureYear: 2028,
    },
    {
      simulationNumber: 3,
      yearlyMinBalances: { 2026: 500, 2027: 550, 2028: 480 },
      yearlyAccountBalances: {
        2026: { acc1: 350, acc2: 150 },
        2027: { acc1: 400, acc2: 150 },
        2028: { acc1: 330, acc2: 150 },
      },
      cumulativeInflation: { 2026: 1.0, 2027: 1.02, 2028: 1.0404 },
      fundingFailureYear: null,
    },
    {
      simulationNumber: 4,
      yearlyMinBalances: { 2026: 200, 2027: 250, 2028: 180 },
      yearlyAccountBalances: {
        2026: { acc1: 120, acc2: 80 },
        2027: { acc1: 170, acc2: 80 },
        2028: { acc1: 110, acc2: 70 },
      },
      cumulativeInflation: { 2026: 1.0, 2027: 1.03, 2028: 1.0609 },
      fundingFailureYear: null,
    },
    {
      simulationNumber: 5,
      yearlyMinBalances: { 2026: 400, 2027: 450, 2028: 380 },
      yearlyAccountBalances: {
        2026: { acc1: 280, acc2: 120 },
        2027: { acc1: 320, acc2: 130 },
        2028: { acc1: 260, acc2: 120 },
      },
      cumulativeInflation: { 2026: 1.0, 2027: 1.025, 2028: 1.050625 },
      fundingFailureYear: null,
    },
  ];
}

// Deterministic result returned by loadData mock
const mockDeterministicAccounts = {
  accounts: [
    {
      name: 'Checking',
      id: 'acc1',
      hidden: false,
      consolidatedActivity: [
        { serialize: () => ({ name: 'a', id: '1', amount: 0, balance: 310, from: '', to: '', date: '2026-06-01' }) },
        { serialize: () => ({ name: 'b', id: '2', amount: 0, balance: 360, from: '', to: '', date: '2027-06-01' }) },
        { serialize: () => ({ name: 'c', id: '3', amount: 0, balance: 290, from: '', to: '', date: '2028-06-01' }) },
      ],
    },
    {
      name: 'Savings',
      id: 'acc2',
      hidden: false,
      consolidatedActivity: [
        { serialize: () => ({ name: 'd', id: '4', amount: 0, balance: 110, from: '', to: '', date: '2026-06-01' }) },
        { serialize: () => ({ name: 'e', id: '5', amount: 0, balance: 160, from: '', to: '', date: '2027-06-01' }) },
        { serialize: () => ({ name: 'f', id: '6', amount: 0, balance: 120, from: '', to: '', date: '2028-06-01' }) },
      ],
    },
  ],
};

// --- Mocks ---

let mockResultsData: any;

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify(mockResultsData)),
  existsSync: vi.fn(() => true),
}));

vi.mock('../io/accountsAndTransfers', () => ({
  loadData: vi.fn(() => Promise.resolve(mockDeterministicAccounts)),
}));

// Import under test AFTER mocks are registered
import { computePercentileGraph, PercentileGraphData } from './statisticsGraph';

// --- Helpers ---

/** Linear interpolation percentile matching the source's calculatePercentile */
function expectedPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/** Median of an array (same algorithm as source) */
function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return expectedPercentile(s, 50);
}

// --- Tests ---

describe('computePercentileGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultsData = buildMockResultsFile();
  });

  // ---------------------------------------------------------------
  // 1. Percentile computation — all expected percentiles present
  // ---------------------------------------------------------------
  it('should return datasets for all expected percentiles plus deterministic', async () => {
    const result = await computePercentileGraph('test-sim');

    const expectedPercentiles = [0, 5, 25, 40, 50, 60, 75, 95, 100];
    const percentileDatasets = result.datasets.filter((d) => d.percentile !== undefined);
    const deterministicDatasets = result.datasets.filter((d) => d.isDeterministic);

    // One dataset per percentile
    expect(percentileDatasets).toHaveLength(expectedPercentiles.length);
    for (const p of expectedPercentiles) {
      expect(percentileDatasets.find((d) => d.percentile === p)).toBeDefined();
    }

    // The deterministic line should also be present
    expect(deterministicDatasets).toHaveLength(1);
    expect(deterministicDatasets[0].label).toBe('Deterministic');

    // Labels should be the sorted years
    expect(result.labels).toEqual(['2026', '2027', '2028']);
    expect(result.type).toBe('percentile');
  });

  // ---------------------------------------------------------------
  // 1b. Verify actual percentile values for 50th percentile (median)
  // ---------------------------------------------------------------
  it('should compute correct median values from simulation data', async () => {
    const result = await computePercentileGraph('test-sim');
    const medianDs = result.datasets.find((d) => d.percentile === 50)!;

    // Sorted combined for each year: [100,200,300,400,500], [150,250,350,450,550], [80,180,280,380,480]
    expect(medianDs.data[0]).toBe(300); // median of [100,200,300,400,500]
    expect(medianDs.data[1]).toBe(350); // median of [150,250,350,450,550]
    expect(medianDs.data[2]).toBe(280); // median of [80,180,280,380,480]
  });

  // ---------------------------------------------------------------
  // 2. Per-account filtering
  // ---------------------------------------------------------------
  it('should compute percentiles from a single account when accountId is provided', async () => {
    const result = await computePercentileGraph('test-sim', 'acc1');

    const medianDs = result.datasets.find((d) => d.percentile === 50)!;

    // acc1 values per year:
    // 2026: [60, 120, 200, 280, 350] -> median = 200
    // 2027: [100, 170, 250, 320, 400] -> median = 250
    // 2028: [50, 110, 180, 260, 330] -> median = 180
    const acc1_2026 = [60, 120, 200, 280, 350].sort((a, b) => a - b);
    const acc1_2027 = [100, 170, 250, 320, 400].sort((a, b) => a - b);
    const acc1_2028 = [50, 110, 180, 260, 330].sort((a, b) => a - b);

    expect(medianDs.data[0]).toBe(expectedPercentile(acc1_2026, 50));
    expect(medianDs.data[1]).toBe(expectedPercentile(acc1_2027, 50));
    expect(medianDs.data[2]).toBe(expectedPercentile(acc1_2028, 50));

    // Labels should include account name
    expect(medianDs.label).toContain('Checking');
    expect(medianDs.accountId).toBe('acc1');
    expect(medianDs.accountName).toBe('Checking');
  });

  // ---------------------------------------------------------------
  // 3. Summary stats — worstYear
  // ---------------------------------------------------------------
  it('should identify the worst year as the year with lowest median balance', async () => {
    const result = await computePercentileGraph('test-sim');

    // Medians: 2026=300, 2027=350, 2028=280 => worst = 2028
    expect(result.worstYear).toBeDefined();
    expect(result.worstYear!.year).toBe(2028);
    expect(result.worstYear!.medianMinBalance).toBe(280);
  });

  // ---------------------------------------------------------------
  // 4. Summary stats — finalYear
  // ---------------------------------------------------------------
  it('should compute finalYear percentile stats for the last year', async () => {
    const result = await computePercentileGraph('test-sim');

    // Last year is 2028, sorted combined: [80, 180, 280, 380, 480]
    const sorted2028 = [80, 180, 280, 380, 480];
    expect(result.finalYear).toBeDefined();
    expect(result.finalYear!.median).toBe(expectedPercentile(sorted2028, 50));
    expect(result.finalYear!.p5).toBe(expectedPercentile(sorted2028, 5));
    expect(result.finalYear!.p25).toBe(expectedPercentile(sorted2028, 25));
    expect(result.finalYear!.p75).toBe(expectedPercentile(sorted2028, 75));
    expect(result.finalYear!.p95).toBe(expectedPercentile(sorted2028, 95));
  });

  // ---------------------------------------------------------------
  // 5. Real values — deflated by cumulative inflation
  // ---------------------------------------------------------------
  it('should deflate nominal values by median cumulative inflation for realValues', async () => {
    const result = await computePercentileGraph('test-sim');

    // Median cumulative inflation per year across the 5 sims:
    // 2026: all 1.0 => median = 1.0
    // 2027: [1.02, 1.025, 1.03, 1.03, 1.04] sorted => median = 1.03
    // 2028: [1.0404, 1.050625, 1.0609, 1.0609, 1.0816] sorted => median = 1.0609
    const medianInflation2026 = 1.0;
    const inf2027Sorted = [1.02, 1.025, 1.03, 1.03, 1.04];
    const medianInflation2027 = expectedPercentile(inf2027Sorted, 50);
    const inf2028Sorted = [1.0404, 1.050625, 1.0609, 1.0609, 1.0816].sort((a, b) => a - b);
    const medianInflation2028 = expectedPercentile(inf2028Sorted, 50);

    const medianDs = result.datasets.find((d) => d.percentile === 50)!;
    expect(medianDs.realValues).toBeDefined();
    expect(medianDs.realValues!).toHaveLength(3);

    // realValue = nominalValue / medianCumulativeInflation
    expect(medianDs.realValues![0]).toBeCloseTo(300 / medianInflation2026, 4);
    expect(medianDs.realValues![1]).toBeCloseTo(350 / medianInflation2027, 4);
    expect(medianDs.realValues![2]).toBeCloseTo(280 / medianInflation2028, 4);

    // worstYear should also have real value
    expect(result.worstYear!.realMedianMinBalance).toBeCloseTo(280 / medianInflation2028, 4);

    // finalYear real values
    const sorted2028 = [80, 180, 280, 380, 480];
    expect(result.finalYear!.realMedian).toBeCloseTo(
      expectedPercentile(sorted2028, 50) / medianInflation2028,
      4,
    );
    expect(result.finalYear!.realP5).toBeCloseTo(
      expectedPercentile(sorted2028, 5) / medianInflation2028,
      4,
    );
    expect(result.finalYear!.realP25).toBeCloseTo(
      expectedPercentile(sorted2028, 25) / medianInflation2028,
      4,
    );
    expect(result.finalYear!.realP75).toBeCloseTo(
      expectedPercentile(sorted2028, 75) / medianInflation2028,
      4,
    );
    expect(result.finalYear!.realP95).toBeCloseTo(
      expectedPercentile(sorted2028, 95) / medianInflation2028,
      4,
    );
  });

  // ---------------------------------------------------------------
  // 6. Seed in metadata
  // ---------------------------------------------------------------
  it('should return the seed from results metadata', async () => {
    const result = await computePercentileGraph('test-sim');
    expect(result.seed).toBe(42);
  });

  it('should return undefined seed when metadata has no seed', async () => {
    mockResultsData = buildMockResultsFile({ metadata: { seed: undefined } });
    const result = await computePercentileGraph('test-sim');
    expect(result.seed).toBeUndefined();
  });
});
