import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';

describe('STAGE-033-004: correctness manager-state (short horizon)', () => {
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

  it('warm run manager snapshots equal cold run manager snapshots (short horizon)', async () => {
    // Regression net for the March 25 tax-replay bug class:
    // if segment cache replay doesn't reapply TaxManager.taxableOccurrences
    // and withholding, TaxManager.snapshot() diverges between cold and warm.
    // `compareManagerStates` will produce a path-level diff like
    // `tax.years[N].occurrencesByAccount...: X !== Y`.
    const harness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });

    const cold = await harness.runCold();
    coldLogPath = cold.debugLogPath;

    const warm = await harness.runWarm();
    warmLogPath = warm.debugLogPath;

    // Sanity: engine produced accounts
    expect(cold.result.accounts.length).toBeGreaterThan(0);

    // compareManagerStates throws with path-level detail on divergence.
    // Covers TaxManager, HealthcareManager, SpendingTrackerManager,
    // RetirementManager, MedicareManager, AcaManager.
    harness.compareManagerStates(warm.managerStates, cold.managerStates);
  }, 120000);
});
