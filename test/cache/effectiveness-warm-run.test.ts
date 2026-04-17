import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';

describe('STAGE-033-003: effectiveness-warm-run-hits', () => {
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

  it('warm run: all segments hit cache and zero segment-compute-start events', async () => {
    const harness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });

    const cold = await harness.runCold();
    coldLogPath = cold.debugLogPath;

    const coldEvents = harness.loadDebugEvents(cold.debugLogPath);
    const coldPopulates = coldEvents.filter(
      e => e.component === 'segment' && e.event === 'cache-populate'
    ).length;
    expect(coldPopulates).toBeGreaterThan(0);

    const warm = await harness.runWarm();
    warmLogPath = warm.debugLogPath;

    const warmEvents = harness.loadDebugEvents(warm.debugLogPath);
    const warmHits = warmEvents.filter(
      e => e.component === 'segment' && e.event === 'cache-hit'
    ).length;
    const warmComputes = warmEvents.filter(
      e => e.component === 'segment' && e.event === 'segment-compute-start'
    ).length;

    // Must have at least as many hits as segments populated in the cold run.
    expect(warmHits).toBeGreaterThanOrEqual(coldPopulates);

    // The engine must skip all computation on a warm run for the same horizon.
    expect(warmComputes).toBe(0);

    // assertCacheHits should not throw for the full run range.
    expect(() =>
      harness.assertCacheHits(warmEvents, {
        dateRange: { start: '2026-01-01', end: SHORT_HORIZON },
      })
    ).not.toThrow();
  }, 240000);
});
