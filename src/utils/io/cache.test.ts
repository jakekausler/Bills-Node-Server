import { describe, it, expect, beforeEach } from 'vitest';
import {
  CACHE_ACCOUNTS_AND_TRANSFERS,
  MIN_DATE,
  MAX_DATE,
  RMD_TABLE,
  resetCache,
  getCacheKey,
  updateCache,
  getCache,
  setMinDate,
  setMaxDate,
  setRMDTable,
} from './cache';

describe('Cache Utility', () => {
  beforeEach(() => {
    resetCache();
  });

  describe('resetCache', () => {
    it('should reset all cache values to initial state', () => {
      // Set some values
      updateCache(CACHE_ACCOUNTS_AND_TRANSFERS, 'test-key', { accounts: [], transfers: { activity: [], bills: [] } } as any);
      setMinDate(new Date('2024-01-01'));
      setMaxDate(new Date('2024-12-31'));
      setRMDTable({ 70: 27.4, 71: 26.5 });

      // Reset cache
      resetCache();

      // Verify all values are reset
      expect(Object.keys(CACHE_ACCOUNTS_AND_TRANSFERS)).toHaveLength(0);
      expect(MIN_DATE).toBeUndefined();
      expect(MAX_DATE).toBeUndefined();
      expect(Object.keys(RMD_TABLE)).toHaveLength(0);
    });
  });

  describe('getCacheKey', () => {
    it('should generate cache key from dates and simulation', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const simulation = 'Test';

      const key = getCacheKey(startDate, endDate, simulation);

      expect(key).toBe('2024-01-01-2024-12-31-Test');
    });

    it('should handle different date formats consistently', () => {
      const startDate = new Date('2024-03-15');
      const endDate = new Date('2024-11-30');
      const simulation = 'Default';

      const key = getCacheKey(startDate, endDate, simulation);

      expect(key).toBe('2024-03-15-2024-11-30-Default');
    });
  });

  describe('updateCache and getCache', () => {
    it('should store and retrieve cache values', () => {
      const cache = {};
      const key = 'test-key';
      const data = { test: 'value' };

      updateCache(cache, key, data);
      const retrieved = getCache(cache, key);

      expect(retrieved).toEqual(data);
    });

    it('should handle complex data structures', () => {
      const cache = {};
      const key = 'accounts-key';
      const data = {
        accounts: [
          { id: '1', name: 'Test Account', balance: 1000 },
          { id: '2', name: 'Another Account', balance: 2000 },
        ],
        transfers: {
          activity: [{ id: '1', amount: 100 }],
          bills: [{ id: '1', amount: 200 }],
        },
      };

      updateCache(cache, key, data);
      const retrieved = getCache(cache, key);

      expect(retrieved).toEqual(data);
      expect(retrieved.accounts).toHaveLength(2);
      expect(retrieved.transfers.activity).toHaveLength(1);
    });

    it('should overwrite existing cache values', () => {
      const cache = {};
      const key = 'test-key';
      const data1 = { value: 'first' };
      const data2 = { value: 'second' };

      updateCache(cache, key, data1);
      updateCache(cache, key, data2);

      const retrieved = getCache(cache, key);
      expect(retrieved).toEqual(data2);
    });
  });

  describe('setMinDate', () => {
    it('should set MIN_DATE', () => {
      const testDate = new Date('2024-01-01');
      
      setMinDate(testDate);
      
      expect(MIN_DATE).toBe(testDate);
    });

    it('should handle date objects correctly', () => {
      const testDate = new Date('2020-12-31');
      
      setMinDate(testDate);
      
      expect(MIN_DATE).toBeInstanceOf(Date);
      expect(MIN_DATE).toEqual(testDate);
    });
  });

  describe('setMaxDate', () => {
    it('should set MAX_DATE', () => {
      const testDate = new Date('2024-12-31');
      
      setMaxDate(testDate);
      
      expect(MAX_DATE).toBe(testDate);
    });

    it('should handle date objects correctly', () => {
      const testDate = new Date('2030-01-01');
      
      setMaxDate(testDate);
      
      expect(MAX_DATE).toBeInstanceOf(Date);
      expect(MAX_DATE).toEqual(testDate);
    });
  });

  describe('setRMDTable', () => {
    it('should set RMD_TABLE', () => {
      const testTable = {
        70: 27.4,
        71: 26.5,
        72: 25.6,
      };
      
      setRMDTable(testTable);
      
      expect(RMD_TABLE).toEqual(testTable);
    });

    it('should handle complex RMD tables', () => {
      const testTable = {
        70: 27.4,
        71: 26.5,
        72: 25.6,
        73: 24.7,
        74: 23.8,
        75: 22.9,
      };
      
      setRMDTable(testTable);
      
      expect(RMD_TABLE).toEqual(testTable);
      expect(Object.keys(RMD_TABLE)).toHaveLength(6);
    });

    it('should overwrite existing RMD table', () => {
      const table1 = { 70: 27.4, 71: 26.5 };
      const table2 = { 72: 25.6, 73: 24.7 };
      
      setRMDTable(table1);
      setRMDTable(table2);
      
      expect(RMD_TABLE).toEqual(table2);
    });
  });

  describe('CACHE_ACCOUNTS_AND_TRANSFERS integration', () => {
    it('should work with accounts and transfers cache', () => {
      const key = getCacheKey(new Date('2024-01-01'), new Date('2024-12-31'), 'Default');
      const data = {
        accounts: [
          { id: '1', name: 'Checking', balance: 1000 },
        ],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      updateCache(CACHE_ACCOUNTS_AND_TRANSFERS, key, data);
      const retrieved = getCache(CACHE_ACCOUNTS_AND_TRANSFERS, key);

      expect(retrieved).toEqual(data);
    });
  });
});