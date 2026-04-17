import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';

describe('STAGE-033-005: segment tax income occurrences (short horizon)', () => {
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

  it('warm and cold boundary snapshots agree on tax occurrencesByAccount per segment', async () => {
    const harness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });

    const cold = await harness.runColdWithBoundarySnapshots();
    coldLogPath = cold.debugLogPath;

    const warm = await harness.runWarmWithBoundarySnapshots();
    warmLogPath = warm.debugLogPath;

    expect(cold.boundarySnapshots.length).toBeGreaterThan(0);

    // Compare total income per year at each boundary — count and total amount
    harness.compareBoundarySnapshots(
      warm.boundarySnapshots,
      cold.boundarySnapshots,
      (snap) => {
        if (!snap.tax) return null;
        return snap.tax.years.map((y) => ({
          year: y.year,
          totalOccurrences: Object.values(y.occurrencesByAccount).reduce(
            (sum, arr) => sum + arr.length, 0
          ),
          totalAmount: Object.values(y.occurrencesByAccount).reduce(
            (sum, arr) => sum + arr.reduce((s, o) => s + o.amount, 0), 0
          ),
        }));
      },
      'tax.years[*].occurrencesByAccount (count + totalAmount)',
    );
  }, 240000);
});
