/**
 * Test suite for cache management in calculate-v2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheManager } from './cache';
import { BalanceSnapshot, CalculationConfig } from './types';
import fs from 'fs/promises';
import path from 'path';

// Mock fs module
vi.mock('fs/promises');
const mockFs = vi.mocked(fs);

// Mock path module
vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/')
  }
}));

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  
  const mockConfig: CalculationConfig = {
    diskCacheDir: '/tmp/test-cache',
    maxMemoryCacheMB: 100,
    enableDiskCache: true,
    cacheExpirationDays: 7,
    maxEventCount: 10000,
    segmentSize: 'month'
  };

  beforeEach(() => {
    cacheManager = new CacheManager(mockConfig);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Memory cache operations', () => {
    it('should store and retrieve values from memory cache', async () => {
      const testValue = { test: 'data' };
      const key = 'test-key';

      await cacheManager.set(key, testValue);
      const retrieved = await cacheManager.get<typeof testValue>(key);

      expect(retrieved).toEqual(testValue);
    });

    it('should handle cache expiration', async () => {
      const testValue = { test: 'data' };
      const key = 'test-key';
      const expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago

      await cacheManager.set(key, testValue, { expiresAt });
      const retrieved = await cacheManager.get<typeof testValue>(key);

      expect(retrieved).toBeNull();
    });

    it('should respect memory size limits', async () => {
      const largeValue = { data: 'x'.repeat(6000000) }; // ~6MB
      const key = 'large-key';

      await cacheManager.set(key, largeValue, { size: 6000000 });
      
      // Should be stored on disk due to size
      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Disk cache operations', () => {
    it('should store and retrieve values from disk cache', async () => {
      const testValue = { test: 'data' };
      const key = 'test-key';

      mockFs.writeFile.mockResolvedValue();
      mockFs.readFile.mockResolvedValue(JSON.stringify(testValue));
      mockFs.access.mockResolvedValue();

      await cacheManager.set(key, testValue, { forceDisk: true });
      const retrieved = await cacheManager.get<typeof testValue>(key);

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.readFile).toHaveBeenCalled();
      expect(retrieved).toEqual(testValue);
    });

    it('should handle disk cache errors gracefully', async () => {
      const key = 'test-key';

      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      const retrieved = await cacheManager.get(key);
      expect(retrieved).toBeNull();
    });
  });

  describe('Balance snapshot operations', () => {
    it('should store and find closest balance snapshots', async () => {
      const snapshot1: BalanceSnapshot = {
        date: new Date('2024-01-01'),
        balances: { 'acc1': 1000 },
        activityIndices: { 'acc1': 0 },
        interestStates: {},
        dataHash: 'hash1',
        processedEventIds: new Set(['event1'])
      };

      const snapshot2: BalanceSnapshot = {
        date: new Date('2024-01-15'),
        balances: { 'acc1': 1500 },
        activityIndices: { 'acc1': 5 },
        interestStates: {},
        dataHash: 'hash2',
        processedEventIds: new Set(['event1', 'event2'])
      };

      await cacheManager.storeBalanceSnapshot('2024-01-01', snapshot1);
      await cacheManager.storeBalanceSnapshot('2024-01-15', snapshot2);

      const closest = await cacheManager.findClosestSnapshot(new Date('2024-01-10'));
      
      expect(closest).toBeTruthy();
      expect(closest!.snapshot.date).toEqual(snapshot1.date);
    });

    it('should return null when no snapshots exist', async () => {
      const closest = await cacheManager.findClosestSnapshot(new Date('2024-01-10'));
      expect(closest).toBeNull();
    });
  });

  describe('Cache statistics', () => {
    it('should track cache statistics correctly', async () => {
      const testValue = { test: 'data' };
      
      // Cache miss
      await cacheManager.get('missing-key');
      
      // Cache hit
      await cacheManager.set('test-key', testValue);
      await cacheManager.get('test-key');

      const stats = cacheManager.getStats();
      
      expect(stats.memoryHits).toBe(1);
      expect(stats.memoryMisses).toBe(1);
      expect(stats.memorySize).toBeGreaterThan(0);
      expect(stats.totalKeys).toBe(1);
    });
  });

  describe('Cache invalidation', () => {
    it('should clear all caches', async () => {
      const testValue = { test: 'data' };
      
      await cacheManager.set('key1', testValue);
      await cacheManager.set('key2', testValue);
      
      await cacheManager.clear();
      
      const retrieved1 = await cacheManager.get('key1');
      const retrieved2 = await cacheManager.get('key2');
      
      expect(retrieved1).toBeNull();
      expect(retrieved2).toBeNull();
    });

    it('should invalidate by pattern', async () => {
      const testValue = { test: 'data' };
      
      await cacheManager.set('balance_2024_01_01', testValue);
      await cacheManager.set('balance_2024_01_02', testValue);
      await cacheManager.set('other_key', testValue);
      
      await cacheManager.invalidatePattern('balance_*');
      
      const balance1 = await cacheManager.get('balance_2024_01_01');
      const balance2 = await cacheManager.get('balance_2024_01_02');
      const other = await cacheManager.get('other_key');
      
      expect(balance1).toBeNull();
      expect(balance2).toBeNull();
      expect(other).toEqual(testValue);
    });
  });
});