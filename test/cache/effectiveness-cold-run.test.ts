import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';

describe('STAGE-033-003: effectiveness-cold-run-populates', () => {
  const originalEnv = process.env.BILLS_DATA_DIR;
  let debugLogPath: string | undefined;

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.BILLS_DATA_DIR;
    } else {
      process.env.BILLS_DATA_DIR = originalEnv;
    }
    if (debugLogPath) {
      await fs.promises.rm(debugLogPath, { recursive: true, force: true });
      debugLogPath = undefined;
    }
  });

  it('cold run: populate count equals miss count and hit count is zero', async () => {
    const harness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });
    const cold = await harness.runCold();
    debugLogPath = cold.debugLogPath;

    const events = harness.loadDebugEvents(cold.debugLogPath);
    const segmentEvents = events.filter(e => e.component === 'segment');

    const misses = segmentEvents.filter(e => e.event === 'cache-miss');
    const populates = segmentEvents.filter(e => e.event === 'cache-populate');
    const hits = segmentEvents.filter(e => e.event === 'cache-hit');

    // Every segment must have been a miss — nothing was cached.
    expect(misses.length).toBeGreaterThan(0);

    // Every miss must result in a populate — the engine writes every computed segment to cache.
    expect(populates.length).toBe(misses.length);

    // No cache hits on a cold run.
    expect(hits.length).toBe(0);

    // Structural check: assertCacheMisses should not throw for the full run range.
    expect(() =>
      harness.assertCacheMisses(events, {
        dateRange: { start: '2026-01-01', end: SHORT_HORIZON },
      })
    ).not.toThrow();
  }, 120000);
});
