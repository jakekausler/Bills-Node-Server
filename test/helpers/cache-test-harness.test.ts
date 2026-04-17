import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createHarness } from './cache-test-harness';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/epic-033-data');

describe('cache-test-harness', () => {
  const originalEnv = process.env.BILLS_DATA_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BILLS_DATA_DIR;
    } else {
      process.env.BILLS_DATA_DIR = originalEnv;
    }
  });

  it(
    'runCold returns a non-null AccountsAndTransfers result',
    async () => {
      const harness = createHarness({
        fixtureDir: FIXTURE_DIR,
        endDate: '2027-12-31',
      });
      const { result, debugLogPath, managerStates } = await harness.runCold();
      expect(result).toBeDefined();
      expect(result.accounts).toBeInstanceOf(Array);
      expect(result.accounts.length).toBeGreaterThan(0);
      expect(fs.existsSync(debugLogPath)).toBe(true);
      expect(managerStates.tax).toBeDefined();
      expect(managerStates.spendingTracker).toBeDefined();
    },
    15000,
  );

  it('path-inside-fixtures guard throws on bad fixtureDir', async () => {
    const badDir = path.join(os.tmpdir(), 'not-inside-fixtures-' + Date.now());
    fs.mkdirSync(badDir, { recursive: true });
    try {
      const harness = createHarness({ fixtureDir: badDir, endDate: '2027-12-31' });
      await expect(harness.runCold()).rejects.toThrow(/Test pollution guard/);
    } finally {
      fs.rmSync(badDir, { recursive: true, force: true });
    }
  });

  it('loadDebugEvents parses JSONL mixed events', () => {
    // Build a tiny debug dir with synthetic events.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    const lines = [
      JSON.stringify({ sim: 0, component: 'segment', event: 'cache-hit', startDate: '2026-01-01', endDate: '2026-12-31', segmentId: 'seg-1', at: '2026-04-17T00:00:00.000Z' }),
      JSON.stringify({ sim: 0, component: 'segment', event: 'segment-compute-start', startDate: '2027-01-01', endDate: '2027-12-31', segmentId: 'seg-2', at: '2026-04-17T00:00:01.000Z' }),
      JSON.stringify({ sim: 0, component: 'tax', event: 'occurrence-added', at: '2026-04-17T00:00:02.000Z' }),
      '', // blank line — should be skipped
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(tmp, 'det.jsonl'), lines);

    const harness = createHarness({ fixtureDir: FIXTURE_DIR });
    const events = harness.loadDebugEvents(tmp);
    expect(events.length).toBe(3);
    expect(events.map((e) => e.event)).toEqual(['cache-hit', 'segment-compute-start', 'occurrence-added']);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
