import { describe, it, expect, beforeEach } from 'vitest';
import { DATA_CACHE, MAX_CACHE_SIZE, clearDataCache } from './dataCache';

describe('Data Cache', () => {
  beforeEach(() => {
    clearDataCache();
  });

  describe('clearDataCache', () => {
    it('should clear the cache', () => {
      // Add some data to cache
      DATA_CACHE.set('test-key-1', { accounts: [], transfers: { activity: [], bills: [] } } as any);
      DATA_CACHE.set('test-key-2', { accounts: [], transfers: { activity: [], bills: [] } } as any);

      expect(DATA_CACHE.size).toBe(2);

      clearDataCache();

      expect(DATA_CACHE.size).toBe(0);
    });

    it('should clear cache with many entries', () => {
      // Fill cache with entries
      for (let i = 0; i < 10; i++) {
        DATA_CACHE.set(`key-${i}`, { accounts: [], transfers: { activity: [], bills: [] } } as any);
      }

      expect(DATA_CACHE.size).toBe(10);

      clearDataCache();

      expect(DATA_CACHE.size).toBe(0);
    });

    it('should not throw when cache is already empty', () => {
      clearDataCache();
      expect(DATA_CACHE.size).toBe(0);

      expect(() => clearDataCache()).not.toThrow();
      expect(DATA_CACHE.size).toBe(0);
    });
  });

  describe('DATA_CACHE', () => {
    it('should be a Map instance', () => {
      expect(DATA_CACHE).toBeInstanceOf(Map);
    });

    it('should allow setting and getting values', () => {
      const testData = { accounts: [], transfers: { activity: [], bills: [] } } as any;
      DATA_CACHE.set('test-key', testData);

      expect(DATA_CACHE.get('test-key')).toBe(testData);
    });
  });

  describe('MAX_CACHE_SIZE', () => {
    it('should be set to 50', () => {
      expect(MAX_CACHE_SIZE).toBe(50);
    });
  });
});
