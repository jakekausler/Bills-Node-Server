import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const LONG_HORIZON = '2080-12-31';

describe('STAGE-033-004: correctness whole-run (long horizon)', () => {
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

  it('warm run AccountsAndTransfers equals cold run (50-year horizon)', async () => {
    const harness = createHarness({ fixtureDir, endDate: LONG_HORIZON });

    const cold = await harness.runCold();
    coldLogPath = cold.debugLogPath;

    const warm = await harness.runWarm();
    warmLogPath = warm.debugLogPath;

    // Sanity: engine produced accounts
    expect(cold.result.accounts.length).toBeGreaterThan(0);

    harness.compareAccountsAndTransfers(warm.result, cold.result);
    harness.compareManagerStates(warm.managerStates, cold.managerStates);
  }, 600000);
});
