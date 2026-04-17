import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const INTERMEDIATE_COLD = '2028-12-31';
const INTERMEDIATE_WARM = '2029-12-31';

describe('STAGE-033-003: effectiveness-incremental-extend', () => {
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
    'extending cold 2028 → warm 2029: old segments hit, new segments compute',
    async () => {
      // Phase 1: cold run to 2028. Populates segment cache for all 2026–2028 segments.
      const coldHarness = createHarness({ fixtureDir, endDate: INTERMEDIATE_COLD });
      const cold = await coldHarness.runCold();
      coldLogPath = cold.debugLogPath;

      const coldEvents = coldHarness.loadDebugEvents(cold.debugLogPath);
      const coldPopulates = coldEvents.filter(
        e => e.component === 'segment' && e.event === 'cache-populate'
      ).length;
      expect(coldPopulates).toBeGreaterThan(0);

      // Phase 2: warm run to 2029. Segment cache for 2026–2028 is preserved in memory.
      // The extended harness uses runWarm() which calls clearCalcCachesOnly() — preserving
      // the segment cache written by the cold run.
      const warmHarness = createHarness({ fixtureDir, endDate: INTERMEDIATE_WARM });
      const warm = await warmHarness.runWarm();
      warmLogPath = warm.debugLogPath;

      const warmEvents = warmHarness.loadDebugEvents(warm.debugLogPath);

      // Segments in the cold range (2026–2028) must all be cache hits with zero compute.
      expect(() =>
        warmHarness.assertCacheHits(warmEvents, {
          dateRange: { start: '2026-01-01', end: INTERMEDIATE_COLD },
        })
      ).not.toThrow();

      // Segments strictly after 2028-12-31 must be cache misses with compute-start.
      expect(() =>
        warmHarness.assertCacheMisses(warmEvents, {
          dateRange: { start: '2029-01-01', end: INTERMEDIATE_WARM },
        })
      ).not.toThrow();

      // Sanity: there must be at least one miss in the new range.
      const newMisses = warmEvents.filter(
        e =>
          e.component === 'segment' &&
          e.event === 'cache-miss' &&
          e.startDate !== undefined &&
          e.startDate > INTERMEDIATE_COLD
      );
      expect(newMisses.length).toBeGreaterThan(0);
    },
    120000
  );
});
