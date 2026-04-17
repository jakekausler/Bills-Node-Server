import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';

describe('STAGE-033-005: segment healthcare deductible (short horizon)', () => {
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

  it('warm and cold boundary snapshots agree on healthcare individualDeductible per segment', async () => {
    const harness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });

    const cold = await harness.runColdWithBoundarySnapshots();
    coldLogPath = cold.debugLogPath;

    const warm = await harness.runWarmWithBoundarySnapshots();
    warmLogPath = warm.debugLogPath;

    expect(cold.boundarySnapshots.length).toBeGreaterThan(0);

    // Extract total individualDeductible across all trackers for Kendall account
    // Kendall account ID: fbc8afbe-921d-4b9b-811a-7ca7eaa120ba
    const KENDALL_ID = 'fbc8afbe-921d-4b9b-811a-7ca7eaa120ba';
    harness.compareBoundarySnapshots(
      warm.boundarySnapshots,
      cold.boundarySnapshots,
      (snap) => {
        if (!snap.healthcare) return null;
        return snap.healthcare.trackers.map((t) => ({
          key: t.key,
          planYear: t.planYear,
          kendallDeductible: t.individualDeductible[KENDALL_ID] ?? 0,
          familyDeductible: t.familyDeductible,
        }));
      },
      'healthcare.trackers[*].individualDeductible[Kendall]',
    );
  }, 240000);
});
