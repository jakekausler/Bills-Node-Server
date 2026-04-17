import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHarness } from '../helpers/cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');
const SHORT_HORIZON = '2030-12-31';

describe('STAGE-033-003: effectiveness-zero-compute-on-hit', () => {
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
    'cache hit must never co-occur with segment-compute-start for the same segmentId',
    async () => {
      // On a cache hit, the engine must early-return from segment processing.
      // If any cache-hit segmentId also emits segment-compute-start, that is a regression
      // in the early-return path at Bills-Node-Server/src/utils/calculate-v3/segment-processor.ts:176.

      const harness = createHarness({ fixtureDir, endDate: SHORT_HORIZON });

      const cold = await harness.runCold();
      coldLogPath = cold.debugLogPath;

      const warm = await harness.runWarm();
      warmLogPath = warm.debugLogPath;

      const warmEvents = harness.loadDebugEvents(warm.debugLogPath);
      const segmentEvents = warmEvents.filter(e => e.component === 'segment');

      // Collect all segmentIds that produced a cache-hit event.
      const hitSegmentIds = new Set<string>(
        segmentEvents
          .filter(e => e.event === 'cache-hit')
          .map(e => String(e.segmentId ?? `${e.startDate}_${e.endDate}`))
      );

      // There must be at least one hit (otherwise the warm run did nothing warm).
      expect(hitSegmentIds.size).toBeGreaterThan(0);

      // For every segment that hit the cache, assert zero segment-compute-start events.
      const illegalComputes = segmentEvents.filter(
        e =>
          e.event === 'segment-compute-start' &&
          hitSegmentIds.has(String(e.segmentId ?? `${e.startDate}_${e.endDate}`))
      );

      if (illegalComputes.length > 0) {
        const examples = illegalComputes
          .slice(0, 5)
          .map(e => `  segmentId=${e.segmentId ?? `${e.startDate}_${e.endDate}`}`)
          .join('\n');
        throw new Error(
          `effectiveness-zero-compute-on-hit FAILED:\n` +
          `${illegalComputes.length} segment(s) produced both cache-hit AND segment-compute-start.\n` +
          `This is a regression in segment-processor.ts early-return path (line ~176).\n` +
          `Affected segments (up to 5):\n${examples}`
        );
      }

      // All good — no hit segment triggered recomputation.
      expect(illegalComputes.length).toBe(0);
    },
    240000
  );
});
