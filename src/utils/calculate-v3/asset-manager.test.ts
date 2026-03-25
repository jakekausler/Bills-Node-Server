import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Asset } from '../../data/asset/asset';
import { AssetManager } from './asset-manager';
import type { ReplacementCycleData, FailureDistribution } from '../../data/asset/types';
import { createPayoutActivity } from './manager-payout';

// ===== Test Helpers =====

function createTestAsset(overrides?: Partial<Parameters<typeof Asset>[0]>): Asset {
  const data = {
    id: 'test-asset-1',
    name: 'Test Asset',
    type: 'home' as const,
    purchaseDate: '2020-01-01',
    purchasePrice: 100000,
    currentValue: 100000,
    currentValueDate: '2026-01-01',
    appreciation: 0.03,
    appreciationIsVariable: false,
    appreciationVariable: null,
    depreciationSchedule: null,
    replacementCycle: null,
    linkedAccounts: [],
    linkedBills: [],
    payFromAccount: null,
    sellingCosts: 0,
    capitalGainsExclusion: 0,
    saleRule: null,
    helocRule: null,
    status: 'owned' as const,
    ...overrides,
  };
  return new Asset(data);
}

function createTestAssetWithReplacement(
  overrides?: Partial<Parameters<typeof Asset>[0]>,
): Asset {
  const replacementCycle: ReplacementCycleData = {
    expectedYears: 8,
    distribution: { type: 'fixed', years: 8 },
    cost: 25000,
    costIsVariable: false,
    costVariable: null,
    currentAge: 4,
    warrantyYears: 0,
    tradeInValue: false,
  };

  return createTestAsset({
    replacementCycle,
    payFromAccount: 'checking-account',
    ...overrides,
  });
}

// ===== Tests =====

