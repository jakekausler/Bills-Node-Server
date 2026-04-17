import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

import { getDataDir } from '../../src/utils/io/io';
import { getAccountsAndTransfers, clearDataCache } from '../../src/utils/io/accountsAndTransfers';
import { calculateAllActivityWithEngine, Engine } from '../../src/utils/calculate-v3/engine';
import { CacheManager } from '../../src/utils/calculate-v3/cache';
import { DebugLogger } from '../../src/utils/calculate-v3/debug-logger';
import { clearRetirementCache } from '../../src/utils/calculate-v3/retirement-manager';
import { clearAcaCache } from '../../src/utils/calculate-v3/aca-manager';
import { clearMedicareCache } from '../../src/utils/calculate-v3/medicare-manager';
import { clearContributionLimitCache } from '../../src/utils/calculate-v3/contribution-limit-manager';
import { clearGlidePathCache } from '../../src/utils/calculate-v3/glide-path-blender';
import { clearProjectionsCache } from '../../src/utils/io/projectionsCache';
import { clearAllGraphCache } from '../../src/api/monteCarlo/monteCarlo';
import type { AccountsAndTransfers } from '../../src/data/account/types';
import type { ManagerStatesSnapshot } from '../../src/utils/calculate-v3/types';

dayjs.extend(utc);

//
// Types
//

export interface HarnessOptions {
  /** Absolute or repo-relative path to the data fixture. Must resolve inside test/fixtures/. */
  fixtureDir: string;
  /** End date for calculations. Defaults to 2030-12-31 (short horizon). */
  endDate?: string | Date;
  /** Simulation name. Defaults to "Default". */
  simulation?: string;
  /**
   * Debug log directory. When omitted, the harness generates
   * /tmp/debug-<uuid>/ per run so parallel tests don't collide.
   */
  debugLogDir?: string;
}

export type { ManagerStatesSnapshot };

export interface RunResult {
  result: AccountsAndTransfers;
  debugLogPath: string;
  managerStates: ManagerStatesSnapshot;
}

export interface BoundarySnapshot {
  segmentId: string;
  endDate: string; // YYYY-MM-DD
  managerState: ManagerStatesSnapshot;
}

export interface RunResultWithBoundaries extends RunResult {
  boundarySnapshots: BoundarySnapshot[];
}

