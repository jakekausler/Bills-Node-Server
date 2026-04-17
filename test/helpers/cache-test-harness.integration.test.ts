// Integration tests for the cache test harness. These run real engine invocations
// against the epic-033 fixture to verify harness correctness end-to-end.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { createHarness } from './cache-test-harness';

const fixtureDir = path.resolve(__dirname, '../fixtures/epic-033-data');

describe('harness refinement: end-to-end', () => {
  const originalEnv = process.env.BILLS_DATA_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BILLS_DATA_DIR;
    } else {
      process.env.BILLS_DATA_DIR = originalEnv;
    }
  });
  it('runCold completes a real short-horizon engine run', async () => {
    const harness = createHarness({ fixtureDir, endDate: '2030-12-31' });
    const result = await harness.runCold();

    expect(result.result).toBeTruthy();
    expect(result.result.accounts).toBeInstanceOf(Array);
    expect(result.result.accounts.length).toBeGreaterThan(0);
    expect(result.managerStates).toBeTruthy();
    expect(result.debugLogPath).toMatch(/\/tmp\/debug-/);
  }, 120000);

  it('runWarm after runCold shows segment cache hits', async () => {
    const harness = createHarness({ fixtureDir, endDate: '2030-12-31' });

    const cold = await harness.runCold();
    const coldEvents = harness.loadDebugEvents(cold.debugLogPath);
    const coldMisses = coldEvents.filter(e => e.event === 'cache-miss').length;
    const coldPopulates = coldEvents.filter(e => e.event === 'cache-populate').length;

    expect(coldMisses).toBeGreaterThan(0);
    expect(coldPopulates).toBeGreaterThan(0);

    const warm = await harness.runWarm();
    const warmEvents = harness.loadDebugEvents(warm.debugLogPath);
    const warmHits = warmEvents.filter(e => e.event === 'cache-hit').length;

    expect(warmHits).toBeGreaterThan(0);
  }, 240000);

  it('two cold runs produce identical manager states', async () => {
    const harness = createHarness({ fixtureDir, endDate: '2030-12-31' });

    const run1 = await harness.runCold();
    const run2 = await harness.runCold();

    // Should not throw
    expect(() => {
      harness.compareManagerStates(run1.managerStates, run2.managerStates);
    }).not.toThrow();
  }, 240000);

  it('throws when fixture path is outside test/fixtures/', async () => {
    const harness = createHarness({ fixtureDir: '/storage/programs/billsV2Dev/Bills-Node-Server/data' });
    await expect(harness.runCold()).rejects.toThrow(/fixtures/);
  }, 30000);
});
