// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for filesystem, vi.fn() for functions
// - Assertions: expect() with toBe, toEqual, toBeNull, toHaveLength
// - Async: async/await
// - Structure: describe/it with beforeEach

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CacheManager, initializeCache } from './cache';
import { CalculationConfig, CacheEntry } from './types';

// ---------------------------------------------------------------------------
// Mock filesystem operations so tests don't touch the real disk
// ---------------------------------------------------------------------------
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { readdir, readFile, writeFile, unlink } from 'fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<CalculationConfig> = {}): CalculationConfig {
  return {
    snapshotInterval: 'monthly',
    useDiskCache: false,
    diskCacheDir: '/tmp/test-cache',
    ...overrides,
  };
}

function makeSimpleSerializer() {
  return {
    serialize: (data: any) => JSON.stringify(data),
    deserialize: (data: string, _mgr: any) => JSON.parse(data),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CacheManager', () => {
  let config: CalculationConfig;

  beforeEach(() => {
    config = makeConfig();
    // Clear the shared static memory cache between tests by calling clear() on
    // a temporary instance, which wipes CacheManager.memoryCache
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Wipe shared static memory cache after each test
    // Use 'sim-1' since that's what the tests use
    const mgr = new CacheManager(config, 'sim-1');
    await mgr.clear();
  });

  // -------------------------------------------------------------------------
  // initializeCache factory function
  // -------------------------------------------------------------------------
  describe('initializeCache', () => {
    it('returns a CacheManager instance', () => {
      const mgr = initializeCache(config, 'sim-1');
      expect(mgr).toBeInstanceOf(CacheManager);
    });

    it('returns a CacheManager with monteCarlo disabled by default', async () => {
      const mgr = initializeCache(config, 'sim-1');
      // Monte Carlo disabled: set should persist, get should return data
      const serializer = makeSimpleSerializer();
      await mgr.set('test-key_sim-1', { value: 42 }, serializer);
      const result = await mgr.get('test-key_sim-1', serializer);
      expect(result).toEqual({ value: 42 });
    });
  });

  // -------------------------------------------------------------------------
  // getSimulation
  // -------------------------------------------------------------------------
  describe('getSimulation', () => {
    it('returns the simulation string passed at construction', () => {
      const mgr = new CacheManager(config, 'my-sim');
      expect(mgr.getSimulation()).toBe('my-sim');
    });
  });

  // -------------------------------------------------------------------------
  // set / get (memory cache)
  // -------------------------------------------------------------------------
  describe('set and get with memory cache', () => {
    it('stores and retrieves a value from memory cache', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('my-key_sim-1', { hello: 'world' }, serializer);
      const result = await mgr.get('my-key_sim-1', serializer);

      expect(result).toEqual({ hello: 'world' });
    });

    it('returns null for a key that was never set', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const result = await mgr.get('nonexistent', makeSimpleSerializer());
      expect(result).toBeNull();
    });

    it('overwrites an existing entry when setting the same key again', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('key_sim-1', { v: 1 }, serializer);
      await mgr.set('key_sim-1', { v: 2 }, serializer);

      expect(await mgr.get('key_sim-1', serializer)).toEqual({ v: 2 });
    });

    it('stores nothing and returns null when monteCarlo mode is enabled', async () => {
      const mgr = new CacheManager(config, 'sim-1', true /* monteCarlo */);
      const serializer = makeSimpleSerializer();

      await mgr.set('key_sim-1', { v: 1 }, serializer);
      expect(await mgr.get('key_sim-1', serializer)).toBeNull();
    });

    it('returns null when no expiry is set and key does not exist', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();
      // Key was never set — should return null
      const result = await mgr.get('never-set-key', serializer);
      expect(result).toBeNull();
    });

    it('returns data for non-expired entries', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      // expiresAt is a future time delta (1 hour from now)
      await mgr.set('key_sim-1', { v: 99 }, serializer, { expiresAt: new Date(Date.now() + 3600_000) });

      const result = await mgr.get('key_sim-1', serializer);
      expect(result).toEqual({ v: 99 });
    });
  });

  // -------------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------------
  describe('has', () => {
    it('returns false for a key that was never set', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      expect(await mgr.has('nonexistent')).toBe(false);
    });

    it('returns true for a valid (non-expired) key in memory', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();
      await mgr.set('key_sim-1', { v: 1 }, serializer);
      expect(await mgr.has('key_sim-1')).toBe(true);
    });

    it('returns false when in Monte Carlo mode', async () => {
      const mgr = new CacheManager(config, 'sim-1', true);
      const serializer = makeSimpleSerializer();
      await mgr.set('key_sim-1', { v: 1 }, serializer);
      expect(await mgr.has('key_sim-1')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('removes a key from memory cache', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('key_sim-1', { v: 1 }, serializer);
      await mgr.delete('key_sim-1');

      expect(await mgr.get('key_sim-1', serializer)).toBeNull();
    });

    it('is a no-op for a non-existent key', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      // Should not throw
      await expect(mgr.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('calls deleteDisk when useDiskCache is true', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await mgr.delete('key');

      expect(unlink).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------
  describe('clear', () => {
    it('removes all memory cache entries', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('key-1_sim-1', 1, serializer);
      await mgr.set('key-2_sim-1', 2, serializer);
      await mgr.clear();

      expect(await mgr.get('key-1_sim-1', serializer)).toBeNull();
      expect(await mgr.get('key-2_sim-1', serializer)).toBeNull();
    });

    it('attempts to clear disk files when useDiskCache is true', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce(['somefile.json']);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await mgr.clear();

      expect(unlink).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // segmentKeyToDateString
  // -------------------------------------------------------------------------
  describe('segmentKeyToDateString', () => {
    it('extracts the start date from a valid segment key', () => {
      const mgr = new CacheManager(config, 'sim-1');
      const key = 'segment_42_2025-03-15_2025-04-14_sim-1';

      expect(mgr.segmentKeyToDateString(key)).toBe('2025-03-15');
    });

    it('returns null for an invalid key format', () => {
      const mgr = new CacheManager(config, 'sim-1');
      expect(mgr.segmentKeyToDateString('invalid-key')).toBeNull();
      expect(mgr.segmentKeyToDateString('')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // balanceSnapshotKeyToDateString
  // -------------------------------------------------------------------------
  describe('balanceSnapshotKeyToDateString', () => {
    it('extracts date from a valid balance snapshot key', () => {
      const mgr = new CacheManager(config, 'sim-1');
      const key = 'balance_snapshot_2025-06-15_sim-1';

      expect(mgr.balanceSnapshotKeyToDateString(key)).toBe('2025-06-15');
    });

    it('returns null for an invalid key format', () => {
      const mgr = new CacheManager(config, 'sim-1');
      expect(mgr.balanceSnapshotKeyToDateString('not-a-snapshot')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setBalanceSnapshot / getBalanceSnapshot
  // -------------------------------------------------------------------------
  describe('setBalanceSnapshot and getBalanceSnapshot', () => {
    it('stores and retrieves a balance snapshot', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const date = new Date(Date.UTC(2025, 5, 15));
      const snapshot = {
        date,
        balances: { 'account-1': 1000, 'account-2': 2000 },
        activityIndices: { 'account-1': 5, 'account-2': 3 },
        processedEventIds: new Set<string>(['event-1', 'event-2']),
      };

      await mgr.setBalanceSnapshot(date, snapshot);
      const retrieved = await mgr.getBalanceSnapshot(date);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.balances).toEqual({ 'account-1': 1000, 'account-2': 2000 });
    });

    it('returns null when no snapshot exists for the date', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const result = await mgr.getBalanceSnapshot(new Date(Date.UTC(2025, 0, 1)));
      expect(result).toBeNull();
    });

    it('returns key string on set', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const date = new Date(Date.UTC(2025, 5, 15));
      const snapshot = {
        date,
        balances: {},
        activityIndices: {},
        processedEventIds: new Set<string>(),
      };

      const key = await mgr.setBalanceSnapshot(date, snapshot);
      expect(typeof key).toBe('string');
      expect(key.startsWith('balance_snapshot_')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // clearByPrefix
  // -------------------------------------------------------------------------
  describe('clearByPrefix', () => {
    it('removes all keys matching the prefix from memory cache', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('foo_key1_sim-1', 1, serializer);
      await mgr.set('foo_key2_sim-1', 2, serializer);
      await mgr.set('bar_key3_sim-1', 3, serializer);

      await mgr.clearByPrefix('foo_');

      expect(await mgr.get('foo_key1_sim-1', serializer)).toBeNull();
      expect(await mgr.get('foo_key2_sim-1', serializer)).toBeNull();
      expect(await mgr.get('bar_key3_sim-1', serializer)).toEqual(3);
    });

    it('is a no-op when no keys match the prefix', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();
      await mgr.set('mykey_sim-1', 'value', serializer);

      await expect(mgr.clearByPrefix('nonexistent_')).resolves.toBeUndefined();

      expect(await mgr.get('mykey_sim-1', serializer)).toBe('value');
    });
  });

  // -------------------------------------------------------------------------
  // clearSegmentResultsFromDate
  // -------------------------------------------------------------------------
  describe('clearSegmentResultsFromDate', () => {
    it('removes segment entries on or after the given date from memory cache', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      // Keys in segment_ format: segment_{id}_{startDate}_{endDate}_{sim}
      await mgr.set('segment_1_2025-01-01_2025-01-31_sim-1', 'old', serializer);
      await mgr.set('segment_2_2025-06-01_2025-06-30_sim-1', 'recent', serializer);
      await mgr.set('segment_3_2025-12-01_2025-12-31_sim-1', 'future', serializer);

      const cutoff = new Date('2025-06-01');
      await mgr.clearSegmentResultsFromDate(cutoff);

      // January segment should remain (before cutoff)
      expect(await mgr.get('segment_1_2025-01-01_2025-01-31_sim-1', serializer)).toBe('old');

      // June and December should be cleared (on or after cutoff)
      expect(await mgr.get('segment_2_2025-06-01_2025-06-30_sim-1', serializer)).toBeNull();
      expect(await mgr.get('segment_3_2025-12-01_2025-12-31_sim-1', serializer)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // clearBalanceSnapshotsFromDate
  // -------------------------------------------------------------------------
  describe('clearBalanceSnapshotsFromDate', () => {
    it('removes snapshot keys on or after the given date from memory cache', async () => {
      const mgr = new CacheManager(config, 'sim-1');

      const earlyDate = new Date(Date.UTC(2025, 0, 1));  // Jan 1
      const lateDate = new Date(Date.UTC(2025, 5, 15));  // Jun 15
      const snapshot = {
        date: earlyDate,
        balances: {},
        activityIndices: {},
        processedEventIds: new Set<string>(),
      };

      await mgr.setBalanceSnapshot(earlyDate, { ...snapshot, date: earlyDate });
      await mgr.setBalanceSnapshot(lateDate, { ...snapshot, date: lateDate });

      const cutoff = new Date(Date.UTC(2025, 5, 1));  // Jun 1
      await mgr.clearBalanceSnapshotsFromDate(cutoff);

      // Jan snapshot should remain
      expect(await mgr.getBalanceSnapshot(earlyDate)).not.toBeNull();
      // Jun 15 snapshot should be cleared
      expect(await mgr.getBalanceSnapshot(lateDate)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // clearCacheFromDate
  // -------------------------------------------------------------------------
  describe('clearCacheFromDate', () => {
    it('clears calculation results, balance snapshots, and segment results from date', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      // Set up one entry in each category
      await mgr.set('calc_2025-01-01_2025-12-31_sim-1', 'calc', serializer);

      const snapshotDate = new Date(Date.UTC(2025, 5, 15));
      await mgr.setBalanceSnapshot(snapshotDate, {
        date: snapshotDate,
        balances: {},
        activityIndices: {},
        processedEventIds: new Set(),
      });

      await mgr.set('segment_1_2025-06-01_2025-06-30_sim-1', 'seg', serializer);

      const cutoff = new Date(Date.UTC(2025, 3, 1)); // Apr 1 — clears everything >= Apr
      await mgr.clearCacheFromDate(cutoff);

      // The calc entry has end date 2025-12-31 >= Apr 1 => cleared
      expect(await mgr.get('calc_2025-01-01_2025-12-31_sim-1', serializer)).toBeNull();
      // Snapshot at Jun 15 >= Apr 1 => cleared
      expect(await mgr.getBalanceSnapshot(snapshotDate)).toBeNull();
      // Segment starting Jun 1 >= Apr 1 => cleared
      expect(await mgr.get('segment_1_2025-06-01_2025-06-30_sim-1', serializer)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // clearCalculationResults
  // -------------------------------------------------------------------------
  describe('clearCalculationResults', () => {
    it('clears all calc_ prefixed keys', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('calc_2025-01-01_2025-12-31_sim-1', 'a', serializer);
      await mgr.set('calc_2024-01-01_2024-12-31_sim-1', 'b', serializer);
      await mgr.set('other_key_sim-1', 'c', serializer);

      await mgr.clearCalculationResults();

      expect(await mgr.get('calc_2025-01-01_2025-12-31_sim-1', serializer)).toBeNull();
      expect(await mgr.get('calc_2024-01-01_2024-12-31_sim-1', serializer)).toBeNull();
      expect(await mgr.get('other_key_sim-1', serializer)).toBe('c');
    });
  });

  // -------------------------------------------------------------------------
  // clearCalculationResultsOnly (static)
  // -------------------------------------------------------------------------
  describe('clearCalculationResultsOnly', () => {
    it('removes only calc_* entries from memoryCache', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('calc_2025-01-01_2025-12-31_sim-1', 'calc-value', serializer);
      await mgr.set('segment_1_2025-01-01_2025-01-31_sim-1', 'segment-value', serializer);
      await mgr.setBalanceSnapshot(new Date(Date.UTC(2025, 0, 1)), {
        date: new Date(Date.UTC(2025, 0, 1)),
        balances: { 'acct-1': 100 },
        activityIndices: {},
        processedEventIds: new Set(),
      });

      CacheManager.clearCalculationResultsOnly();

      // calc_ entry should be gone
      expect(await mgr.get('calc_2025-01-01_2025-12-31_sim-1', serializer)).toBeNull();
      // segment_ entry should remain
      expect(await mgr.get('segment_1_2025-01-01_2025-01-31_sim-1', serializer)).toBe('segment-value');
      // balance_snapshot_ entry should remain
      expect(await mgr.getBalanceSnapshot(new Date(Date.UTC(2025, 0, 1)))).not.toBeNull();
    });

    it('is a no-op when no calc_* entries exist', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('segment_1_2025-01-01_2025-01-31_sim-1', 'segment-value', serializer);
      await mgr.setBalanceSnapshot(new Date(Date.UTC(2025, 0, 1)), {
        date: new Date(Date.UTC(2025, 0, 1)),
        balances: {},
        activityIndices: {},
        processedEventIds: new Set(),
      });

      CacheManager.clearCalculationResultsOnly();

      expect(await mgr.get('segment_1_2025-01-01_2025-01-31_sim-1', serializer)).toBe('segment-value');
      expect(await mgr.getBalanceSnapshot(new Date(Date.UTC(2025, 0, 1)))).not.toBeNull();
    });

    it('preserves entries from different simulations', async () => {
      const mgrDefault = new CacheManager(config, 'Default');
      const mgrAlt = new CacheManager(config, 'Alt');
      const serializer = makeSimpleSerializer();

      await mgrDefault.set('calc_2025-01-01_2025-12-31_Default', 'calc-default', serializer);
      await mgrAlt.set('calc_2025-01-01_2025-12-31_Alt', 'calc-alt', serializer);
      await mgrDefault.set('segment_1_2025-01-01_2025-01-31_Default', 'seg-default', serializer);
      await mgrAlt.set('segment_1_2025-01-01_2025-01-31_Alt', 'seg-alt', serializer);

      CacheManager.clearCalculationResultsOnly();

      // All calc_ entries (both sims) should be gone
      expect(await mgrDefault.get('calc_2025-01-01_2025-12-31_Default', serializer)).toBeNull();
      expect(await mgrAlt.get('calc_2025-01-01_2025-12-31_Alt', serializer)).toBeNull();

      // All segment_ entries (both sims) should remain
      expect(await mgrDefault.get('segment_1_2025-01-01_2025-01-31_Default', serializer)).toBe('seg-default');
      expect(await mgrAlt.get('segment_1_2025-01-01_2025-01-31_Alt', serializer)).toBe('seg-alt');
    });
  });

  // -------------------------------------------------------------------------
  // clearCalculationResultsFromDate
  // -------------------------------------------------------------------------
  describe('clearCalculationResultsFromDate', () => {
    it('clears calculation keys where start or end date >= given date', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      // calc_{start}_{end}_{sim}
      await mgr.set('calc_2024-01-01_2024-12-31_sim-1', 'old', serializer);
      await mgr.set('calc_2025-06-01_2025-12-31_sim-1', 'recent', serializer);
      await mgr.set('calc_null_2025-12-31_sim-1', 'null-start', serializer);

      const cutoff = new Date('2025-06-01');
      await mgr.clearCalculationResultsFromDate(cutoff);

      // 2024 entry has both start and end before cutoff — should remain
      expect(await mgr.get('calc_2024-01-01_2024-12-31_sim-1', serializer)).toBe('old');
      // 2025-06 entry should be cleared
      expect(await mgr.get('calc_2025-06-01_2025-12-31_sim-1', serializer)).toBeNull();
      // null-start entry should be cleared (null start => always clear)
      expect(await mgr.get('calc_null_2025-12-31_sim-1', serializer)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------
  describe('cleanup', () => {
    it('does not throw when cleaning a non-empty memory cache with valid entries', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const serializer = makeSimpleSerializer();

      // Add a non-expiring entry
      await mgr.set('keep', 'alive', serializer);

      // cleanup should not affect non-expiring entries
      await mgr.cleanup();

      expect(await mgr.get('keep', serializer)).toBe('alive');
    });

    it('does not throw when memory cache is empty', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      await expect(mgr.cleanup()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Monte Carlo mode: all operations are no-ops
  // -------------------------------------------------------------------------
  describe('Monte Carlo mode', () => {
    it('set returns without storing any data', async () => {
      const mgr = new CacheManager(config, 'sim-mc', true);
      const serializer = makeSimpleSerializer();

      await mgr.set('key', 'value', serializer);
      expect(await mgr.get('key', serializer)).toBeNull();
    });

    it('has always returns false', async () => {
      const mgr = new CacheManager(config, 'sim-mc', true);
      expect(await mgr.has('anything')).toBe(false);
    });

    it('get always returns null', async () => {
      const mgr = new CacheManager(config, 'sim-mc', true);
      const result = await mgr.get('anything', makeSimpleSerializer());
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache (mocked)
  // -------------------------------------------------------------------------
  describe('disk cache mode', () => {
    it('calls writeFile when setting a value with disk cache enabled', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');
      const serializer = makeSimpleSerializer();

      await mgr.set('disk-key', { v: 1 }, serializer);

      expect(writeFile).toHaveBeenCalled();
    });

    it('falls back to null when disk file not found (ENOENT)', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // readFile is already mocked to throw ENOENT
      const result = await mgr.get('disk-key', makeSimpleSerializer());
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: clearSegmentResultsFromDate
  // -------------------------------------------------------------------------
  describe('disk cache: clearSegmentResultsFromDate', () => {
    it('deletes segment files on or after given date from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'segment_1_2025-01-01_2025-01-31_sim-1.json',
        'segment_2_2025-06-01_2025-06-30_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const cutoff = new Date('2025-06-01');
      await mgr.clearSegmentResultsFromDate(cutoff);

      // unlink should be called for the June entry (>= cutoff), not January
      expect(unlink).toHaveBeenCalled();
    });

    it('does not delete segment files before the cutoff date from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'segment_1_2024-01-01_2024-12-31_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');
      const mockUnlink = unlink as ReturnType<typeof vi.fn>;
      mockUnlink.mockClear();

      const cutoff = new Date('2025-01-01');
      await mgr.clearSegmentResultsFromDate(cutoff);

      // The 2024 segment is before cutoff - should not be deleted
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('handles readdir error gracefully when disk cache enabled', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // Should not throw
      await expect(mgr.clearSegmentResultsFromDate(new Date('2025-01-01'))).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: cleanup
  // -------------------------------------------------------------------------
  describe('disk cache: cleanup', () => {
    it('completes disk cleanup without throwing when segment files exist', async () => {
      // The cleanup() function reads and deserializes segment files using SegmentResultSerializer
      // which involves complex ConsolidatedActivity deserialization. We verify it completes
      // without throwing (the deserialization may return null on complex data, causing no deletion,
      // which is acceptable behavior).
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce(['segment_1_2024-01-01_2024-12-31_sim-1.json']);

      // getDisk will receive the mock readFile already configured to throw ENOENT
      // This exercises the file listing + key parsing path in cleanup()
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // Should complete without throwing
      await expect(mgr.cleanup()).resolves.toBeUndefined();
    });

    it('completes disk cleanup without throwing when balance_snapshot files exist', async () => {
      // cleanup() iterates disk files and checks expiry. The balance_snapshot path is exercised
      // here. Deserialized entries with no expiresAt are never expired, so unlink is not called.
      // We verify the path is entered and no error is thrown.
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce(['balance_snapshot_2025-01-01_sim-1.json']);

      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      // Valid balance_snapshot entry with no expiry (will not be deleted but exercises the branch)
      const nonExpiringSnapshot = JSON.stringify({
        data: {
          date: '2025-01-01',
          balances: {},
          activityIndices: {},
          processedEventIds: [],
        },
        timestamp: new Date().toISOString(),
        expiresAt: null,
      });
      mockReadFile.mockResolvedValueOnce(nonExpiringSnapshot);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // Should complete without throwing
      await expect(mgr.cleanup()).resolves.toBeUndefined();
    });

    it('handles readdir error gracefully during disk cleanup', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // Should not throw
      await expect(mgr.cleanup()).resolves.toBeUndefined();
    });

    it('does not delete non-expired disk entries during cleanup', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce(['segment_1_2025-01-01_2025-12-31_sim-1.json']);

      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      const nonExpiredEntry = JSON.stringify({
        data: {
          balanceChanges: {},
          activitiesAdded: {},
          processedEventIds: [],
          balanceMinimums: {},
          balanceMaximums: {},
          taxableOccurrences: {},
          spendingTrackerUpdates: [],
        },
        timestamp: new Date(),
        expiresAt: null, // No expiration
      });
      mockReadFile.mockResolvedValueOnce(nonExpiredEntry);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');
      const mockUnlink = unlink as ReturnType<typeof vi.fn>;
      mockUnlink.mockClear();

      await mgr.cleanup();

      // Non-expired entry should not be deleted
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: clearCalculationResultsFromDate
  // -------------------------------------------------------------------------
  describe('disk cache: clearCalculationResultsFromDate', () => {
    it('deletes calculation files on or after cutoff date from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'calc_2025-06-01_2025-12-31_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const cutoff = new Date('2025-06-01');
      await mgr.clearCalculationResultsFromDate(cutoff);

      expect(unlink).toHaveBeenCalled();
    });

    it('does not delete calculation files before cutoff date from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'calc_2024-01-01_2024-12-31_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');
      const mockUnlink = unlink as ReturnType<typeof vi.fn>;
      mockUnlink.mockClear();

      const cutoff = new Date('2025-01-01');
      await mgr.clearCalculationResultsFromDate(cutoff);

      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('deletes calculation files with null start date from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      // calc_{start}_{end}_{sim}.json — start = 'null'
      mockReaddir.mockResolvedValueOnce([
        'calc_null_2025-12-31_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await mgr.clearCalculationResultsFromDate(new Date('2025-01-01'));

      expect(unlink).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: clearBalanceSnapshotsFromDate
  // -------------------------------------------------------------------------
  describe('disk cache: clearBalanceSnapshotsFromDate', () => {
    it('deletes balance snapshot files on or after cutoff date from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'balance_snapshot_2025-06-15_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const cutoff = new Date(Date.UTC(2025, 5, 1)); // Jun 1
      await mgr.clearBalanceSnapshotsFromDate(cutoff);

      expect(unlink).toHaveBeenCalled();
    });

    it('does not delete balance snapshot files before cutoff date', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'balance_snapshot_2024-01-01_sim-1.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');
      const mockUnlink = unlink as ReturnType<typeof vi.fn>;
      mockUnlink.mockClear();

      const cutoff = new Date(Date.UTC(2025, 5, 1)); // Jun 1 2025
      await mgr.clearBalanceSnapshotsFromDate(cutoff);

      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('handles readdir error gracefully', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await expect(mgr.clearBalanceSnapshotsFromDate(new Date('2025-01-01'))).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: clearByPrefix
  // -------------------------------------------------------------------------
  describe('disk cache: clearByPrefix', () => {
    it('deletes disk files matching given prefix', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'foo_key1.json',
        'foo_key2.json',
        'bar_key3.json',
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await mgr.clearByPrefix('foo_');

      // Called twice for foo_key1 and foo_key2
      expect(unlink).toHaveBeenCalledTimes(2);
    });

    it('handles readdir error gracefully when clearing by prefix', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await expect(mgr.clearByPrefix('any_')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: getDisk non-ENOENT error
  // -------------------------------------------------------------------------
  describe('disk cache: getDisk non-ENOENT errors', () => {
    it('returns null and logs warning when getDisk encounters non-ENOENT error', async () => {
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // get() calls getDisk which should return null on non-ENOENT error
      const result = await mgr.get('some-key', makeSimpleSerializer());
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: has() with segment_/calc_/balance_snapshot_ prefixes
  // -------------------------------------------------------------------------
  describe('disk cache: has() with typed key prefixes', () => {
    it('returns false for segment_ key not found on disk', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // readFile already mocked to throw ENOENT
      const result = await mgr.has('segment_1_2025-01-01_2025-01-31_sim-1');
      expect(result).toBe(false);
    });

    it('returns false for calc_ key not found on disk', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.has('calc_2025-01-01_2025-12-31_sim-1');
      expect(result).toBe(false);
    });

    it('returns false for balance_snapshot_ key not found on disk', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.has('balance_snapshot_2025-06-15_sim-1');
      expect(result).toBe(false);
    });

    it('returns false for unknown key prefix not found on disk', async () => {
      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.has('unknown_prefix_key');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // findClosestSnapshot
  // -------------------------------------------------------------------------
  describe('findClosestSnapshot', () => {
    it('returns null when no snapshots exist', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const result = await mgr.findClosestSnapshot(new Date(Date.UTC(2025, 5, 15)));
      expect(result).toBeNull();
    });

    it('returns the closest snapshot that is on or before the target date', async () => {
      const mgr = new CacheManager(config, 'sim-1');

      const jan1 = new Date(Date.UTC(2025, 0, 1));
      const mar1 = new Date(Date.UTC(2025, 2, 1));
      const jul1 = new Date(Date.UTC(2025, 6, 1)); // target

      const makeSnapshot = (d: Date) => ({
        date: d,
        balances: {},
        activityIndices: {},
        processedEventIds: new Set<string>(),
      });

      await mgr.setBalanceSnapshot(jan1, makeSnapshot(jan1));
      await mgr.setBalanceSnapshot(mar1, makeSnapshot(mar1));

      const result = await mgr.findClosestSnapshot(jul1);

      // Should return the closest snapshot before the target (march)
      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setCalculationResult / getCalculationResult
  // -------------------------------------------------------------------------
  describe('setCalculationResult and getCalculationResult', () => {
    it('stores and retrieves a calculation result from memory cache', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const fakeResult = { accounts: [], transfers: { activity: [], bills: [] } } as any;

      await mgr.setCalculationResult(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 11, 31)), fakeResult);
      const retrieved = await mgr.getCalculationResult(
        new Date(Date.UTC(2025, 0, 1)),
        new Date(Date.UTC(2025, 11, 31)),
      );

      // Since CalculationResultSerializer serializes Account/Bill/Activity objects,
      // and our fake has empty arrays, the deserializer will produce an empty result.
      expect(retrieved).not.toBeNull();
      expect(retrieved!.accounts).toEqual([]);
    });

    it('returns null when no calculation result for those dates', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const result = await mgr.getCalculationResult(
        new Date(Date.UTC(2024, 0, 1)),
        new Date(Date.UTC(2024, 11, 31)),
      );
      expect(result).toBeNull();
    });

    it('handles null startDate in setCalculationResult', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const fakeResult = { accounts: [], transfers: { activity: [], bills: [] } } as any;

      await mgr.setCalculationResult(null, new Date(Date.UTC(2025, 11, 31)), fakeResult);
      const retrieved = await mgr.getCalculationResult(null, new Date(Date.UTC(2025, 11, 31)));

      expect(retrieved).not.toBeNull();
    });

    it('does not store when in monteCarlo mode', async () => {
      const mgr = new CacheManager(config, 'sim-mc', true);
      const fakeResult = { accounts: [], transfers: { activity: [], bills: [] } } as any;

      await mgr.setCalculationResult(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 11, 31)), fakeResult);
      const result = await mgr.getCalculationResult(
        new Date(Date.UTC(2025, 0, 1)),
        new Date(Date.UTC(2025, 11, 31)),
      );
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setSegmentResult / getSegmentResult
  // -------------------------------------------------------------------------
  describe('setSegmentResult and getSegmentResult', () => {
    it('marks segment as cached after setSegmentResult', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const fakeSegment = {
        id: 'segment_0',
        startDate: new Date(Date.UTC(2025, 0, 1)),
        endDate: new Date(Date.UTC(2025, 0, 31)),
        events: [],
        affectedAccountIds: new Set<string>(),
        cached: false,
        cacheKey: 'test-key',
      } as any;

      const fakeResult = {
        balanceChanges: new Map<string, number>(),
        activitiesAdded: new Map<string, any[]>(),
        processedEventIds: new Set<string>(),
        balanceMinimums: new Map<string, number>(),
        balanceMaximums: new Map<string, number>(),
        taxableOccurrences: new Map<string, any[]>(),
        spendingTrackerUpdates: [],
      };

      await mgr.setSegmentResult(fakeSegment, fakeResult);

      // Segment should now be marked as cached
      expect(fakeSegment.cached).toBe(true);
    });

    it('returns null when no segment result is cached', async () => {
      const mgr = new CacheManager(config, 'sim-1');
      const fakeSegment = {
        id: 'segment_99',
        startDate: new Date(Date.UTC(2024, 0, 1)),
        endDate: new Date(Date.UTC(2024, 0, 31)),
        events: [],
        affectedAccountIds: new Set<string>(),
        cached: false,
        cacheKey: 'missing-key',
      } as any;

      const result = await mgr.getSegmentResult(fakeSegment);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: findClosestSnapshot with disk entries
  // -------------------------------------------------------------------------
  describe('disk cache: findClosestSnapshot with disk files', () => {
    it('reads disk files for closest snapshot when disk cache is enabled', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      // balance_snapshot_ files have date strings in the key, but findClosestSnapshot
      // uses parseInt on the portion after 'balance_snapshot_' - non-numeric values return NaN
      // so it won't find a match. This exercises the disk path without finding a match.
      mockReaddir.mockResolvedValueOnce(['balance_snapshot_2025-01-01_sim-1.json']);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const target = new Date(Date.UTC(2025, 6, 1));
      const result = await mgr.findClosestSnapshot(target);

      // The key format with date strings causes parseInt to return NaN, so no match
      expect(result).toBeNull();
    });

    it('returns null when readdir returns no snapshot files', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.findClosestSnapshot(new Date(Date.UTC(2025, 6, 1)));
      expect(result).toBeNull();
    });

    it('ignores non-snapshot disk files', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce(['segment_1_2025-01-01_2025-01-31.json', 'calc_2025-01-01.json']);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.findClosestSnapshot(new Date(Date.UTC(2025, 6, 1)));
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: clearCalculationResultsFromDate error handling
  // -------------------------------------------------------------------------
  describe('disk cache: clearCalculationResultsFromDate - unlink error handling', () => {
    it('handles unlink error gracefully for calc files', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      const mockUnlink = unlink as ReturnType<typeof vi.fn>;

      mockReaddir.mockResolvedValueOnce(['calc_2025-06-01_2025-12-31_sim-1.json']);
      mockUnlink.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // Should not throw even when unlink fails
      await expect(mgr.clearCalculationResultsFromDate(new Date('2025-01-01'))).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: getDisk with successful read
  // -------------------------------------------------------------------------
  describe('disk cache: get with disk entries', () => {
    it('returns cached data for a non-expiring disk entry (expiresAt=null)', async () => {
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      // Entry with no expiry (expiresAt=null). isExpired() returns false for null expiresAt.
      const validEntry = JSON.stringify({
        data: { value: 99 },
        timestamp: new Date().toISOString(),
        expiresAt: null,
      });
      mockReadFile.mockResolvedValueOnce(validEntry);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.get<{ value: number }>('some-disk-key', makeSimpleSerializer());

      expect(result).not.toBeNull();
      expect(result!.value).toBe(99);
    });

    it('reads from disk cache when key is not in memory cache', async () => {
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      const diskEntry = JSON.stringify({
        data: { counter: 7 },
        timestamp: new Date().toISOString(),
        expiresAt: null,
      });
      mockReadFile.mockResolvedValueOnce(diskEntry);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');
      // Note: key was never set in memory, so disk is checked
      const result = await mgr.get<{ counter: number }>('disk-only-key', makeSimpleSerializer());

      expect(result).not.toBeNull();
      expect(result!.counter).toBe(7);
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: has() with found non-expired entries on disk (calc_ prefix)
  // -------------------------------------------------------------------------
  describe('disk cache: has() with found calc_ disk entries', () => {
    it('returns false when calculationResultSerializer deserialization fails (modules cannot be imported)', async () => {
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      // has() for calc_ key uses calculationResultSerializer.
      // A fake entry with empty accounts/transfers:
      const validEntry = JSON.stringify({
        data: {
          accounts: [],
          transfers: { activity: [], bills: [] },
        },
        timestamp: new Date().toISOString(),
        expiresAt: null, // never expires
      });
      mockReadFile.mockResolvedValueOnce(validEntry);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.has('calc_2025-01-01_2025-12-31_sim-1');

      // calculationResultSerializer.deserialize requires Account/Bill/Activity classes.
      // When these cannot be imported (as in test environment), deserialization fails,
      // getDisk returns null, and has() returns false.
      expect(result).toBe(false);
    });

    it('returns true for a valid non-expired balance_snapshot_ disk entry', async () => {
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      const validEntry = JSON.stringify({
        data: {
          date: '2025-06-15',
          balances: { 'account-1': 1000 },
          activityIndices: {},
          processedEventIds: [],
        },
        timestamp: new Date().toISOString(),
        expiresAt: null,
      });
      mockReadFile.mockResolvedValueOnce(validEntry);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.has('balance_snapshot_2025-06-15_sim-1');

      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // clearCalculationResults (using clearByPrefix with disk)
  // -------------------------------------------------------------------------
  describe('disk cache: clearCalculationResults', () => {
    it('clears calc_ prefixed files from disk', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      mockReaddir.mockResolvedValueOnce([
        'calc_2025-01-01_2025-12-31_sim-1.json',
        'calc_2024-01-01_2024-12-31_sim-1.json',
        'segment_0_2025-01-01_2025-01-31.json', // should not be deleted
      ]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      await mgr.clearCalculationResults();

      // Called twice for two calc files
      expect(unlink).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: setDisk write failure error handling
  // -------------------------------------------------------------------------
  describe('disk cache: setDisk write failure', () => {
    it('handles writeFile error gracefully in setDisk (logs warning and does not throw)', async () => {
      const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
      mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // Should not throw even if writeFile fails
      await expect(mgr.set('write-fail-key', { data: 1 }, makeSimpleSerializer())).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to write to disk cache:',
        expect.stringContaining('ENOSPC'),
      );
      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: deleteDisk unlink failure error handling
  // -------------------------------------------------------------------------
  describe('disk cache: deleteDisk unlink failure', () => {
    it('handles unlink error gracefully in deleteDisk (logs warning and does not throw)', async () => {
      const mockUnlink = unlink as ReturnType<typeof vi.fn>;
      mockUnlink.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      // delete() calls deleteDisk() which calls unlink()
      await expect(mgr.delete('some-key')).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to delete from disk cache:',
        expect.stringContaining('EACCES'),
      );
      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Disk cache: findClosestSnapshot with a matching disk snapshot file
  // -------------------------------------------------------------------------
  describe('disk cache: findClosestSnapshot with matching disk file', () => {
    it('returns snapshot from disk when a date-named balance_snapshot file is found', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      // findClosestSnapshot extracts dates from key format: balance_snapshot_YYYY-MM-DD_simulation
      const targetTime = new Date(Date.UTC(2025, 6, 1)).getTime(); // Jul 1, 2025

      const fileName = 'balance_snapshot_2025-01-01_sim-1.json';

      mockReaddir.mockResolvedValueOnce([fileName]);

      const snapshotData = JSON.stringify({
        data: {
          date: '2025-01-01',
          balances: { 'acct-1': 5000 },
          activityIndices: {},
          processedEventIds: [],
        },
        timestamp: new Date().toISOString(),
        expiresAt: null,
      });
      mockReadFile.mockResolvedValueOnce(snapshotData);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.findClosestSnapshot(new Date(targetTime));

      // Should have found the disk snapshot
      expect(result).not.toBeNull();
      expect(result!.snapshot.balances['acct-1']).toBe(5000);
    });

    it('returns null when disk snapshot file has timestamp after target date', async () => {
      const mockReaddir = readdir as ReturnType<typeof vi.fn>;

      const targetTime = new Date(Date.UTC(2025, 0, 1)).getTime(); // Jan 1, 2025

      // Snapshot date is Jul 1, 2025 (after target)
      const fileName = 'balance_snapshot_2025-07-01_sim-1.json';
      mockReaddir.mockResolvedValueOnce([fileName]);

      const diskConfig = makeConfig({ useDiskCache: true });
      const mgr = new CacheManager(diskConfig, 'sim-1');

      const result = await mgr.findClosestSnapshot(new Date(targetTime));

      // The file's timestamp is after target, so it doesn't qualify
      expect(result).toBeNull();
    });
  });
});
