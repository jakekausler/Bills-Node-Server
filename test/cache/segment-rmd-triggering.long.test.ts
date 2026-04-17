import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const LONG_HORIZON = '2080-12-31';

// Jake's birth year is needed to compute age-73 RMD trigger year.
// Per fixture data, Jake checking: f2eba978-1ba4-40da-87eb-7671e73c0ad0
// Jake 401k: 8a06d434-8cab-4607-875d-e1cbab574534

describe('STAGE-033-005: segment RMD triggering (long horizon)', () => {
  const originalEnv = process.env.BILLS_DATA_DIR;
  let coldLogPath: string | undefined;
  let warmLogPath: string | undefined;

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.BILLS_DATA_DIR;
    } else {
      process.env.BILLS_DATA_DIR = originalEnv;
    }
    if (coldLogPath) {
      await fs.promises.rm(coldLogPath, { recursive: true, force: true });
      coldLogPath = undefined;
    }
    if (warmLogPath) {
      await fs.promises.rm(warmLogPath, { recursive: true, force: true });
      warmLogPath = undefined;
    }
  });

  it('warm and cold boundary snapshots agree on tax fica and ordinary income around RMD trigger years', async () => {
    const harness = createHarness({ fixtureDir, endDate: LONG_HORIZON });

    const cold = await harness.runColdWithBoundarySnapshots();
    coldLogPath = cold.debugLogPath;

    const warm = await harness.runWarmWithBoundarySnapshots();
    warmLogPath = warm.debugLogPath;

    expect(cold.boundarySnapshots.length).toBeGreaterThan(0);

    // RMD distributions appear as retirement income in the tax manager.
    // Compare tax.years entries for years 2048+ (approximate Jake age-73 window)
    // to localize the segment where warm/cold first diverge on RMD-driven income.
    harness.compareBoundarySnapshots(
      warm.boundarySnapshots,
      cold.boundarySnapshots,
      (snap) => {
        if (!snap.tax) return null;
        // Focus on years 2045 and beyond where RMDs are expected
        const rmdYears = snap.tax.years.filter((y) => y.year >= 2045);
        return rmdYears.map((y) => ({
          year: y.year,
          totalRetirementIncome: Object.values(y.occurrencesByAccount).reduce(
            (sum, arr) =>
              sum +
              arr
                .filter((o) => o.incomeType === 'retirement')
                .reduce((s, o) => s + o.amount, 0),
            0,
          ),
          withholdingTotal: y.withholding.reduce(
            (s, w) => s + w.federal + w.state, 0
          ),
        }));
      },
      'tax.years[>=2045].retirementIncome + withholding (RMD window)',
    );
  }, 900000);
});
