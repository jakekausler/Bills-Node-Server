import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const LONG_HORIZON = '2080-12-31';

describe('STAGE-033-005: segment retirement drawdown (long horizon)', () => {
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

  it('warm and cold boundary snapshots agree on retirement social security and pensions per segment', async () => {
    const harness = createHarness({ fixtureDir, endDate: LONG_HORIZON });

    const cold = await harness.runColdWithBoundarySnapshots();
    coldLogPath = cold.debugLogPath;

    const warm = await harness.runWarmWithBoundarySnapshots();
    warmLogPath = warm.debugLogPath;

    expect(cold.boundarySnapshots.length).toBeGreaterThan(0);

    harness.compareBoundarySnapshots(
      warm.boundarySnapshots,
      cold.boundarySnapshots,
      (snap) => {
        if (!snap.retirement) return null;
        return {
          socialSecurity: snap.retirement.socialSecurity.map((s) => ({
            name: s.name,
            monthlyPay: s.monthlyPay,
            firstPaymentYear: s.firstPaymentYear,
          })),
          pensions: snap.retirement.pensions.map((p) => ({
            name: p.name,
            monthlyPay: p.monthlyPay,
            firstPaymentYear: p.firstPaymentYear,
          })),
        };
      },
      'retirement.socialSecurity + pensions',
    );
  }, 900000);
});