export interface DebugEvent {
  sim: number;
  component: string;
  event: string;
  at: string;
  ts?: string;
  segmentId?: string;
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface Harness {
  runCold(): Promise<RunResult>;
  runWarm(): Promise<RunResult>;
  runColdWithBoundarySnapshots(): Promise<RunResultWithBoundaries>;
  runWarmWithBoundarySnapshots(): Promise<RunResultWithBoundaries>;
  loadDebugEvents(logPath: string): DebugEvent[];
  assertCacheHits(events: DebugEvent[], opts: { dateRange: DateRange }): void;
  assertCacheMisses(events: DebugEvent[], opts: { dateRange: DateRange }): void;
  compareManagerStates(warm: ManagerStatesSnapshot, cold: ManagerStatesSnapshot): void;
  compareAccountsAndTransfers(warm: AccountsAndTransfers, cold: AccountsAndTransfers): void;
  compareBoundarySnapshots<T>(
    warm: BoundarySnapshot[],
    cold: BoundarySnapshot[],
    extractor: (snapshot: ManagerStatesSnapshot) => T,
    label: string,
  ): void;
}

//
// Implementation helpers
//

const FIXTURES_ROOT = path.resolve(__dirname, '../fixtures');
const EPSILON = 1e-6;

function assertInsideFixtures(dataDir: string): void {
  const resolved = path.resolve(dataDir);
  if (!resolved.startsWith(FIXTURES_ROOT + path.sep) && resolved !== FIXTURES_ROOT) {
    throw new Error(
      `Test pollution guard: data dir (${resolved}) is not inside ${FIXTURES_ROOT}. ` +
      `This would read from live project data. Pass an absolute fixtureDir to createHarness().`,
    );
  }
}

function clearAllCaches(): void {
  // Mirror the POST /api/cache/clear ?target=all branch in src/index.ts:1534-1544.
  clearDataCache();
  CacheManager.clearAll();
  clearRetirementCache();
  clearProjectionsCache();
  clearAcaCache();
  clearMedicareCache();
  clearContributionLimitCache();
  clearAllGraphCache();
  clearGlidePathCache();
}

function clearCalcCachesOnly(): void {
  // Mirror the POST /api/cache/clear ?target=calc branch in src/index.ts.
  // Preserves segment cache, balance snapshots, and ancillary static caches.
  clearDataCache();
  CacheManager.clearCalculationResultsOnly();
  clearProjectionsCache();
  clearAllGraphCache();
}

function toDate(d: string | Date | undefined, fallback: string): Date {
  if (d instanceof Date) return d;
  if (typeof d === 'string') return new Date(d + 'T00:00:00.000Z');
  return new Date(fallback + 'T00:00:00.000Z');
}

function snapshotManagers(engine: Engine): ManagerStatesSnapshot {
  return {
    tax: engine.getTaxManager()?.snapshot() ?? null,
    healthcare: engine.getHealthcareManager()?.snapshot() ?? null,
    spendingTracker: engine.getSpendingTrackerManager()?.snapshot() ?? null,
    retirement: engine.getRetirementManager()?.snapshot() ?? null,
    medicare: engine.getMedicareManager()?.snapshot() ?? null,
    aca: engine.getAcaManager()?.snapshot() ?? null,
  };
}

function* iterateSegmentEvents(events: DebugEvent[]): Generator<DebugEvent> {
  for (const e of events) {
    if (e.component === 'segment') yield e;
  }
}

function deepEqualWithEpsilon(a: unknown, b: unknown, path_: string, diffs: string[]): void {
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > EPSILON) {
      diffs.push(`${path_}: ${a} !== ${b} (diff ${Math.abs(a - b)})`);
    }
    return;
  }
  if (a === null || b === null || typeof a !== typeof b) {
    diffs.push(`${path_}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path_}: array length ${a.length} !== ${b.length}`);
      return;
    }
    for (let i = 0; i < a.length; i++) {
      deepEqualWithEpsilon(a[i], b[i], `${path_}[${i}]`, diffs);
    }
    return;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      deepEqualWithEpsilon(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        path_ ? `${path_}.${k}` : k,
        diffs,
      );
    }
    return;
  }
  diffs.push(`${path_}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

//
// Public factory
//

export function createHarness(options: HarnessOptions): Harness {
  const fixtureDirAbs = path.resolve(options.fixtureDir);
  const endDate = toDate(options.endDate, '2030-12-31');
  const simulation = options.simulation ?? 'Default';
  const debugLogDir = options.debugLogDir;

  async function runInternal(clearCachesFirst: boolean): Promise<RunResult> {
    // Point the engine at the fixture BEFORE any data load.
    process.env.BILLS_DATA_DIR = fixtureDirAbs;
    assertInsideFixtures(getDataDir());

    if (clearCachesFirst) {
      clearAllCaches();
    } else {
      clearCalcCachesOnly();
    }

    // Fresh per-run debug directory when not pinned.
    const dir = debugLogDir ?? path.join('/tmp', `debug-${randomUUID()}`);
    const debugLogger = new DebugLogger({ dir });

    const accountsAndTransfers = getAccountsAndTransfers(simulation);

    const { accountsAndTransfers: result, engine } = await calculateAllActivityWithEngine(
      accountsAndTransfers,
      null,          // startDate
      endDate,
      simulation,
      false,         // monteCarlo
      1,             // simulationNumber
      1,             // totalSimulations
      false,         // forceRecalculation — cold-vs-warm is driven by cache state, not this flag
      false,         // enableLogging
      {},            // config
      undefined,     // timeline
      undefined,     // seed
      debugLogger,
    );

    const managerStates = snapshotManagers(engine);

    // debugLogger.close() already called inside engine.calculate() finally block.
    return {
      result,
      debugLogPath: debugLogger.getDir(),
      managerStates,
    };
  }

  async function runInternalWithBoundaries(clearCachesFirst: boolean): Promise<RunResultWithBoundaries> {
    process.env.BILLS_DATA_DIR = fixtureDirAbs;
    assertInsideFixtures(getDataDir());

    if (clearCachesFirst) {
      clearAllCaches();
    } else {
      clearCalcCachesOnly();
    }

    const dir = debugLogDir ?? path.join('/tmp', `debug-${randomUUID()}`);
    const debugLogger = new DebugLogger({ dir });

    const boundarySnapshots: BoundarySnapshot[] = [];

    const accountsAndTransfers = getAccountsAndTransfers(simulation);

    const { accountsAndTransfers: result, engine } = await calculateAllActivityWithEngine(
      accountsAndTransfers,
      null,
      endDate,
      simulation,
      false,
      1,
      1,
      false,
      false,
      {},
      undefined,
      undefined,
      debugLogger,
      (segmentId, segmentEndDate, snapshot) => {
        boundarySnapshots.push({
          segmentId,
          endDate: dayjs.utc(segmentEndDate).format('YYYY-MM-DD'),
          managerState: snapshot,
        });
      },
    );

    const managerStates = snapshotManagers(engine);

    return {
      result,
      debugLogPath: debugLogger.getDir(),
      managerStates,
      boundarySnapshots,
    };
  }

  return {
    runCold(): Promise<RunResult> {
      return runInternal(true);
    },
    runWarm(): Promise<RunResult> {
      return runInternal(false);
    },
    runColdWithBoundarySnapshots(): Promise<RunResultWithBoundaries> {
      return runInternalWithBoundaries(true);
    },
    runWarmWithBoundarySnapshots(): Promise<RunResultWithBoundaries> {
      return runInternalWithBoundaries(false);
    },
    loadDebugEvents(logPath: string): DebugEvent[] {
      // Log dir contains det.jsonl and/or sim-N.jsonl files. Non-MC runs write det.jsonl.
      const events: DebugEvent[] = [];
      const candidates = ['det.jsonl', 'sim-1.jsonl', 'sim-2.jsonl', 'sim-3.jsonl'];
      for (const name of candidates) {
        const p = path.join(logPath, name);
        if (!existsSync(p)) continue;
        const text = readFileSync(p, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            events.push(JSON.parse(line) as DebugEvent);
          } catch {
            // Skip malformed line; DebugLogger uses appendFileSync + newlines so this is defensive.
          }
        }
      }
      return events;
    },
    assertCacheHits(events: DebugEvent[], opts: { dateRange: DateRange }): void {
      const hitsBySegment = new Map<string, number>();
      const computesBySegment = new Map<string, number>();
      for (const e of iterateSegmentEvents(events)) {
        // Segments overlap the range if they share ANY date; this matches how the engine
        // processes segments around boundaries (overlap, not strict containment).
        if (e.startDate > opts.dateRange.end || e.endDate < opts.dateRange.start) continue;
        const id = String(e.segmentId ?? `${e.startDate}_${e.endDate}`);
        if (e.event === 'cache-hit') {
          hitsBySegment.set(id, (hitsBySegment.get(id) ?? 0) + 1);
        } else if (e.event === 'segment-compute-start') {
          computesBySegment.set(id, (computesBySegment.get(id) ?? 0) + 1);
        }
      }
      const bad: string[] = [];
      const allSegmentIds = new Set([...hitsBySegment.keys(), ...computesBySegment.keys()]);
      for (const id of allSegmentIds) {
        const hits = hitsBySegment.get(id) ?? 0;
        const computes = computesBySegment.get(id) ?? 0;
        if (hits < 1 || computes > 0) {
          bad.push(`  segment ${id}: cache-hit=${hits}, segment-compute-start=${computes}`);
        }
      }
      if (allSegmentIds.size === 0) {
        throw new Error(
          `assertCacheHits: no segment events found in range ${opts.dateRange.start}..${opts.dateRange.end}. ` +
          `Expected at least one cache-hit. Did the engine run? Does the date range match segment boundaries?`,
        );
      }
      if (bad.length > 0) {
        throw new Error(
          `assertCacheHits: segments in range ${opts.dateRange.start}..${opts.dateRange.end} did not all hit cache:\n${bad.join('\n')}`,
        );
      }
    },
    assertCacheMisses(events: DebugEvent[], opts: { dateRange: DateRange }): void {
      const missesBySegment = new Map<string, number>();
      const computesBySegment = new Map<string, number>();
      for (const e of iterateSegmentEvents(events)) {
        // Segments overlap the range if they share ANY date; this matches how the engine
        // processes segments around boundaries (overlap, not strict containment).
        if (e.startDate > opts.dateRange.end || e.endDate < opts.dateRange.start) continue;
        const id = String(e.segmentId ?? `${e.startDate}_${e.endDate}`);
        if (e.event === 'cache-miss') {
          missesBySegment.set(id, (missesBySegment.get(id) ?? 0) + 1);
        } else if (e.event === 'segment-compute-start') {
          computesBySegment.set(id, (computesBySegment.get(id) ?? 0) + 1);
        }
      }
      const bad: string[] = [];
      const allSegmentIds = new Set([...missesBySegment.keys(), ...computesBySegment.keys()]);
      for (const id of allSegmentIds) {
        const misses = missesBySegment.get(id) ?? 0;
        const computes = computesBySegment.get(id) ?? 0;
        if (misses < 1 || computes < 1) {
          bad.push(`  segment ${id}: cache-miss=${misses}, segment-compute-start=${computes}`);
        }
      }
      if (allSegmentIds.size === 0) {
        throw new Error(
          `assertCacheMisses: no segment events found in range ${opts.dateRange.start}..${opts.dateRange.end}.`,
        );
      }
      if (bad.length > 0) {
        throw new Error(
          `assertCacheMisses: segments in range did not all miss + recompute:\n${bad.join('\n')}`,
        );
      }
    },
    compareManagerStates(warm: ManagerStatesSnapshot, cold: ManagerStatesSnapshot): void {
      const diffs: string[] = [];

      // Helper to safely compare manager states, allowing both to be null
      const compareManagerField = (name: string, warmVal: unknown, coldVal: unknown) => {
        if (warmVal === null && coldVal === null) return; // both null, skip
        if (warmVal === null || coldVal === null) {
          throw new Error(
            `compareManagerStates: Manager ${name} snapshot mismatch: one is null, the other isn't ` +
            `(warm=${warmVal === null ? 'null' : 'set'}, cold=${coldVal === null ? 'null' : 'set'})`
          );
        }
        deepEqualWithEpsilon(warmVal, coldVal, name, diffs);
      };

      compareManagerField('tax', warm.tax, cold.tax);
      compareManagerField('healthcare', warm.healthcare, cold.healthcare);
      compareManagerField('spendingTracker', warm.spendingTracker, cold.spendingTracker);
      compareManagerField('retirement', warm.retirement, cold.retirement);
      compareManagerField('medicare', warm.medicare, cold.medicare);
      compareManagerField('aca', warm.aca, cold.aca);

      if (diffs.length > 0) {
        throw new Error(`compareManagerStates: warm vs cold differ:\n${diffs.map((d) => '  ' + d).join('\n')}`);
      }
    },
    compareAccountsAndTransfers(warm: AccountsAndTransfers, cold: AccountsAndTransfers): void {
      const diffs: string[] = [];
      // Accounts: compare id, name, balance, activity counts, consolidatedActivity counts.
      deepEqualWithEpsilon(warm.accounts.length, cold.accounts.length, 'accounts.length', diffs);
      const summarize = (data: AccountsAndTransfers) =>
        data.accounts
          .map((a) => ({
            id: a.id,
            name: a.name,
            // Account type doesn't include runtime-computed fields (balance, activity,
            // consolidatedActivity) — these are attached by the calc engine post-calculation.
            // We cast to read them without modifying the shared Account type.
            balance: (a as { balance?: number }).balance ?? 0,
            activityCount: (a as { activity?: unknown[] }).activity?.length ?? 0,
            consolidatedCount: (a as { consolidatedActivity?: unknown[] }).consolidatedActivity?.length ?? 0,
          }))
          .sort((x, y) => x.id.localeCompare(y.id));
      deepEqualWithEpsilon(summarize(warm), summarize(cold), 'accounts', diffs);
      deepEqualWithEpsilon(warm.transfers.activity.length, cold.transfers.activity.length, 'transfers.activity.length', diffs);
      deepEqualWithEpsilon(warm.transfers.bills.length, cold.transfers.bills.length, 'transfers.bills.length', diffs);
      if (diffs.length > 0) {
        throw new Error(`compareAccountsAndTransfers: warm vs cold differ:\n${diffs.map((d) => '  ' + d).join('\n')}`);
      }
    },
    compareBoundarySnapshots<T>(
      warm: BoundarySnapshot[],
      cold: BoundarySnapshot[],
      extractor: (snapshot: ManagerStatesSnapshot) => T,
      label: string,
    ): void {
      if (warm.length !== cold.length) {
        throw new Error(
          `compareBoundarySnapshots[${label}]: segment count mismatch: warm=${warm.length} cold=${cold.length}`,
        );
      }
      if (cold.length === 0) {
        throw new Error(`compareBoundarySnapshots[${label}]: no segments to compare (both arrays empty)`);
      }
      const anyNonNull = cold.some((c) => extractor(c.managerState) !== null && extractor(c.managerState) !== undefined);
      if (!anyNonNull) {
        throw new Error(
          `compareBoundarySnapshots[${label}]: extractor returned null/undefined for ALL ${cold.length} segments — test is vacuous (no data to compare)`,
        );
      }
      for (let i = 0; i < warm.length; i++) {
        const w = warm[i];
        const c = cold[i];
        if (w.segmentId !== c.segmentId) {
          throw new Error(
            `compareBoundarySnapshots[${label}]: segment order mismatch at index ${i}: warm=${w.segmentId} cold=${c.segmentId}`,
          );
        }
        const wVal = extractor(w.managerState);
        const cVal = extractor(c.managerState);
        const diffs: string[] = [];
        deepEqualWithEpsilon(wVal, cVal, label, diffs);
        if (diffs.length > 0) {
          throw new Error(
            `compareBoundarySnapshots[${label}]: divergence at segment ${w.segmentId} (endDate=${w.endDate}):\n` +
            diffs.map((d) => '  ' + d).join('\n'),
          );
        }
      }
    },
  };
}
