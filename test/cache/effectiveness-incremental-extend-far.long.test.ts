import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';
const LONG_HORIZON = '2080-12-31';

describe('STAGE-033-003: effectiveness-incremental-extend-far', () => {
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

  it(
    'extending cold 2030 → warm 2080: old segments hit, new segments compute',
    async () => {
      // Phase 1: cold run to 2030. Populates segment cache for all 2026–2030 segments.
      const coldHarness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });
      const cold = await coldHarness.runCold();
      coldLogPath = cold.debugLogPath;

      const coldEvents = coldHarness.loadDebugEvents(cold.debugLogPath);
      const coldPopulates = coldEvents.filter(
        e => e.component === 'segment' && e.event === 'cache-populate'
      ).length;
      expect(coldPopulates).toBeGreaterThan(0);

      // Phase 2: warm run to 2080. Segment cache for 2026–2030 is preserved in memory.
      // clearCalcCachesOnly() (called by runWarm) does NOT evict segment cache entries.
      const warmHarness = createHarness({ fixtureDir, endDate: LONG_HORIZON });
      const warm = await warmHarness.runWarm();
      warmLogPath = warm.debugLogPath;

      const warmEvents = warmHarness.loadDebugEvents(warm.debugLogPath);

      // All segments in the cold range must be cache hits — no recomputation.
      expect(() =>
        warmHarness.assertCacheHits(warmEvents, {
          dateRange: { start: '2026-01-01', end: SHORT_HORIZON },
        })
      ).not.toThrow();

      // Segments strictly after 2030-12-31 must be cache misses requiring computation.
      expect(() =>
        warmHarness.assertCacheMisses(warmEvents, {
          dateRange: { start: '2031-01-01', end: LONG_HORIZON },
        })
      ).not.toThrow();

      // Sanity: new segments must exist (2080 horizon adds many years of segments).
      const newMisses = warmEvents.filter(
        e =>
          e.component === 'segment' &&
          e.event === 'cache-miss' &&
          e.startDate !== undefined &&
          e.startDate > SHORT_HORIZON
      );
      expect(newMisses.length).toBeGreaterThan(0);
    },
    600000  // 10 minutes — 50 years of additional computation
  );
});
