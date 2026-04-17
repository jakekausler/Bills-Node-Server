import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const COLD_HORIZON   = '2030-12-31';
const EXTEND_HORIZON = '2080-12-31';

describe('STAGE-033-004: correctness incremental-extend (long horizons)', () => {
  const originalEnv = process.env.BILLS_DATA_DIR;
  let coldLogPath: string | undefined;
  let warmLogPath: string | undefined;
  let refLogPath:  string | undefined;

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

  it('warm-extended-to-2080 result equals fresh-cold-to-2080 result', async () => {
    // Step 1: cold run to 2030 — populates segment cache for 2026–2030.
    const coldHarness = createHarness({ fixtureDir, endDate: COLD_HORIZON });
    const cold = await coldHarness.runCold();
    coldLogPath = cold.debugLogPath;

    // Step 2: warm run to 2080 — reuses 2026–2030 cache, computes 2031–2080 fresh.
    // Catches bugs where manager state accumulated during the cached 2026–2030 window
    // diverges from what a full 2026–2080 cold run would produce, particularly across
    // retirement-path transitions (SS start, RMD, Medicare, ACA eligibility changes).
    const warmHarness = createHarness({ fixtureDir, endDate: EXTEND_HORIZON });
    const warm = await warmHarness.runWarm();
    warmLogPath = warm.debugLogPath;

    // Step 3: fresh cold run to 2080 — reference result.
    const refHarness = createHarness({ fixtureDir, endDate: EXTEND_HORIZON });
    const ref = await refHarness.runCold();
    refLogPath = ref.debugLogPath;

    // Sanity: engine produced accounts
    expect(ref.result.accounts.length).toBeGreaterThan(0);

    warmHarness.compareAccountsAndTransfers(warm.result, ref.result);
    warmHarness.compareManagerStates(warm.managerStates, ref.managerStates);
  }, 600000);
});