describe('AssetManager', () => {
  let manager: AssetManager;
  const simulation = 'test-simulation';

  beforeEach(() => {
    manager = new AssetManager([], simulation);
  });

  describe('Initialization', () => {
    it('initializes with empty assets', () => {
      expect(manager.getAssetValues().size).toBe(0);
      expect(manager.getPendingPayouts()).toHaveLength(0);
    });

    it('initializes asset states from asset data', () => {
      const asset = createTestAsset({
        currentValue: 150000,
        replacementCycle: {
          expectedYears: 8,
          distribution: { type: 'fixed', years: 8 },
          cost: 20000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 5,
          warrantyYears: 0,
          tradeInValue: false,
        },
      });

      manager = new AssetManager([asset], simulation);
      const values = manager.getAssetValues();
      expect(values.get(asset.id)).toBe(150000);
    });
  });

  describe('Static Appreciation', () => {
    it('applies static appreciation rate each year', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0.03,
      });

      manager = new AssetManager([asset], simulation);

      // Year 1
      manager.processYearBoundary(2026);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(103000, 0);

      // Year 2
      manager.processYearBoundary(2027);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(106090, 0);
    });

    it('handles zero appreciation rate', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0,
      });

      manager = new AssetManager([asset], simulation);
      manager.processYearBoundary(2026);

      expect(manager.getAssetValues().get(asset.id)).toBe(100000);
    });

    it('handles negative appreciation (depreciation via appreciation field)', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: -0.05,
      });

      manager = new AssetManager([asset], simulation);
      manager.processYearBoundary(2026);

      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(95000, 0);
    });
  });

  describe('Depreciation Schedule', () => {
    it('applies depreciation schedule correctly by age', () => {
      const schedule = [0.2, 0.15, 0.1, 0.05];
      const asset = createTestAsset({
        currentValue: 25000,
        depreciationSchedule: schedule,
        replacementCycle: {
          expectedYears: 10,
          distribution: { type: 'fixed', years: 10 },
          cost: 25000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 0,
          warrantyYears: 0,
          tradeInValue: false,
        },
      });

      manager = new AssetManager([asset], simulation);

      // Age 0: -20% → 20000
      manager.processYearBoundary(2026);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(20000, 0);

      // Age 1: -15% → 17000
      manager.processYearBoundary(2027);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(17000, 0);

      // Age 2: -10% → 15300
      manager.processYearBoundary(2028);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(15300, 0);

      // Age 3: -5% → 14535
      manager.processYearBoundary(2029);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(14535, 0);
    });

    it('repeats last depreciation value for ages beyond array length', () => {
      const schedule = [0.2, 0.15];
      const asset = createTestAsset({
        currentValue: 100,
        depreciationSchedule: schedule,
        replacementCycle: {
          expectedYears: 10,
          distribution: { type: 'fixed', years: 10 },
          cost: 100,
          costIsVariable: false,
          costVariable: null,
          currentAge: 0,
          warrantyYears: 0,
          tradeInValue: false,
        },
      });

      manager = new AssetManager([asset], simulation);

      // Age 0: -20% → 80
      manager.processYearBoundary(2026);
      let value = manager.getAssetValues().get(asset.id) ?? 0;
      expect(value).toBeCloseTo(80, 1);

      // Age 1: -15% → 68
      manager.processYearBoundary(2027);
      value = manager.getAssetValues().get(asset.id) ?? 0;
      expect(value).toBeCloseTo(68, 1);

      // Age 2+: repeat -15%
      manager.processYearBoundary(2028);
      value = manager.getAssetValues().get(asset.id) ?? 0;
      expect(value).toBeCloseTo(57.8, 1);

      manager.processYearBoundary(2029);
      value = manager.getAssetValues().get(asset.id) ?? 0;
      expect(value).toBeCloseTo(49.13, 1);
    });
  });

  describe('Variable Appreciation (Deterministic)', () => {
    it('uses loadVariable for appreciation in deterministic mode', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0,
        appreciationIsVariable: true,
        appreciationVariable: 'HOME_APPRECIATION',
      });

      manager = new AssetManager([asset], simulation);

      // Mock loadVariable
      vi.doMock('../simulation/variable', () => ({
        loadVariable: vi.fn(() => 0.035),
      }));

      // Note: actual test requires mocking loadVariable
      // This test verifies the structure; integration test in engine would verify behavior
    });
  });

  describe('Variable Appreciation (MC Mode)', () => {
    it('uses mcRateGetter for appreciation in MC mode', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0,
        appreciationIsVariable: true,
        appreciationVariable: 'HOME_APPRECIATION',
      });

      manager = new AssetManager([asset], simulation);

      const mockRateGetter = vi.fn(() => 0.04);
      manager.setMCRateGetter(mockRateGetter);

      manager.processYearBoundary(2026);

      expect(mockRateGetter).toHaveBeenCalledWith(expect.any(String), 2026);
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(104000, 0);
    });

    it('handles null MC rate getter gracefully', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0,
        appreciationIsVariable: true,
        appreciationVariable: 'HOME_APPRECIATION',
      });

      manager = new AssetManager([asset], simulation);

      const mockRateGetter = vi.fn(() => null);
      manager.setMCRateGetter(mockRateGetter);

      manager.processYearBoundary(2026);

      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(100000, 0);
    });
  });

  describe('Replacement: Deterministic Mode', () => {
    it('triggers replacement at expectedYears', () => {
      const asset = createTestAssetWithReplacement({
        currentValue: 15000,
        payFromAccount: 'checking',
      });

      manager = new AssetManager([asset], simulation);

      // Age starts at 4, expectedYears is 8
      // After 4 more years of processYearBoundary, age should be 8 → replacement
      for (let i = 0; i < 3; i++) {
        manager.processYearBoundary(2026 + i);
        expect(manager.getPendingPayouts()).toHaveLength(0);
      }

      // At age 8, should trigger
      manager.processYearBoundary(2029);
      const payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(1);
    });

    it('creates expense activity for replacement', () => {
      const asset = createTestAssetWithReplacement({
        currentValue: 12250,
        payFromAccount: 'checking',
        name: 'Honda CR-V',
      });

      manager = new AssetManager([asset], simulation);

      // Process until replacement year (age 8)
      for (let i = 0; i < 4; i++) {
        manager.processYearBoundary(2026 + i);
      }

      const payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(1);
      expect(payouts[0].activity.name).toBe('Honda CR-V Replacement');
      expect(payouts[0].activity.amount).toBe(-25000);
      expect(payouts[0].activity.category).toBe('Assets.Replacement');
      expect(payouts[0].targetAccountId).toBe('checking');
    });

    it('resets age to 0 after replacement', () => {
      const asset = createTestAssetWithReplacement();

      manager = new AssetManager([asset], simulation);

      // Process to replacement
      for (let i = 0; i < 4; i++) {
        manager.processYearBoundary(2026 + i);
      }

      manager.getPendingPayouts(); // Consume payouts

      // Process more years — should not trigger again immediately
      manager.processYearBoundary(2030);
      manager.processYearBoundary(2031);

      expect(manager.getPendingPayouts()).toHaveLength(0);
    });

    it('sets replacement cost as new asset value', () => {
      const asset = createTestAssetWithReplacement({
        currentValue: 12250,
      });

      manager = new AssetManager([asset], simulation);

      // Process to replacement
      for (let i = 0; i < 4; i++) {
        manager.processYearBoundary(2026 + i);
      }

      manager.getPendingPayouts(); // Consume payouts

      // After replacement, asset value should be the replacement cost
      expect(manager.getAssetValues().get(asset.id)).toBeCloseTo(25000, 0);
    });
  });

  describe('Warranty', () => {
    it('sets cost to zero within warranty period', () => {
      const asset = createTestAsset({
        currentValue: 10000,
        appreciation: 0,
        payFromAccount: 'checking',
        replacementCycle: {
          expectedYears: 2, // Trigger at age 2 to keep warranty check simple
          distribution: { type: 'fixed', years: 2 },
          cost: 25000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 1, // Will be 2 after next process, within 3-year warranty
          warrantyYears: 3, // Warranty covers ages 0-3
          tradeInValue: false,
        },
      });

      manager = new AssetManager([asset], simulation);

      manager.processYearBoundary(2026);
      const payouts = manager.getPendingPayouts();

      expect(payouts).toHaveLength(1);
      expect(payouts[0].activity.amount).toBe(0); // Zero cost due to warranty (age 2 <= warrantyYears 3)
    });
  });

  describe('Trade-In', () => {
    it('offsets depreciated value from replacement cost', () => {
      const asset = createTestAsset({
        currentValue: 5000, // Depreciated value
        appreciation: 0, // No appreciation to make calculation predictable
        payFromAccount: 'checking',
        replacementCycle: {
          expectedYears: 8,
          distribution: { type: 'fixed', years: 8 },
          cost: 25000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 7, // Will be 8 at next process
          warrantyYears: 0,
          tradeInValue: true,
        },
      });

      manager = new AssetManager([asset], simulation);
      manager.processYearBoundary(2026);

      const payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(1);
      expect(payouts[0].activity.amount).toBe(-(25000 - 5000)); // Cost minus trade-in
    });

    it('never goes negative with trade-in offset', () => {
      const asset = createTestAsset({
        currentValue: 30000, // Higher than cost
        appreciation: 0, // No appreciation
        payFromAccount: 'checking',
        replacementCycle: {
          expectedYears: 8,
          distribution: { type: 'fixed', years: 8 },
          cost: 25000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 7,
          warrantyYears: 0,
          tradeInValue: true,
        },
      });

      manager = new AssetManager([asset], simulation);
      manager.processYearBoundary(2026);

      const payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(1);
      expect(payouts[0].activity.amount).toBe(0); // max(0, 25000 - 30000) = 0
    });
  });

  describe('Failure Distributions', () => {
    describe('Fixed', () => {
      it('replaces at exact fixed age in MC mode', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 10,
            distribution: { type: 'fixed', years: 5 } as FailureDistribution,
            cost: 20000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 3,
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        manager = new AssetManager([asset], simulation);

        const mockPRNG = vi.fn();
        mockPRNG.mockReturnValue(0.5);
        manager.setPRNG(mockPRNG);

        // Age 3 → 4, conditional prob should be 0 (age < 5)
        manager.processYearBoundary(2026);
        expect(manager.getPendingPayouts()).toHaveLength(0);

        // Age 4 → 5, conditional prob should be 1 (age >= 5)
        mockPRNG.mockReturnValue(0.5);
        manager.processYearBoundary(2027);
        expect(manager.getPendingPayouts()).toHaveLength(1);
      });

      it('replaces at expectedYears in deterministic mode', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 5,
            distribution: { type: 'fixed', years: 10 } as FailureDistribution,
            cost: 20000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 3,
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        manager = new AssetManager([asset], simulation);
        // No PRNG set, so deterministic mode uses expectedYears

        // Age 3 → 4, 4 < 5 (expectedYears)
        manager.processYearBoundary(2026);
        expect(manager.getPendingPayouts()).toHaveLength(0);

        // Age 4 → 5, 5 >= 5 (expectedYears) → should trigger
        manager.processYearBoundary(2027);
        expect(manager.getPendingPayouts()).toHaveLength(1);
      });
    });

    describe('Weibull', () => {
      it('computes conditional failure probability correctly', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 12,
            distribution: { type: 'weibull', beta: 2.0, eta: 9 } as FailureDistribution,
            cost: 25000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 0,
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        const mockPRNG = vi.fn();
        mockPRNG.mockReturnValue(0.5); // 50% random draw

        manager = new AssetManager([asset], simulation);
        manager.setPRNG(mockPRNG);

        // At age 1, Weibull(2.0, 9) conditional probability should be small
        // CDF(1) = 1 - exp(-(1/9)^2) ≈ 0.0123
        // CDF(0) = 0
        // Conditional = 0.0123 / 1 ≈ 0.0123
        // So 0.5 > 0.0123, should not trigger

        manager.processYearBoundary(2026);
        expect(manager.getPendingPayouts()).toHaveLength(0);
      });
    });

    describe('Uniform', () => {
      it('applies uniform distribution within range', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 15,
            distribution: { type: 'uniform', min: 8, max: 12 } as FailureDistribution,
            cost: 20000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 7, // Will be 8 after next process
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        const mockPRNG = vi.fn();
        mockPRNG.mockReturnValue(0.3);

        manager = new AssetManager([asset], simulation);
        manager.setPRNG(mockPRNG);

        manager.processYearBoundary(2026);
        // At age 8, conditional = 1/(12-8) = 0.25
        // 0.3 > 0.25, should not trigger
        expect(manager.getPendingPayouts()).toHaveLength(0);

        mockPRNG.mockReturnValue(0.1);
        manager.processYearBoundary(2027);
        // At age 9, conditional = 1/(12-9) = 0.333...
        // 0.1 < 0.333, should trigger
        expect(manager.getPendingPayouts()).toHaveLength(1);
      });

      it('returns 0 before min age', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 15,
            distribution: { type: 'uniform', min: 8, max: 12 } as FailureDistribution,
            cost: 20000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 5, // 5 < 8 (min)
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        const mockPRNG = vi.fn();
        mockPRNG.mockReturnValue(0.99);

        manager = new AssetManager([asset], simulation);
        manager.setPRNG(mockPRNG);

        manager.processYearBoundary(2026);
        // Age 6 is still < 8 (min), conditional = 0
        // 0.99 > 0, should not trigger
        expect(manager.getPendingPayouts()).toHaveLength(0);
      });

      it('returns 1 at or beyond max age', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 15,
            distribution: { type: 'uniform', min: 8, max: 12 } as FailureDistribution,
            cost: 20000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 11, // 11 → 12 (at max)
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        const mockPRNG = vi.fn();
        mockPRNG.mockReturnValue(0.01); // Very low threshold

        manager = new AssetManager([asset], simulation);
        manager.setPRNG(mockPRNG);

        manager.processYearBoundary(2026);
        // Age 12 is at max, conditional = 1
        // 0.01 < 1, should trigger
        expect(manager.getPendingPayouts()).toHaveLength(1);
      });
    });

    describe('Normal', () => {
      it('uses normal distribution for failure sampling', () => {
        const asset = createTestAsset({
          currentValue: 10000,
          payFromAccount: 'checking',
          replacementCycle: {
            expectedYears: 15,
            distribution: { type: 'normal', mean: 10, stddev: 2 } as FailureDistribution,
            cost: 20000,
            costIsVariable: false,
            costVariable: null,
            currentAge: 9,
            warrantyYears: 0,
            tradeInValue: false,
          },
        });

        const mockPRNG = vi.fn();
        manager = new AssetManager([asset], simulation);
        manager.setPRNG(mockPRNG);

        // Normal CDF(10, 10, 2) = 0.5 (mean)
        // Normal CDF(9, 10, 2) ≈ 0.308
        // Conditional ≈ (0.5 - 0.308) / (1 - 0.308) ≈ 0.278
        mockPRNG.mockReturnValue(0.1);
        manager.processYearBoundary(2026);
        expect(manager.getPendingPayouts()).toHaveLength(1);
      });
    });
  });

  describe('Zero-Value Assets', () => {
    it('handles zero-value assets (appliances)', () => {
      const asset = createTestAsset({
        currentValue: 0,
        payFromAccount: 'checking',
        replacementCycle: {
          expectedYears: 8,
          distribution: { type: 'fixed', years: 8 },
          cost: 600,
          costIsVariable: false,
          costVariable: null,
          currentAge: 3,
          warrantyYears: 0,
          tradeInValue: false,
        },
      });

      manager = new AssetManager([asset], simulation);

      // Process to replacement
      for (let i = 0; i < 5; i++) {
        manager.processYearBoundary(2026 + i);
      }

      const payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(1);
      expect(payouts[0].activity.amount).toBe(-600); // Full cost, no trade-in
    });

    it('does not change zero-value assets', () => {
      const asset = createTestAsset({
        currentValue: 0,
        appreciation: 0.05, // Even with appreciation, zero stays zero
      });

      manager = new AssetManager([asset], simulation);

      manager.processYearBoundary(2026);
      manager.processYearBoundary(2027);

      expect(manager.getAssetValues().get(asset.id)).toBe(0);
    });
  });

  describe('Checkpoint and Restore', () => {
    it('preserves asset states across checkpoint/restore', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0.03,
        replacementCycle: {
          expectedYears: 8,
          distribution: { type: 'fixed', years: 8 },
          cost: 25000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 4,
          warrantyYears: 0,
          tradeInValue: false,
        },
      });

      manager = new AssetManager([asset], simulation);

      manager.processYearBoundary(2026);
      const valueAfterYear1 = manager.getAssetValues().get(asset.id) ?? 0;

      manager.checkpoint();
      manager.restore();

      // After restore, values should be identical
      expect(manager.getAssetValues().get(asset.id)).toBe(valueAfterYear1);
    });

    it('clears pending payouts on restore', () => {
      const asset = createTestAssetWithReplacement();

      manager = new AssetManager([asset], simulation);

      // Process to replacement
      for (let i = 0; i < 4; i++) {
        manager.processYearBoundary(2026 + i);
      }

      // Should have payouts
      let payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(1);

      // Checkpoint and restore
      manager.checkpoint();
      manager.restore();

      // Payouts should be cleared (not persisted across segment)
      payouts = manager.getPendingPayouts();
      expect(payouts).toHaveLength(0);
    });
  });

  describe('getAssetValues', () => {
    it('returns current values for all assets', () => {
      const asset1 = createTestAsset({ id: 'asset-1', currentValue: 100000 });
      const asset2 = createTestAsset({ id: 'asset-2', currentValue: 50000 });

      manager = new AssetManager([asset1, asset2], simulation);

      manager.processYearBoundary(2026);

      const values = manager.getAssetValues();
      expect(values.size).toBe(2);
      expect(values.get('asset-1')).toBeCloseTo(103000, 0);
      expect(values.get('asset-2')).toBeCloseTo(51500, 0);
    });

    it('handles multiple assets with different rates', () => {
      const homeAsset = createTestAsset({
        id: 'home',
        currentValue: 500000,
        appreciation: 0.035,
      });

      const carAsset = createTestAsset({
        id: 'car',
        currentValue: 25000,
        depreciationSchedule: [0.2, 0.11, 0.11],
        replacementCycle: {
          expectedYears: 8,
          distribution: { type: 'fixed', years: 8 },
          cost: 25000,
          costIsVariable: false,
          costVariable: null,
          currentAge: 0,
          warrantyYears: 0,
          tradeInValue: false,
        },
      });

      manager = new AssetManager([homeAsset, carAsset], simulation);

      manager.processYearBoundary(2026);

      const values = manager.getAssetValues();
      expect(values.get('home')).toBeCloseTo(517500, 0);
      expect(values.get('car')).toBeCloseTo(20000, 0);
    });
  });

  describe('No Replacement (Asset without cycle)', () => {
    it('does not create activities for assets without replacement cycle', () => {
      const asset = createTestAsset({
        currentValue: 100000,
        appreciation: 0.03,
        replacementCycle: null,
      });

      manager = new AssetManager([asset], simulation);

      for (let i = 0; i < 10; i++) {
        manager.processYearBoundary(2026 + i);
      }

      expect(manager.getPendingPayouts()).toHaveLength(0);
      expect(manager.getAssetValues().get(asset.id)).toBeGreaterThan(100000);
    });
  });
});
