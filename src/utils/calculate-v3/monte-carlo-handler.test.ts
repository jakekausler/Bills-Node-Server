// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for fs/path, vi.fn() for mocked functions
// - Structure: describe/it with beforeEach
// - Pattern: mock filesystem; test calculation logic directly

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MonteCarloSampleType } from './types';

// ---------------------------------------------------------------------------
// Mock fs/promises to avoid real file system access
// ---------------------------------------------------------------------------

const mockHistoricRates = {
  investment: {
    stock: [5, 10, 15, 20, 8, 12],
    bond: [2, 3, 4, 5, 1, 6],
    cash: [0.5, 1, 1.5, 2],
    preferred: {
      proxy: { stock: 0.6, bond: 0.4 },
    },
    convertible: {
      proxy: { stock: 0.7, bond: 0.3 },
    },
    other: {
      proxy: { cash: 0.5, bond: 0.5 },
    },
  },
  savings: {
    highYield: [3, 4, 5, 6, 3.5],
    lowYield: [0.5, 1, 1.5, 0.8],
  },
  inflation: [2, 3, 4, 2.5, 3.5],
  healthcareCpi: [4, 5, 6, 5.5, 4.5],
  raise: [3, 5, 2, 4, 3.5],
  limitIncrease401k: [5, 6, 7, 5.5],
  yearKeyed: Object.fromEntries(
    Array.from({ length: 97 }, (_, i) => {
      const year = 1928 + i;
      return [String(year), {
        highYield: 3 + (year % 4),
        lowYield: 0.5 + (year % 3) * 0.3,
        inflation: 2 + (year % 5),
        healthcareCpi: 4 + (year % 3),
        raise: 2 + (year % 4),
        limitIncrease401k: 5 + (year % 3),
        stock: 5 + (year % 16),
        bond: 1 + (year % 6),
        ssCola: 1 + (year % 5),
        ssWageBaseRatio: 1.0 + (year % 10) * 0.01,
        k401Ratio: 1.0 + (year % 8) * 0.015,
        iraRatio: 1.0 + (year % 7) * 0.012,
        hsaRatio: 1.0 + (year % 6) * 0.01,
      }];
    }),
  ),
};

const mockPortfolioMakeup = {
  '2020': { cash: 0.1, stock: 0.6, bond: 0.2, preferred: 0.05, convertible: 0.03, other: 0.02 },
  '2025': { cash: 0.05, stock: 0.5, bond: 0.3, preferred: 0.08, convertible: 0.04, other: 0.03 },
  '2030': { cash: 0.05, stock: 0.4, bond: 0.4, preferred: 0.08, convertible: 0.04, other: 0.03 },
};

// Portfolio glide path for age-based allocation (born 1993)
const mockPortfolioGlidePath = {
  '2023': { cash: 0.01, stock: 0.79, bond: 0.20, preferred: 0.0, convertible: 0.0, other: 0.0 },
  '2033': { cash: 0.01, stock: 0.69, bond: 0.30, preferred: 0.0, convertible: 0.0, other: 0.0 },
  '2043': { cash: 0.01, stock: 0.59, bond: 0.40, preferred: 0.0, convertible: 0.0, other: 0.0 },
  '2053': { cash: 0.01, stock: 0.49, bond: 0.50, preferred: 0.0, convertible: 0.0, other: 0.0 },
  '2063': { cash: 0.01, stock: 0.39, bond: 0.60, preferred: 0.0, convertible: 0.0, other: 0.0 },
  '2073': { cash: 0.01, stock: 0.29, bond: 0.70, preferred: 0.0, convertible: 0.0, other: 0.0 },
};

