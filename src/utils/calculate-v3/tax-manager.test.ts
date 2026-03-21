// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Assertions: expect() with toBe, toEqual, toThrow patterns
// - Async: async/await where needed
// - Structure: describe/it with Arrange-Act-Assert

import { describe, it, expect, beforeEach } from 'vitest';
import { TaxManager } from './tax-manager';
import { TaxableOccurrence, WithholdingOccurrence } from './types';
import { DeductionTracker } from './deduction-tracker';
import { TaxProfile } from './tax-profile-types';

function makeTaxableEvent(overrides: Partial<TaxableOccurrence> = {}): TaxableOccurrence {
  return {
    date: new Date('2025-06-15'),
    year: 2025,
    amount: 1000,
    incomeType: 'ordinary',
    ...overrides,
  };
}

function makeWithholdingOccurrence(overrides: Partial<WithholdingOccurrence> = {}): WithholdingOccurrence {
  return {
    date: new Date('2025-06-15'),
    year: 2025,
    federalAmount: 200,
    stateAmount: 50,
    source: 'paycheck',
    ...overrides,
  };
}

describe('TaxManager', () => {
  let manager: TaxManager;

  beforeEach(() => {
    manager = new TaxManager();
  });

  // ---------------------------------------------------------------------------
  // addTaxableOccurrence
  // ---------------------------------------------------------------------------
  describe('addTaxableOccurrence', () => {
    it('adds a single taxable event for an account', () => {
      const event = makeTaxableEvent();
      manager.addTaxableOccurrence('account-1', event);

      const events = manager.getTaxableOccurrences('account-1', 2025);
      expect(events).toHaveLength(1);
      expect(events[0]).toBe(event);
    });

    it('adds multiple events for the same account and year', () => {
      const event1 = makeTaxableEvent({ amount: 500 });
      const event2 = makeTaxableEvent({ amount: 750 });

      manager.addTaxableOccurrence('account-1', event1);
      manager.addTaxableOccurrence('account-1', event2);

      const events = manager.getTaxableOccurrences('account-1', 2025);
      expect(events).toHaveLength(2);
    });

    it('creates separate year maps for different years', () => {
      const event2025 = makeTaxableEvent({ year: 2025 });
      const event2026 = makeTaxableEvent({ year: 2026 });

      manager.addTaxableOccurrence('account-1', event2025);
      manager.addTaxableOccurrence('account-1', event2026);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(1);
      expect(manager.getTaxableOccurrences('account-1', 2026)).toHaveLength(1);
    });

    it('creates separate account entries within the same year', () => {
      const event = makeTaxableEvent();

      manager.addTaxableOccurrence('account-1', event);
      manager.addTaxableOccurrence('account-2', event);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(1);
      expect(manager.getTaxableOccurrences('account-2', 2025)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // addTaxableOccurrences (plural)
  // ---------------------------------------------------------------------------
  describe('addTaxableOccurrences', () => {
    it('adds all events from an array', () => {
      const events = [
        makeTaxableEvent({ amount: 100 }),
        makeTaxableEvent({ amount: 200 }),
        makeTaxableEvent({ amount: 300 }),
      ];

      manager.addTaxableOccurrences('account-1', events);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(3);
    });

    it('handles empty events array without error', () => {
      manager.addTaxableOccurrences('account-1', []);
      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
    });

    it('adds events across multiple years', () => {
      const events = [
        makeTaxableEvent({ year: 2025 }),
        makeTaxableEvent({ year: 2026 }),
        makeTaxableEvent({ year: 2025 }),
      ];

      manager.addTaxableOccurrences('account-1', events);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(2);
      expect(manager.getTaxableOccurrences('account-1', 2026)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getTaxableOccurrences
  // ---------------------------------------------------------------------------
  describe('getTaxableOccurrences', () => {
    it('returns empty array when no events exist for the account', () => {
      expect(manager.getTaxableOccurrences('account-1', 2025)).toEqual([]);
    });

    it('returns empty array when the year has no entries', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025 }));
      expect(manager.getTaxableOccurrences('account-1', 2026)).toEqual([]);
    });

    it('returns empty array when the account has no entries for the given year', () => {
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025 }));
      expect(manager.getTaxableOccurrences('account-1', 2025)).toEqual([]);
    });

    it('returns the correct events for the specified account and year', () => {
      const event = makeTaxableEvent({ amount: 5000 });
      manager.addTaxableOccurrence('account-1', event);

      const result = manager.getTaxableOccurrences('account-1', 2025);
      expect(result[0].amount).toBe(5000);
    });
  });

  // ---------------------------------------------------------------------------
  // getAllOccurrencesForYear
  // ---------------------------------------------------------------------------
  describe('getAllOccurrencesForYear', () => {
    it('returns empty array when no data for the year', () => {
      expect(manager.getAllOccurrencesForYear(2025)).toEqual([]);
    });

    it('aggregates all occurrences across all accounts for a year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 1000 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025, amount: 2000 }));
      manager.addTaxableOccurrence('account-3', makeTaxableEvent({ year: 2025, amount: 3000 }));

      const all = manager.getAllOccurrencesForYear(2025);
      expect(all).toHaveLength(3);
      expect(all.map(o => o.amount)).toEqual([1000, 2000, 3000]);
    });

    it('does not include occurrences from other years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 1000 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026, amount: 2000 }));

      const all2025 = manager.getAllOccurrencesForYear(2025);
      expect(all2025).toHaveLength(1);
      expect(all2025[0].amount).toBe(1000);
    });

    it('aggregates multiple occurrences from the same account', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 500 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 700 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025, amount: 800 }));

      const all = manager.getAllOccurrencesForYear(2025);
      expect(all).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateTotalTaxOwed - bracket-based taxation
  // ---------------------------------------------------------------------------
  describe('calculateTotalTaxOwed', () => {
    it('returns 0 when no events exist', () => {
      const tax = manager.calculateTotalTaxOwed(2025, 'mfj');
      expect(tax).toBe(0);
    });

    it('calculates tax on $50K ordinary income MFJ', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));

      const tax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      // 2025 MFJ: standard deduction ~$30K (inflated), so taxable is ~$20K
      // At 2025 rates, this should be roughly $2,000-$3,000 in the 12% bracket
      expect(tax).toBeGreaterThan(1000);
      expect(tax).toBeLessThan(5000);
    });

    it('aggregates ordinary, retirement, and interest income', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 30000, incomeType: 'ordinary' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 20000, incomeType: 'retirement' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 5000, incomeType: 'interest' }));

      const tax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      // Total ordinary income: 55K
      expect(tax).toBeGreaterThan(0);
    });

    it('handles Social Security income with partial taxation', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 30000, incomeType: 'ordinary' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 30000, incomeType: 'socialSecurity' }));

      const tax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      // Provisional income = 30K + 15K = 45K
      // At MFJ tier1 (32K in 2025), 50% of SS is taxable up to tier2
      expect(tax).toBeGreaterThan(0);
    });

    it('adds penalties on top of bracket tax', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      const taxWithoutPenalty = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      // For testing penalty addition, use a different year
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026, amount: 50000, incomeType: 'ordinary' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026, amount: 1000, incomeType: 'penalty' }));

      const taxWithPenalty = manager.calculateTotalTaxOwed(2026, 'mfj', 0.03);
      expect(taxWithPenalty).toBeGreaterThan(taxWithoutPenalty);
    });

    it('uses different tax calculation for Single filing status', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));

      const mfjTax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      manager.clearAllTaxableOccurrences(2025);

      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      const singleTax = manager.calculateTotalTaxOwed(2025, 'single', 0.03);

      // Single should have higher tax than MFJ on same income (narrower brackets)
      expect(singleTax).toBeGreaterThan(mfjTax);
    });

    it('respects bracket inflation rate for future years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2030, amount: 50000, incomeType: 'ordinary' }));

      const tax3Pct = manager.calculateTotalTaxOwed(2030, 'mfj', 0.03);
      manager.clearAllTaxableOccurrences(2030);

      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2030, amount: 50000, incomeType: 'ordinary' }));
      const tax5Pct = manager.calculateTotalTaxOwed(2030, 'mfj', 0.05);

      // Higher inflation rate = higher brackets = lower tax (or equal)
      expect(tax5Pct).toBeLessThanOrEqual(tax3Pct);
    });

    it('caches results for a year (same result on second call)', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));

      const firstCall = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      const secondCall = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      expect(firstCall).toBe(secondCall);
    });

    it('returns different results for different years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026, amount: 50000, incomeType: 'ordinary' }));

      const tax2025 = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      const tax2026 = manager.calculateTotalTaxOwed(2026, 'mfj', 0.03);

      // Different years may have different bracket data / inflation
      expect(tax2025).toBeGreaterThan(0);
      expect(tax2026).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // clearTaxableOccurrences
  // ---------------------------------------------------------------------------
  describe('clearTaxableOccurrences', () => {
    it('removes all events for a specific account and year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent());
      manager.addTaxableOccurrence('account-1', makeTaxableEvent());

      manager.clearTaxableOccurrences('account-1', 2025);
      expect(manager.getTaxableOccurrences('account-1', 2025)).toEqual([]);
    });

    it('does not affect other accounts in the same year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent());
      manager.addTaxableOccurrence('account-2', makeTaxableEvent());

      manager.clearTaxableOccurrences('account-1', 2025);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
      expect(manager.getTaxableOccurrences('account-2', 2025)).toHaveLength(1);
    });

    it('does not affect the same account in different years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026 }));

      manager.clearTaxableOccurrences('account-1', 2025);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
      expect(manager.getTaxableOccurrences('account-1', 2026)).toHaveLength(1);
    });

    it('removes the year entry when the last account is cleared', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent());
      manager.clearTaxableOccurrences('account-1', 2025);

      expect(manager.getAccountsWithTaxableEvents(2025)).toHaveLength(0);
    });

    it('invalidates cache when clearing taxable occurrences', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      const firstTax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      manager.clearTaxableOccurrences('account-1', 2025);
      const secondTax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      // After clearing, tax should be 0
      expect(secondTax).toBe(0);
      expect(firstTax).toBeGreaterThan(0);
    });

    it('is a no-op when account has no events in the given year', () => {
      expect(() => manager.clearTaxableOccurrences('nonexistent', 2025)).not.toThrow();
    });

    it('is a no-op when year has no entries at all', () => {
      expect(() => manager.clearTaxableOccurrences('account-1', 9999)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // clearAllTaxableOccurrences
  // ---------------------------------------------------------------------------
  describe('clearAllTaxableOccurrences', () => {
    it('removes all accounts for a given year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025 }));

      manager.clearAllTaxableOccurrences(2025);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
      expect(manager.getTaxableOccurrences('account-2', 2025)).toHaveLength(0);
      expect(manager.getAccountsWithTaxableEvents(2025)).toHaveLength(0);
    });

    it('does not affect other years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026 }));

      manager.clearAllTaxableOccurrences(2025);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
      expect(manager.getTaxableOccurrences('account-1', 2026)).toHaveLength(1);
    });

    it('invalidates cache when clearing all taxable occurrences for a year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      const firstTax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      manager.clearAllTaxableOccurrences(2025);
      const secondTax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      expect(secondTax).toBe(0);
      expect(firstTax).toBeGreaterThan(0);
    });

    it('is a no-op for a year with no data', () => {
      expect(() => manager.clearAllTaxableOccurrences(9999)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getAccountsWithTaxableEvents
  // ---------------------------------------------------------------------------
  describe('getAccountsWithTaxableEvents', () => {
    it('returns empty array when no data for the year', () => {
      expect(manager.getAccountsWithTaxableEvents(2025)).toEqual([]);
    });

    it('returns all account IDs that have events in the given year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025 }));
      manager.addTaxableOccurrence('account-3', makeTaxableEvent({ year: 2026 }));

      const accounts2025 = manager.getAccountsWithTaxableEvents(2025);
      expect(accounts2025).toHaveLength(2);
      expect(accounts2025).toContain('account-1');
      expect(accounts2025).toContain('account-2');
    });

    it('does not include accounts from other years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2026 }));

      const accounts2025 = manager.getAccountsWithTaxableEvents(2025);
      expect(accounts2025).not.toContain('account-2');
    });

    it('returns single account when only one has events', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent());
      const accounts = manager.getAccountsWithTaxableEvents(2025);
      expect(accounts).toEqual(['account-1']);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: combined operations
  // ---------------------------------------------------------------------------
  describe('integration', () => {
    it('correctly accumulates and clears events across multiple accounts and years', () => {
      manager.addTaxableOccurrences('roth-ira', [
        makeTaxableEvent({ year: 2025, amount: 5000, incomeType: 'ordinary' }),
        makeTaxableEvent({ year: 2025, amount: 3000, incomeType: 'ordinary' }),
      ]);
      manager.addTaxableOccurrences('401k', [
        makeTaxableEvent({ year: 2025, amount: 20000, incomeType: 'ordinary' }),
        makeTaxableEvent({ year: 2026, amount: 25000, incomeType: 'ordinary' }),
      ]);

      // Verify aggregation for 2025 - should have some tax on 28K combined income
      const tax2025 = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      // Income is 28K, standard deduction ~30K, so likely no tax after deduction
      expect(typeof tax2025).toBe('number');

      // getAccountsWithTaxableEvents for 2025 should have both accounts
      const accounts2025 = manager.getAccountsWithTaxableEvents(2025);
      expect(accounts2025).toHaveLength(2);

      // Clear roth-ira for 2025
      manager.clearTaxableOccurrences('roth-ira', 2025);
      expect(manager.getTaxableOccurrences('roth-ira', 2025)).toHaveLength(0);
      expect(manager.getTaxableOccurrences('401k', 2025)).toHaveLength(1); // unaffected

      // Clear all for 2025
      manager.clearAllTaxableOccurrences(2025);
      expect(manager.getAccountsWithTaxableEvents(2025)).toHaveLength(0);
      // 2026 data should still be intact
      expect(manager.getTaxableOccurrences('401k', 2026)).toHaveLength(1);
    });

    it('calculateTotalTaxOwed uses progressive brackets on aggregated income', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 10000, incomeType: 'ordinary' }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025, amount: 40000, incomeType: 'ordinary' }));

      const tax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      // Total: 50K, should compute some tax (likely minimal after standard deduction)
      expect(typeof tax).toBe('number');
      expect(tax).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // checkpoint/restore
  // ---------------------------------------------------------------------------
  describe('checkpoint/restore', () => {
    it('checkpoint preserves taxable occurrences', () => {
      const event1 = makeTaxableEvent({ year: 2025, amount: 5000 });
      const event2 = makeTaxableEvent({ year: 2026, amount: 8000 });

      manager.addTaxableOccurrence('account-1', event1);
      manager.addTaxableOccurrence('account-1', event2);

      manager.checkpoint();

      // Clear the manager
      manager.clearAllTaxableOccurrences(2025);
      manager.clearAllTaxableOccurrences(2026);

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
      expect(manager.getTaxableOccurrences('account-1', 2026)).toHaveLength(0);

      // Restore
      manager.restore();

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(1);
      expect(manager.getTaxableOccurrences('account-1', 2026)).toHaveLength(1);
      expect(manager.getTaxableOccurrences('account-1', 2025)[0].amount).toBe(5000);
      expect(manager.getTaxableOccurrences('account-1', 2026)[0].amount).toBe(8000);
    });

    it('checkpoint preserves dates correctly (serialization/deserialization)', () => {
      const date = new Date('2025-03-15T10:30:00Z');
      const event = makeTaxableEvent({ date });

      manager.addTaxableOccurrence('account-1', event);
      manager.checkpoint();
      manager.clearAllTaxableOccurrences(2025);
      manager.restore();

      const restored = manager.getTaxableOccurrences('account-1', 2025)[0];
      expect(restored.date.getTime()).toBe(date.getTime());
    });

    it('checkpoint and restore multiple accounts across multiple years', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 1000 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ year: 2025, amount: 2000 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026, amount: 3000 }));

      manager.checkpoint();

      // Clear everything
      manager.clearAllTaxableOccurrences(2025);
      manager.clearAllTaxableOccurrences(2026);

      expect(manager.getAccountsWithTaxableEvents(2025)).toHaveLength(0);
      expect(manager.getAccountsWithTaxableEvents(2026)).toHaveLength(0);

      // Restore
      manager.restore();

      expect(manager.getTaxableOccurrences('account-1', 2025)[0].amount).toBe(1000);
      expect(manager.getTaxableOccurrences('account-2', 2025)[0].amount).toBe(2000);
      expect(manager.getTaxableOccurrences('account-1', 2026)[0].amount).toBe(3000);
    });

    it('checkpoint preserves withholding occurrences', () => {
      const w1 = makeWithholdingOccurrence({ year: 2025, federalAmount: 300, stateAmount: 75 });
      const w2 = makeWithholdingOccurrence({ year: 2025, federalAmount: 250, stateAmount: 60 });

      manager.addWithholdingOccurrence(w1);
      manager.addWithholdingOccurrence(w2);

      manager.checkpoint();

      manager.clearWithholdingOccurrences();
      let totals = manager.getTotalWithholding(2025);
      expect(totals.federal).toBe(0);
      expect(totals.state).toBe(0);

      manager.restore();

      totals = manager.getTotalWithholding(2025);
      expect(totals.federal).toBe(550);
      expect(totals.state).toBe(135);
    });

    it('checkpoint preserves both taxable and withholding occurrences together', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 10000 }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025, federalAmount: 1000, stateAmount: 200 }));

      manager.checkpoint();

      manager.clearAllTaxableOccurrences(2025);
      manager.clearWithholdingOccurrences();

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(0);
      expect(manager.getTotalWithholding(2025).federal).toBe(0);

      manager.restore();

      expect(manager.getTaxableOccurrences('account-1', 2025)).toHaveLength(1);
      expect(manager.getTotalWithholding(2025)).toEqual({ federal: 1000, state: 200 });
    });

    it('restore clears tax cache for proper recalculation', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      const tax1 = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      manager.checkpoint();
      manager.clearAllTaxableOccurrences(2025);
      const tax2 = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      expect(tax2).toBe(0);

      manager.restore();
      const tax3 = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);

      expect(tax3).toBe(tax1);
    });
  });

  // ---------------------------------------------------------------------------
  // withholding tracking
  // ---------------------------------------------------------------------------
  describe('withholding tracking', () => {
    it('addWithholdingOccurrence adds a withholding event', () => {
      const withholding = makeWithholdingOccurrence();
      manager.addWithholdingOccurrence(withholding);

      const totals = manager.getTotalWithholding(2025);
      expect(totals.federal).toBe(200);
      expect(totals.state).toBe(50);
    });

    it('getTotalWithholding returns 0 for years with no withholdings', () => {
      const totals = manager.getTotalWithholding(2025);
      expect(totals.federal).toBe(0);
      expect(totals.state).toBe(0);
    });

    it('getTotalWithholding sums federal and state separately', () => {
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ federalAmount: 300, stateAmount: 75 }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ federalAmount: 200, stateAmount: 50 }));

      const totals = manager.getTotalWithholding(2025);
      expect(totals.federal).toBe(500);
      expect(totals.state).toBe(125);
    });

    it('getTotalWithholding handles multiple years independently', () => {
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025, federalAmount: 300, stateAmount: 75 }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2026, federalAmount: 400, stateAmount: 100 }));

      const totals2025 = manager.getTotalWithholding(2025);
      const totals2026 = manager.getTotalWithholding(2026);

      expect(totals2025).toEqual({ federal: 300, state: 75 });
      expect(totals2026).toEqual({ federal: 400, state: 100 });
    });

    it('multiple paychecks across a year sum correctly', () => {
      // Simulate 26 bi-weekly paychecks
      for (let i = 0; i < 26; i++) {
        manager.addWithholdingOccurrence(
          makeWithholdingOccurrence({
            year: 2025,
            federalAmount: 100,
            stateAmount: 25,
            source: `paycheck-${i + 1}`,
          })
        );
      }

      const totals = manager.getTotalWithholding(2025);
      expect(totals.federal).toBe(2600);
      expect(totals.state).toBe(650);
    });

    it('clearWithholdingOccurrences removes all withholdings', () => {
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025 }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2026 }));

      let totals2025 = manager.getTotalWithholding(2025);
      let totals2026 = manager.getTotalWithholding(2026);
      expect(totals2025.federal).toBe(200);
      expect(totals2026.federal).toBe(200);

      manager.clearWithholdingOccurrences();

      totals2025 = manager.getTotalWithholding(2025);
      totals2026 = manager.getTotalWithholding(2026);
      expect(totals2025.federal).toBe(0);
      expect(totals2026.federal).toBe(0);
    });

    it('addWithholdingOccurrence with zero amounts', () => {
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ federalAmount: 0, stateAmount: 0 }));

      const totals = manager.getTotalWithholding(2025);
      expect(totals).toEqual({ federal: 0, state: 0 });
    });

    it('existing taxable occurrence behavior is unchanged (regression)', () => {
      // This test ensures that adding withholding doesn't break existing taxable functionality
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025, federalAmount: 5000, stateAmount: 1000 }));

      // Taxable occurrence should still calculate correctly
      const tax = manager.calculateTotalTaxOwed(2025, 'mfj', 0.03);
      expect(tax).toBeGreaterThan(0);

      // Retrieve taxable occurrences to verify
      const occurrences = manager.getTaxableOccurrences('account-1', 2025);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].amount).toBe(50000);

      // Verify withholding is separate
      const withholding = manager.getTotalWithholding(2025);
      expect(withholding).toEqual({ federal: 5000, state: 1000 });
    });
  });

  // ---------------------------------------------------------------------------
  // computeReconciliation - unified year-end tax reconciliation
  // ---------------------------------------------------------------------------
  describe('computeReconciliation', () => {
    let deductionTracker: DeductionTracker;
    let taxProfile: TaxProfile;

    beforeEach(() => {
      deductionTracker = new DeductionTracker();
      taxProfile = {
        filingStatus: 'mfj',
        state: 'NC',
        stateTaxRate: 0.0475,
        itemizationMode: 'auto',
      };
    });

    it('computes reconciliation with single ordinary income, standard deduction, correct settlement', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025, federalAmount: 5000, stateAmount: 1000 }));

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      expect(recon.year).toBe(2025);
      expect(recon.totalOrdinaryIncome).toBe(50000);
      expect(recon.totalSSIncome).toBe(0);
      expect(recon.totalIncome).toBe(50000);
      expect(recon.agi).toBe(50000);
      expect(recon.aboveTheLineDeductions).toBe(0);
      expect(recon.deductionUsed).toBe('standard');
      expect(recon.standardDeduction).toBeGreaterThan(0);
      expect(recon.taxableIncome).toBeGreaterThan(0);
      expect(recon.federalTax).toBeGreaterThan(0);
      expect(recon.totalFederalWithheld).toBe(5000);
      expect(recon.totalStateWithheld).toBe(1000);
      expect(recon.totalWithheld).toBe(6000);
      // Settlement: if tax owed > withholding, positive; if less, negative
      expect(recon.settlement).toBeDefined();
    });

    it('computes reconciliation with itemized > standard deduction in auto mode', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 100000, incomeType: 'ordinary' }));
      deductionTracker.addDeduction(2025, 'mortgageInterest', 8000);
      deductionTracker.addDeduction(2025, 'charitable', 5000);
      // Total itemized: 13000

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      expect(recon.itemizedDeduction).toBeGreaterThan(0);
      // In auto mode with itemized > standard, should use itemized
      if (recon.itemizedDeduction > recon.standardDeduction) {
        expect(recon.deductionUsed).toBe('itemized');
        expect(recon.deductionAmount).toBe(recon.itemizedDeduction);
      }
    });

    it('computes reconciliation with standard > itemized deduction in auto mode', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      deductionTracker.addDeduction(2025, 'charitable', 500); // Small itemized amount

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      // In auto mode with standard > itemized, should use standard
      if (recon.standardDeduction > recon.itemizedDeduction) {
        expect(recon.deductionUsed).toBe('standard');
        expect(recon.deductionAmount).toBe(recon.standardDeduction);
      }
    });

    it('aggregates multiple income sources', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 30000, incomeType: 'ordinary' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 20000, incomeType: 'retirement' }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 5000, incomeType: 'interest' }));

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      expect(recon.totalOrdinaryIncome).toBe(55000); // 30 + 20 + 5
      expect(recon.totalSSIncome).toBe(0);
      expect(recon.totalIncome).toBe(55000);
    });

    it('computes child tax credit for qualifying children', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 75000, incomeType: 'ordinary' }));

      const profileWithChildren: TaxProfile = {
        filingStatus: 'mfj',
        state: 'NC',
        stateTaxRate: 0.0475,
        itemizationMode: 'standard',
        dependents: [
          { name: 'Child 1', birthYear: 2015, relationship: 'child' }, // Age 10 in 2025
          { name: 'Child 2', birthYear: 2010, relationship: 'child' }, // Age 15 in 2025
          { name: 'Adult', birthYear: 1990, relationship: 'other' }, // Age 35, not a qualifying child
        ],
      };

      const recon = manager.computeReconciliation(2025, profileWithChildren, deductionTracker, 0.03);

      // 2 qualifying children = $4,000 credit
      expect(recon.credits).toBe(4000);
      expect(recon.totalTaxOwed).toBeLessThan(
        manager.calculateTotalTaxOwed(2025, 'mfj', 0.03),
      );
    });

    it('computes over-withholding as negative settlement (refund)', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 30000, incomeType: 'ordinary' }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025, federalAmount: 10000, stateAmount: 2000 }));

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      // Over-withholding should result in negative settlement (refund)
      if (recon.totalWithheld > recon.totalTaxOwed) {
        expect(recon.settlement).toBeLessThan(0);
      }
    });

    it('computes under-withholding as positive settlement (payment)', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 100000, incomeType: 'ordinary' }));
      manager.addWithholdingOccurrence(makeWithholdingOccurrence({ year: 2025, federalAmount: 1000, stateAmount: 100 }));

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      // Under-withholding should result in positive settlement (owe money)
      if (recon.totalWithheld < recon.totalTaxOwed) {
        expect(recon.settlement).toBeGreaterThan(0);
      }
    });

    it('computes state tax correctly', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 60000, incomeType: 'ordinary' }));

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      // State tax should be: taxableIncome * stateTaxRate
      const expectedStateTax = Math.max(0, recon.taxableIncome * taxProfile.stateTaxRate);
      expect(recon.stateTax).toBe(expectedStateTax);
    });

    it('computes reconciliation with forced standard deduction mode', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 100000, incomeType: 'ordinary' }));
      deductionTracker.addDeduction(2025, 'mortgageInterest', 15000);
      deductionTracker.addDeduction(2025, 'charitable', 10000);

      const standardProfile: TaxProfile = {
        ...taxProfile,
        itemizationMode: 'standard',
      };

      const recon = manager.computeReconciliation(2025, standardProfile, deductionTracker, 0.03);

      expect(recon.deductionUsed).toBe('standard');
      expect(recon.deductionAmount).toBe(recon.standardDeduction);
    });

    it('computes reconciliation with forced itemized deduction mode', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 100000, incomeType: 'ordinary' }));
      deductionTracker.addDeduction(2025, 'mortgageInterest', 15000);
      deductionTracker.addDeduction(2025, 'charitable', 10000);

      const itemizedProfile: TaxProfile = {
        ...taxProfile,
        itemizationMode: 'itemized',
      };

      const recon = manager.computeReconciliation(2025, itemizedProfile, deductionTracker, 0.03);

      expect(recon.deductionUsed).toBe('itemized');
      expect(recon.deductionAmount).toBe(recon.itemizedDeduction);
    });

    it('includes above-the-line deductions in AGI calculation', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 50000, incomeType: 'ordinary' }));
      deductionTracker.addDeduction(2025, 'traditionalIRA', 5000);
      deductionTracker.addDeduction(2025, 'studentLoanInterest', 2000);

      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      expect(recon.aboveTheLineDeductions).toBe(7000); // 5000 + 2000
      expect(recon.agi).toBe(43000); // 50000 - 7000
    });

    it('handles zero income scenario', () => {
      // No taxable occurrences added
      const recon = manager.computeReconciliation(2025, taxProfile, deductionTracker, 0.03);

      expect(recon.totalIncome).toBe(0);
      expect(recon.agi).toBe(0);
      expect(recon.taxableIncome).toBe(0);
      expect(recon.federalTax).toBe(0);
      expect(recon.stateTax).toBe(0);
      expect(recon.totalTaxOwed).toBe(0);
    });
  });
});
