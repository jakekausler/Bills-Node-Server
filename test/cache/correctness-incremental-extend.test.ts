import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const COLD_HORIZON   = '2028-12-31';
const EXTEND_HORIZON = '2029-12-31';

describe('STAGE-033-004: correctness incremental-extend (short horizons)', () => {
  const originalEnv = process.env.BILLS_DATA_DIR;
  let coldLogPath:    string | undefined;
  let warmLogPath:    string | undefined;
  let refLogPath:     string | undefined;

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
    if (refLogPath) {
      await fs.promises.rm(refLogPath, { recursive: true, force: true });
      refLogPath = undefined;
    }
  });

  it('warm-extended-to-2029 result equals fresh-cold-to-2029 result', async () => {
    // Step 1: cold run to 2028 — populates segment cache for 2026–2028.
    const coldHarness = createHarness({ fixtureDir, endDate: COLD_HORIZON });
    const cold = await coldHarness.runCold();
    coldLogPath = cold.debugLogPath;

    // Step 2: warm run to 2029 — segment cache from step 1 is preserved in memory.
    // The warm run reuses 2026–2028 segments from cache and computes 2029 segments fresh.
    const warmHarness = createHarness({ fixtureDir, endDate: EXTEND_HORIZON });
    const warm = await warmHarness.runWarm();
    warmLogPath = warm.debugLogPath;

    // Step 3: fresh cold run to 2029 — reference result with no cache influence.
    const refHarness = createHarness({ fixtureDir, endDate: EXTEND_HORIZON });
    const ref = await refHarness.runCold();
    refLogPath = ref.debugLogPath;

    // Sanity: engine produced accounts
    expect(ref.result.accounts.length).toBeGreaterThan(0);

    // The warm-extended result must equal the fresh-cold-to-2029 reference.
    // Divergence here indicates incremental extension produces different state
    // than a fresh full run to the same horizon.
    warmHarness.compareAccountsAndTransfers(warm.result, ref.result);
    warmHarness.compareManagerStates(warm.managerStates, ref.managerStates);
  }, 120000);
});