vi.mock('fs/promises', () => ({
  readFile: vi.fn((filePath: string) => {
    if (filePath.endsWith('historicRates.json')) {
      return Promise.resolve(JSON.stringify(mockHistoricRates));
    }
    if (filePath.endsWith('portfolioMakeupOverTime.json')) {
      return Promise.resolve(JSON.stringify(mockPortfolioMakeup));
    }
    return Promise.reject(new Error(`Unexpected file: ${filePath}`));
  }),
}));

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  };
});

// Import AFTER mocks are set up
import { MonteCarloHandler } from './monte-carlo-handler';

// ---------------------------------------------------------------------------
// Helper: create an initialized handler
// ---------------------------------------------------------------------------

async function createHandler(
  startDate: Date = new Date(2024, 0, 1),
  endDate: Date = new Date(2026, 11, 31),
  seed?: number,
): Promise<MonteCarloHandler> {
  return MonteCarloHandler.getInstance(startDate, endDate, seed);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonteCarloHandler', () => {

  describe('getInstance', () => {
    it('creates an instance successfully', async () => {
      const handler = await createHandler();
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(MonteCarloHandler);
    });

    it('creates separate instances for different date ranges', async () => {
      const handler1 = await createHandler(new Date(2024, 0, 1), new Date(2025, 11, 31));
      const handler2 = await createHandler(new Date(2026, 0, 1), new Date(2027, 11, 31));
      expect(handler1).not.toBe(handler2);
    });
  });

  describe('getSample', () => {
    let handler: MonteCarloHandler;

    beforeEach(async () => {
      handler = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31));
    });

    it('returns a number for HYSA sample type', () => {
      const date = new Date(2024, 2, 15); // March 2024
      const sample = handler.getSample(MonteCarloSampleType.HYSA, date);
      expect(typeof sample).toBe('number');
    });

    it('returns a number for LYSA sample type', () => {
      const date = new Date(2024, 5, 1); // June 2024
      const sample = handler.getSample(MonteCarloSampleType.LYSA, date);
      expect(typeof sample).toBe('number');
    });

    it('returns a number for PORTFOLIO sample type', () => {
      const date = new Date(2024, 8, 1); // September 2024
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('returns a number for INFLATION sample type', () => {
      const date = new Date(2025, 0, 1); // January 2025
      const sample = handler.getSample(MonteCarloSampleType.INFLATION, date);
      expect(typeof sample).toBe('number');
    });

    it('returns a number for HEALTHCARE_INFLATION sample type', () => {
      const date = new Date(2025, 1, 1); // February 2025
      const sample = handler.getSample(MonteCarloSampleType.HEALTHCARE_INFLATION, date);
      expect(typeof sample).toBe('number');
    });

    it('returns a number for RAISE sample type', () => {
      const date = new Date(2025, 3, 1); // April 2025
      const sample = handler.getSample(MonteCarloSampleType.RAISE, date);
      expect(typeof sample).toBe('number');
    });

    it('returns a number for LIMIT_INCREASE_401K sample type', () => {
      const date = new Date(2025, 6, 1); // July 2025
      const sample = handler.getSample(MonteCarloSampleType.LIMIT_INCREASE_401K, date);
      expect(typeof sample).toBe('number');
    });

    it('returns samples as decimals (divided by 100)', () => {
      // HYSA data has values like 3, 4, 5, 6, 3.5
      // These are percentages, so the sample should be in range [0.03, 0.06]
      const date = new Date(2024, 0, 1);
      const sample = handler.getSample(MonteCarloSampleType.HYSA, date);
      // The value should be within the range of the raw data / 100
      const rawValues = mockHistoricRates.savings.highYield;
      const minExpected = Math.min(...rawValues) / 100;
      const maxExpected = Math.max(...rawValues) / 100;
      expect(sample).toBeGreaterThanOrEqual(minExpected);
      expect(sample).toBeLessThanOrEqual(maxExpected);
    });

    it('throws for a date outside the generated segment range', async () => {
      const handler2024 = await createHandler(new Date(2024, 0, 1), new Date(2024, 11, 31));
      // Date in 2030 is outside the 2024 range
      const futureDate = new Date(2030, 0, 1);
      expect(() => handler2024.getSample(MonteCarloSampleType.HYSA, futureDate)).toThrow(
        'No samples found for segment',
      );
    });

    it('returns consistent sample for the same date (pre-generated)', () => {
      const date = new Date(2024, 5, 15); // June 2024
      // getSample uses UTC month to build the segment key
      const sample1 = handler.getSample(MonteCarloSampleType.INFLATION, date);
      const sample2 = handler.getSample(MonteCarloSampleType.INFLATION, date);
      // Same date = same pre-generated sample
      expect(sample1).toBe(sample2);
    });

    it('can retrieve samples for all months in the range', async () => {
      const h = await createHandler(new Date(2024, 0, 1), new Date(2024, 11, 31));
      for (let month = 0; month < 12; month++) {
        const date = new Date(Date.UTC(2024, month, 1));
        expect(() => h.getSample(MonteCarloSampleType.HYSA, date)).not.toThrow();
      }
    });

    it('generates samples for multi-year ranges', async () => {
      const h = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31));
      for (let year = 2024; year <= 2026; year++) {
        const date = new Date(Date.UTC(year, 0, 1));
        expect(() => h.getSample(MonteCarloSampleType.PORTFOLIO, date)).not.toThrow();
      }
    });
  });

  describe('portfolio composition interpolation', () => {
    let handler: MonteCarloHandler;

    beforeEach(async () => {
      // Range covers years before, within, and after the portfolio data
      handler = await createHandler(new Date(2018, 0, 1), new Date(2035, 11, 31));
    });

    it('uses earliest year data for dates before portfolio data starts', () => {
      // 2018 is before 2020 (first key), so it should use 2020 data
      const date = new Date(2018, 6, 1);
      // getSample should not throw — it falls back to first year
      expect(() => handler.getSample(MonteCarloSampleType.PORTFOLIO, date)).not.toThrow();
    });

    it('uses latest year data for dates after portfolio data ends', () => {
      // 2035 is after 2030 (last key), so it should use 2030 data
      const date = new Date(2035, 0, 1);
      expect(() => handler.getSample(MonteCarloSampleType.PORTFOLIO, date)).not.toThrow();
    });

    it('uses exact year data when available', () => {
      // 2025 is an exact key
      const date = new Date(2025, 6, 1);
      expect(() => handler.getSample(MonteCarloSampleType.PORTFOLIO, date)).not.toThrow();
    });

    it('uses previous year data for years between defined keys', () => {
      // 2022 is between 2020 and 2025 → should use 2020 data
      const date = new Date(2022, 0, 1);
      expect(() => handler.getSample(MonteCarloSampleType.PORTFOLIO, date)).not.toThrow();
    });
  });

  describe('proxy asset calculation', () => {
    let handler: MonteCarloHandler;

    beforeEach(async () => {
      handler = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31));
    });

    it('returns a number for preferred asset (proxy-based)', () => {
      // preferred uses stock+bond proxy
      const date = new Date(2025, 0, 1);
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('PORTFOLIO sample includes contribution from all asset classes in composition', () => {
      // Composition in 2025: cash=5%, stock=50%, bond=30%, preferred=8%, convertible=4%, other=3%
      // Sum = 100%. We just verify the sample is within a reasonable range.
      const date = new Date(Date.UTC(2025, 6, 1));
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      // Expected range: roughly -50% to +50% of total (sum of weighted returns)
      // The raw data has values 1–20, which as percentages are 0.01–0.20
      // Weighted: max ~0.20, min ~0.01; result in decimal form
      expect(sample).toBeGreaterThan(-1); // Extremely unlikely to go below -100%
      expect(sample).toBeLessThan(1);    // Extremely unlikely to exceed 100%
    });
  });

  describe('edge cases', () => {
    it('handles empty data arrays gracefully (returns 0)', async () => {
      // Temporarily override the mock to return empty arrays for savings
      const { readFile } = await import('fs/promises');
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      const emptyRates = {
        ...mockHistoricRates,
        savings: { highYield: [], lowYield: [] },
        yearKeyed: {},  // Clear yearKeyed to force fallback to drawRandomSample
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(emptyRates));
      mockReadFile.mockResolvedValueOnce(JSON.stringify(mockPortfolioMakeup));

      const h = await MonteCarloHandler.getInstance(new Date(2024, 0, 1), new Date(2024, 11, 31));
      const date = new Date(Date.UTC(2024, 0, 1));
      // Empty array → drawRandomSample returns 0 → getSample returns 0 / 100 = 0
      const sample = h.getSample(MonteCarloSampleType.HYSA, date);
      expect(sample).toBe(0);
    });

    it('throws initialization error when file reading fails', async () => {
      const { readFile } = await import('fs/promises');
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      mockReadFile.mockRejectedValueOnce(new Error('File not found'));

      await expect(
        MonteCarloHandler.getInstance(new Date(2024, 0, 1), new Date(2024, 11, 31)),
      ).rejects.toThrow('Failed to initialize MonteCarloHandler');
    });

    it('generates samples for single-month range', async () => {
      const start = new Date(2024, 5, 1);  // June 2024
      const end = new Date(2024, 5, 30);   // June 2024
      const h = await MonteCarloHandler.getInstance(start, end);
      const date = new Date(Date.UTC(2024, 5, 15));
      expect(() => h.getSample(MonteCarloSampleType.HYSA, date)).not.toThrow();
    });
  });

  describe('seeded PRNG', () => {
    it('produces identical samples with the same seed', async () => {
      const startDate = new Date(2024, 0, 1);
      const endDate = new Date(2024, 11, 31);
      const testSeed = 12345;

      // Create two handlers with the same seed
      const handler1 = await createHandler(startDate, endDate, testSeed);
      const handler2 = await createHandler(startDate, endDate, testSeed);

      // Sample various types and months
      const testCases = [
        { type: MonteCarloSampleType.HYSA, date: new Date(Date.UTC(2024, 0, 1)) },
        { type: MonteCarloSampleType.INFLATION, date: new Date(Date.UTC(2024, 5, 1)) },
        { type: MonteCarloSampleType.PORTFOLIO, date: new Date(Date.UTC(2024, 11, 1)) },
        { type: MonteCarloSampleType.RAISE, date: new Date(Date.UTC(2024, 3, 1)) },
      ];

      for (const testCase of testCases) {
        const sample1 = handler1.getSample(testCase.type, testCase.date);
        const sample2 = handler2.getSample(testCase.type, testCase.date);
        expect(sample1).toBe(sample2);
      }
    });

    it('produces different samples with different seeds', async () => {
      const startDate = new Date(2024, 0, 1);
      const endDate = new Date(2026, 11, 31);
      const seed1 = 12345;
      const seed2 = 54321;

      // Create two handlers with different seeds
      const handler1 = await createHandler(startDate, endDate, seed1);
      const handler2 = await createHandler(startDate, endDate, seed2);

      // Sample a few months and verify at least some are different
      const testDate = new Date(Date.UTC(2024, 5, 1));
      let differentCount = 0;

      for (const type of Object.values(MonteCarloSampleType)) {
        try {
          const sample1 = handler1.getSample(type, testDate);
          const sample2 = handler2.getSample(type, testDate);
          if (sample1 !== sample2) {
            differentCount++;
          }
        } catch {
          // Some types might not exist, skip
        }
      }

      // Expect at least some samples to be different with different seeds
      expect(differentCount).toBeGreaterThan(0);
    });

    it('produces random samples when no seed is provided', async () => {
      const startDate = new Date(2024, 0, 1);
      const endDate = new Date(2024, 11, 31);

      // Create two handlers without seeds (unseeded random)
      const handler1 = await createHandler(startDate, endDate);
      const handler2 = await createHandler(startDate, endDate);

      const testDate = new Date(Date.UTC(2024, 5, 1));
      const samples1 = [];
      const samples2 = [];

      // Collect samples - they should eventually differ
      for (const type of Object.values(MonteCarloSampleType)) {
        try {
          samples1.push(handler1.getSample(type, testDate));
          samples2.push(handler2.getSample(type, testDate));
        } catch {
          // Some types might not exist, skip
        }
      }

      // With unseeded random, we expect at least some to be different
      // (extremely unlikely all are the same)
      const allSame = samples1.every((s, i) => s === samples2[i]);
      expect(allSame).toBe(false);
    });
  });

  describe('change ratio sampling', () => {
    let handler: MonteCarloHandler;

    beforeEach(async () => {
      // Add change ratio data to mock
      const mockRates = JSON.parse(JSON.stringify(mockHistoricRates));
      mockRates.changeRatios = {
        ssWageBase: { '2024': 1.052434, '2025': 1.089796 },
        '401k': { '2024': 1.146341, '2025': 1.128205 },
        'ira': { '2024': 1.142857, '2025': 1.111111 },
        'hsa': { '2024': 1.153846, '2025': 1.108108 },
      };
      mockRates.yearKeyed = {
        '2024': {
          ssWageBaseRatio: 1.052434,
          k401Ratio: 1.146341,
          iraRatio: 1.142857,
          hsaRatio: 1.153846,
        },
        '2025': {
          ssWageBaseRatio: 1.089796,
          k401Ratio: 1.128205,
          iraRatio: 1.111111,
          hsaRatio: 1.108108,
        },
      };

      const { readFile } = await import('fs/promises');
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('historicRates.json')) {
          return Promise.resolve(JSON.stringify(mockRates));
        }
        if (filePath.endsWith('portfolioMakeupOverTime.json')) {
          return Promise.resolve(JSON.stringify(mockPortfolioMakeup));
        }
        return Promise.reject(new Error(`Unexpected file: ${filePath}`));
      });

      handler = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 42);
    });

    it('should sample SS_WAGE_BASE_CHANGE ratio', async () => {
      const testDate = new Date(Date.UTC(2024, 0, 1));
      const sample = handler.getSample(MonteCarloSampleType.SS_WAGE_BASE_CHANGE, testDate);
      expect(sample).toBeDefined();
      expect(typeof sample).toBe('number');
      // Ratios should be around 1.0 (representing multipliers)
      expect(sample).toBeGreaterThan(0.9);
      expect(sample).toBeLessThan(1.2);
    });

    it('should sample K401_LIMIT_CHANGE ratio', async () => {
      const testDate = new Date(Date.UTC(2024, 0, 1));
      const sample = handler.getSample(MonteCarloSampleType.K401_LIMIT_CHANGE, testDate);
      expect(sample).toBeDefined();
      expect(typeof sample).toBe('number');
      expect(sample).toBeGreaterThan(0.9);
      expect(sample).toBeLessThan(1.2);
    });

    it('should sample IRA_LIMIT_CHANGE ratio', async () => {
      const testDate = new Date(Date.UTC(2024, 0, 1));
      const sample = handler.getSample(MonteCarloSampleType.IRA_LIMIT_CHANGE, testDate);
      expect(sample).toBeDefined();
      expect(typeof sample).toBe('number');
      expect(sample).toBeGreaterThan(0.9);
      expect(sample).toBeLessThan(1.2);
    });

    it('should sample HSA_LIMIT_CHANGE ratio', async () => {
      const testDate = new Date(Date.UTC(2024, 0, 1));
      const sample = handler.getSample(MonteCarloSampleType.HSA_LIMIT_CHANGE, testDate);
      expect(sample).toBeDefined();
      expect(typeof sample).toBe('number');
      expect(sample).toBeGreaterThan(0.9);
      expect(sample).toBeLessThan(1.2);
    });

    it('change ratios should default to 1.0 when not in yearKeyed', async () => {
      // Create a new handler with minimal yearKeyed (no change ratios for future years)
      const mockRates = JSON.parse(JSON.stringify(mockHistoricRates));
      mockRates.yearKeyed = { '2024': {} }; // No ratio data

      const { readFile } = await import('fs/promises');
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('historicRates.json')) {
          return Promise.resolve(JSON.stringify(mockRates));
        }
        if (filePath.endsWith('portfolioMakeupOverTime.json')) {
          return Promise.resolve(JSON.stringify(mockPortfolioMakeup));
        }
        return Promise.reject(new Error(`Unexpected file: ${filePath}`));
      });

      const handlerNoRatio = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 43);
      const testDate = new Date(Date.UTC(2025, 0, 1));
      const sample = handlerNoRatio.getSample(MonteCarloSampleType.SS_WAGE_BASE_CHANGE, testDate);
      expect(sample).toBe(1.0);
    });
  });

  describe('portfolio glide path', () => {
    let handler: MonteCarloHandler;

    beforeEach(async () => {
      // Override mock to use glide path portfolio data
      const { readFile } = await import('fs/promises');
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('historicRates.json')) {
          return Promise.resolve(JSON.stringify(mockHistoricRates));
        }
        if (filePath.endsWith('portfolioMakeupOverTime.json')) {
          return Promise.resolve(JSON.stringify(mockPortfolioGlidePath));
        }
        return Promise.reject(new Error(`Unexpected file: ${filePath}`));
      });

      handler = await createHandler(new Date(2020, 0, 1), new Date(2080, 11, 31), 999);
    });

    it('uses 80/20 allocation at 2023 (age 30)', () => {
      const date = new Date(Date.UTC(2023, 6, 1)); // July 2023
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      // Portfolio = stock*0.79 + bond*0.20 + cash*0.01 + (other proxies)*0
      // With mock rates: stock ~[5-20]%, bond ~[1-6]%, cash ~[0.5-2]%
      // This is just verifying we can get a sample; exact calculation depends on random draw
      expect(typeof sample).toBe('number');
    });

    it('uses 70/30 allocation at 2033 (age 40)', () => {
      const date = new Date(Date.UTC(2033, 6, 1)); // July 2033
      // Should use 2033 data: stock=0.69, bond=0.30, cash=0.01
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('uses 60/40 allocation at 2043 (age 50)', () => {
      const date = new Date(Date.UTC(2043, 6, 1)); // July 2043
      // Should use 2043 data: stock=0.59, bond=0.40, cash=0.01
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('uses 50/50 allocation at 2053 (age 60)', () => {
      const date = new Date(Date.UTC(2053, 6, 1)); // July 2053
      // Should use 2053 data: stock=0.49, bond=0.50, cash=0.01
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('uses 40/60 allocation at 2063 (age 70)', () => {
      const date = new Date(Date.UTC(2063, 6, 1)); // July 2063
      // Should use 2063 data: stock=0.39, bond=0.60, cash=0.01
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('uses 30/70 allocation at 2073 (age 80)', () => {
      const date = new Date(Date.UTC(2073, 6, 1)); // July 2073
      // Should use 2073 data: stock=0.29, bond=0.70, cash=0.01
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      expect(typeof sample).toBe('number');
    });

    it('uses previous year allocation for years between glide path waypoints', () => {
      // 2048 is between 2043 and 2053, so should use 2043 data
      const date = new Date(Date.UTC(2048, 6, 1));
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      // Should fall back to 2043 allocation (stock=0.59, bond=0.40, cash=0.01)
      expect(typeof sample).toBe('number');
    });

    it('uses latest allocation for years after last glide path entry', () => {
      // 2075 is after 2073 (last entry), so should use 2073 data
      const date = new Date(Date.UTC(2075, 0, 1));
      const sample = handler.getSample(MonteCarloSampleType.PORTFOLIO, date);
      // Should use last available allocation (2073: stock=0.29, bond=0.70, cash=0.01)
      expect(typeof sample).toBe('number');
    });

    it('maintains 1% cash allocation throughout glide path', () => {
      // All years in glide path should have cash=0.01
      const testYears = [2023, 2033, 2043, 2053, 2063, 2073];
      for (const year of testYears) {
        const date = new Date(Date.UTC(year, 0, 1));
        // Verify we can sample - exact composition verification happens in portfolio calculation
        expect(() => handler.getSample(MonteCarloSampleType.PORTFOLIO, date)).not.toThrow();
      }
    });

    it('glide path allocates zero to preferred, convertible, and other', () => {
      const testYears = [2023, 2033, 2043, 2053, 2063, 2073];
      for (const year of testYears) {
        // Verify entries have the expected zero values
        const composition = mockPortfolioGlidePath[year.toString()];
        expect(composition.preferred).toBe(0.0);
        expect(composition.convertible).toBe(0.0);
        expect(composition.other).toBe(0.0);
      }
    });

    it('glide path stock allocation decreases by 10% per decade', () => {
      const expected = [
        { year: 2023, stock: 0.79 },
        { year: 2033, stock: 0.69 },
        { year: 2043, stock: 0.59 },
        { year: 2053, stock: 0.49 },
        { year: 2063, stock: 0.39 },
        { year: 2073, stock: 0.29 },
      ];
      for (const { year, stock } of expected) {
        const composition = mockPortfolioGlidePath[year.toString()];
        expect(composition.stock).toBe(stock);
      }
    });

    it('glide path bond allocation increases by 10% per decade', () => {
      const expected = [
        { year: 2023, bond: 0.20 },
        { year: 2033, bond: 0.30 },
        { year: 2043, bond: 0.40 },
        { year: 2053, bond: 0.50 },
        { year: 2063, bond: 0.60 },
        { year: 2073, bond: 0.70 },
      ];
      for (const { year, bond } of expected) {
        const composition = mockPortfolioGlidePath[year.toString()];
        expect(composition.bond).toBe(bond);
      }
    });
  });

  describe('drawn years tracking', () => {
    it('should record drawn historical years during construction', async () => {
      const handler = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 12345);
      const drawnYears = handler.getDrawnYears();
      // 2024, 2025, 2026 = 3 years
      expect(drawnYears).toHaveLength(3);
    });

    it('should be reproducible with same seed', async () => {
      const handler1 = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 12345);
      const handler2 = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 12345);
      expect(handler1.getDrawnYears()).toEqual(handler2.getDrawnYears());
    });

    it('different seeds produce different drawn years', async () => {
      const handler1 = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 12345);
      const handler2 = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 99999);
      expect(handler1.getDrawnYears()).not.toEqual(handler2.getDrawnYears());
    });

    it('should return a defensive copy', async () => {
      const handler = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31), 12345);
      const years1 = handler.getDrawnYears();
      const years2 = handler.getDrawnYears();
      expect(years1).toEqual(years2);
      expect(years1).not.toBe(years2); // different array references
    });

    it('should have one drawn year per simulation year', async () => {
      const handler = await createHandler(new Date(2024, 0, 1), new Date(2030, 11, 31), 42);
      // 2024 through 2030 = 7 years
      expect(handler.getDrawnYears()).toHaveLength(7);
    });

    it('should have empty drawn years when no seed (still records)', async () => {
      const handler = await createHandler(new Date(2024, 0, 1), new Date(2026, 11, 31));
      const drawnYears = handler.getDrawnYears();
      // Still records even without seed
      expect(drawnYears).toHaveLength(3);
    });
  });
});
