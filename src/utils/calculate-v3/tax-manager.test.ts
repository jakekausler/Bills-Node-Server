// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Assertions: expect() with toBe, toEqual, toThrow patterns
// - Async: async/await where needed
// - Structure: describe/it with Arrange-Act-Assert

import { describe, it, expect, beforeEach } from 'vitest';
import { TaxManager } from './tax-manager';
import { TaxableOccurrence } from './types';

function makeTaxableEvent(overrides: Partial<TaxableOccurrence> = {}): TaxableOccurrence {
  return {
    date: new Date('2025-06-15'),
    year: 2025,
    amount: 1000,
    taxRate: 0.25,
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
  // calculateTotalTaxOwed
  // ---------------------------------------------------------------------------
  describe('calculateTotalTaxOwed', () => {
    it('returns 0 when no events exist', () => {
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(0);
    });

    it('calculates tax for a single event: amount * taxRate', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 1000, taxRate: 0.25 }));
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(250);
    });

    it('sums tax across multiple events', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 1000, taxRate: 0.25 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 500, taxRate: 0.10 }));

      // 1000 * 0.25 + 500 * 0.10 = 250 + 50 = 300
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBeCloseTo(300, 5);
    });

    it('calculates tax only for the specified year', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2025, amount: 1000, taxRate: 0.25 }));
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ year: 2026, amount: 2000, taxRate: 0.30 }));

      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(250);
      expect(manager.calculateTotalTaxOwed('account-1', 2026)).toBe(600);
    });

    it('calculates tax only for the specified account', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 1000, taxRate: 0.25 }));
      manager.addTaxableOccurrence('account-2', makeTaxableEvent({ amount: 2000, taxRate: 0.30 }));

      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(250);
      expect(manager.calculateTotalTaxOwed('account-2', 2025)).toBe(600);
    });

    it('handles 0% tax rate', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 1000, taxRate: 0 }));
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(0);
    });

    it('handles 100% tax rate', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 500, taxRate: 1.0 }));
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(500);
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

      // After clearing the only account, the year should be gone
      // Verify by checking that getAccountsWithTaxableEvents returns empty
      expect(manager.getAccountsWithTaxableEvents(2025)).toHaveLength(0);
    });

    it('is a no-op when account has no events in the given year', () => {
      // Should not throw
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
      // Set up data for multiple accounts / years
      manager.addTaxableOccurrences('roth-ira', [
        makeTaxableEvent({ year: 2025, amount: 5000, taxRate: 0 }),
        makeTaxableEvent({ year: 2025, amount: 3000, taxRate: 0 }),
      ]);
      manager.addTaxableOccurrences('401k', [
        makeTaxableEvent({ year: 2025, amount: 20000, taxRate: 0.22 }),
        makeTaxableEvent({ year: 2026, amount: 25000, taxRate: 0.24 }),
      ]);

      // Verify per year totals
      expect(manager.calculateTotalTaxOwed('roth-ira', 2025)).toBe(0);
      expect(manager.calculateTotalTaxOwed('401k', 2025)).toBeCloseTo(4400, 5);
      expect(manager.calculateTotalTaxOwed('401k', 2026)).toBe(6000);

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

    it('calculateTotalTaxOwed returns 0 after clearing', () => {
      manager.addTaxableOccurrence('account-1', makeTaxableEvent({ amount: 10000, taxRate: 0.3 }));
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBeCloseTo(3000, 5);

      manager.clearAllTaxableOccurrences(2025);
      expect(manager.calculateTotalTaxOwed('account-1', 2025)).toBe(0);
    });
  });
});
