import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeFailureHistogram } from './failureHistogram';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';

const mockReadFile = vi.mocked(readFile);

function buildResultsFile(failureYears: (number | null)[]) {
  return JSON.stringify({
    metadata: { startDate: '2026-01-01', endDate: '2060-12-31', seed: 42 },
    results: failureYears.map((fy, i) => ({
      simulationNumber: i + 1,
      yearlyMinBalances: {},
      fundingFailureYear: fy,
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeFailureHistogram', () => {
  it('returns empty histogram and null years when no simulations fail', async () => {
    mockReadFile.mockResolvedValue(buildResultsFile([null, null, null, null, null]));

    const result = await computeFailureHistogram('test-id');

    expect(result.histogram).toEqual([]);
    expect(result.summary).toEqual({
      totalSimulations: 5,
      failedSimulations: 0,
      medianFailureYear: null,
      earliestFailureYear: null,
      latestFailureYear: null,
    });
  });

  it('computes correct histogram and summary when some simulations fail', async () => {
    // 3 failures: 2030, 2030, 2035; 2 successes
    mockReadFile.mockResolvedValue(buildResultsFile([2030, null, 2030, 2035, null]));

    const result = await computeFailureHistogram('test-id');

    expect(result.histogram).toEqual([
      { year: '2030', count: 2 },
      { year: '2035', count: 1 },
    ]);
    expect(result.summary).toEqual({
      totalSimulations: 5,
      failedSimulations: 3,
      medianFailureYear: 2030, // sorted: [2030, 2030, 2035] → median = 2030
      earliestFailureYear: 2030,
      latestFailureYear: 2035,
    });
  });

  it('computes correct histogram and summary when all simulations fail', async () => {
    mockReadFile.mockResolvedValue(buildResultsFile([2028, 2032, 2030, 2030]));

    const result = await computeFailureHistogram('test-id');

    expect(result.histogram).toEqual([
      { year: '2028', count: 1 },
      { year: '2030', count: 2 },
      { year: '2032', count: 1 },
    ]);
    expect(result.summary).toEqual({
      totalSimulations: 4,
      failedSimulations: 4,
      medianFailureYear: 2030, // sorted: [2028, 2030, 2030, 2032] → avg(2030,2030) = 2030
      earliestFailureYear: 2028,
      latestFailureYear: 2032,
    });
  });

  it('computes correct median for even number of failures with different years', async () => {
    mockReadFile.mockResolvedValue(buildResultsFile([2030, 2040]));

    const result = await computeFailureHistogram('test-id');

    expect(result.summary.medianFailureYear).toBe(2035); // avg(2030, 2040) = 2035
    expect(result.summary.failedSimulations).toBe(2);
  });

  it('handles single failure', async () => {
    mockReadFile.mockResolvedValue(buildResultsFile([null, null, 2045, null]));

    const result = await computeFailureHistogram('test-id');

    expect(result.histogram).toEqual([{ year: '2045', count: 1 }]);
    expect(result.summary).toEqual({
      totalSimulations: 4,
      failedSimulations: 1,
      medianFailureYear: 2045,
      earliestFailureYear: 2045,
      latestFailureYear: 2045,
    });
  });

  it('returns totalSimulations:0, empty histogram, and null years for empty results (0 simulations)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      metadata: { startDate: '2026-01-01', endDate: '2060-12-31', seed: 42 },
      results: [],
    }));

    const result = await computeFailureHistogram('test-id');

    expect(result.histogram).toEqual([]);
    expect(result.summary).toEqual({
      totalSimulations: 0,
      failedSimulations: 0,
      medianFailureYear: null,
      earliestFailureYear: null,
      latestFailureYear: null,
    });
  });
});
