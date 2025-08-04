/**
 * Test suite for integration layer in calculate-v2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalculationAPIWrapper } from './integration';
import { AccountsAndTransfers } from '../../data/account/types';
import { createMockAccountsAndTransfers } from '../test/mockData';

// Mock the new calculation engine
vi.mock('./engine', () => ({
  CalculationEngine: vi.fn().mockImplementation(() => ({
    calculate: vi.fn().mockResolvedValue({
      success: true,
      segments: [],
      balanceSnapshots: new Map(),
      performance: {
        totalTime: 100,
        eventCount: 10,
        segmentCount: 5,
        cacheHits: 3,
        cacheMisses: 2,
      },
    }),
  })),
}));

// Mock the legacy calculation
vi.mock('../calculate/calculate', () => ({
  calculateAllActivity: vi.fn().mockImplementation((accountsAndTransfers) => {
    // Simulate legacy calculation modifying accounts in place
    accountsAndTransfers.accounts.forEach((account: any) => {
      if (!account.consolidatedActivity) {
        account.consolidatedActivity = [];
      }
      account.consolidatedActivity.push({
        id: 'legacy_activity',
        name: 'Legacy Calculation',
        amount: 100,
        date: new Date(),
        category: 'Test',
      });
    });
    return Promise.resolve();
  }),
}));

describe('CalculationAPIWrapper', () => {
  let wrapper: CalculationAPIWrapper;
  let mockAccountsAndTransfers: AccountsAndTransfers;

  beforeEach(() => {
    wrapper = new CalculationAPIWrapper();
    mockAccountsAndTransfers = createMockAccountsAndTransfers({
      accounts: [
        {
          id: 'acc1',
          name: 'Checking',
          balance: 1000,
          activity: [],
          bills: [],
          interests: [],
          consolidatedActivity: [],
        },
      ],
    });
    vi.clearAllMocks();
  });

  describe('Feature flag management', () => {
    it('should use legacy calculation when new system is disabled', async () => {
      wrapper.enableNewCalculationSystem(false);

      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      // Should have called legacy calculation
      expect(mockAccountsAndTransfers.accounts[0].consolidatedActivity).toHaveLength(1);
      expect(mockAccountsAndTransfers.accounts[0].consolidatedActivity[0].name).toBe('Legacy Calculation');
    });

    it('should use new calculation when enabled', async () => {
      wrapper.enableNewCalculationSystem(true);

      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      // New calculation system should be used (mocked to return success)
      expect(mockAccountsAndTransfers.accounts[0].consolidatedActivity).toHaveLength(0); // New system doesn't modify in place
    });
  });

  describe('Gradual rollout functionality', () => {
    it('should respect rollout percentage for gradual adoption', async () => {
      wrapper.setRolloutPercentage(0); // 0% rollout

      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      // Should use legacy system
      expect(mockAccountsAndTransfers.accounts[0].consolidatedActivity).toHaveLength(1);
    });

    it('should provide consistent rollout decisions for same data', async () => {
      wrapper.setRolloutPercentage(50); // 50% rollout

      // Multiple calls with same data should get same system
      const decision1 = wrapper.shouldUseNewSystem(mockAccountsAndTransfers);
      const decision2 = wrapper.shouldUseNewSystem(mockAccountsAndTransfers);

      expect(decision1).toBe(decision2);
    });
  });

  describe('Performance comparison', () => {
    it('should track performance metrics for both systems', async () => {
      wrapper.enablePerformanceComparison(true);
      wrapper.enableNewCalculationSystem(true);

      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      const metrics = wrapper.getPerformanceMetrics();

      expect(metrics.newSystemCalls).toBe(1);
      expect(metrics.averageNewSystemTime).toBeGreaterThan(0);
    });

    it('should compare calculation times between systems', async () => {
      wrapper.enablePerformanceComparison(true);

      // Test new system
      wrapper.enableNewCalculationSystem(true);
      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      // Test legacy system
      wrapper.enableNewCalculationSystem(false);
      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      const comparison = wrapper.getPerformanceComparison();

      expect(comparison.newSystemAverage).toBeDefined();
      expect(comparison.legacySystemAverage).toBeDefined();
      expect(comparison.speedupFactor).toBeDefined();
    });
  });

  describe('Fallback and error handling', () => {
    it('should fallback to legacy system on new system errors', async () => {
      const mockEngine = await import('./engine');
      (mockEngine.CalculationEngine as any).mockImplementation(() => ({
        calculate: vi.fn().mockRejectedValue(new Error('New system error')),
      }));

      wrapper.enableNewCalculationSystem(true);
      wrapper.enableFallbackOnError(true);

      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      // Should fallback to legacy system
      expect(mockAccountsAndTransfers.accounts[0].consolidatedActivity).toHaveLength(1);

      const errorMetrics = wrapper.getErrorMetrics();
      expect(errorMetrics.newSystemErrors).toBe(1);
      expect(errorMetrics.fallbackUsed).toBe(1);
    });

    it('should track error rates for monitoring', async () => {
      const mockEngine = await import('./engine');
      (mockEngine.CalculationEngine as any).mockImplementation(() => ({
        calculate: vi.fn().mockRejectedValue(new Error('Test error')),
      }));

      wrapper.enableNewCalculationSystem(true);
      wrapper.enableFallbackOnError(false); // Disable fallback to test error tracking

      try {
        await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));
      } catch (error) {
        // Expected to throw
      }

      const errorMetrics = wrapper.getErrorMetrics();
      expect(errorMetrics.newSystemErrors).toBe(1);
      expect(errorMetrics.errorRate).toBeGreaterThan(0);
    });
  });

  describe('Data validation and migration', () => {
    it('should validate data compatibility between systems', async () => {
      const isCompatible = await wrapper.validateDataCompatibility(mockAccountsAndTransfers);

      expect(typeof isCompatible).toBe('boolean');
    });

    it('should identify data transformation needs', async () => {
      const issues = await wrapper.identifyDataIssues(mockAccountsAndTransfers);

      expect(Array.isArray(issues)).toBe(true);
    });

    it('should provide data migration utilities', async () => {
      const migrated = await wrapper.migrateDataForNewSystem(mockAccountsAndTransfers);

      expect(migrated).toBeDefined();
      expect(migrated.accounts).toBeDefined();
    });
  });

  describe('API compatibility', () => {
    it('should maintain exact API signature compatibility', async () => {
      // Test all original parameters are supported
      await expect(
        wrapper.calculateAllActivity(
          mockAccountsAndTransfers,
          new Date('2024-01-01'),
          new Date('2024-12-31'),
          'TestSimulation',
          false, // monteCarlo
          1, // simulationNumber
          100, // nSimulations
        ),
      ).resolves.not.toThrow();
    });

    it('should handle optional parameters correctly', async () => {
      // Test with minimal parameters
      await expect(
        wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31')),
      ).resolves.not.toThrow();
    });

    it('should preserve original data structure modifications', async () => {
      wrapper.enableNewCalculationSystem(false); // Use legacy for this test

      const originalCount = mockAccountsAndTransfers.accounts[0].consolidatedActivity.length;

      await wrapper.calculateAllActivity(mockAccountsAndTransfers, new Date('2024-01-01'), new Date('2024-12-31'));

      expect(mockAccountsAndTransfers.accounts[0].consolidatedActivity.length).toBeGreaterThan(originalCount);
    });
  });

  describe('Monte Carlo simulation support', () => {
    it('should handle Monte Carlo mode correctly', async () => {
      wrapper.enableNewCalculationSystem(true);

      await wrapper.calculateAllActivity(
        mockAccountsAndTransfers,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        'Default',
        true, // monteCarlo = true
        5, // simulationNumber
        1000, // nSimulations
      );

      // Should execute without throwing
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.newSystemCalls).toBe(1);
    });
  });
});
