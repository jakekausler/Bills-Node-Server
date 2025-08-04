/**
 * Test suite for balance tracking in calculate-v2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BalanceTracker } from './balance-tracker';
import { BalanceSnapshot, InterestState } from './types';
import { Account } from '../../data/account/account';

describe('BalanceTracker', () => {
  let balanceTracker: BalanceTracker;

  const mockAccount1 = {
    id: 'acc1',
    name: 'Checking',
    balance: 1000,
  } as Account;

  const mockAccount2 = {
    id: 'acc2',
    name: 'Savings',
    balance: 2000,
  } as Account;

  beforeEach(() => {
    balanceTracker = new BalanceTracker();
  });

  describe('Balance initialization', () => {
    it('should initialize balances from accounts', () => {
      balanceTracker.initializeFromAccounts([mockAccount1, mockAccount2]);

      expect(balanceTracker.getBalance('acc1')).toBe(1000);
      expect(balanceTracker.getBalance('acc2')).toBe(2000);
    });

    it('should handle accounts without balance property', () => {
      const accountWithoutBalance = { id: 'acc3', name: 'Test' } as Account;

      balanceTracker.initializeFromAccounts([accountWithoutBalance]);

      expect(balanceTracker.getBalance('acc3')).toBe(0);
    });
  });

  describe('Balance operations', () => {
    beforeEach(() => {
      balanceTracker.initializeFromAccounts([mockAccount1, mockAccount2]);
    });

    it('should update balances correctly', () => {
      balanceTracker.setBalance('acc1', 1500);
      balanceTracker.setBalance('acc2', 2500);

      expect(balanceTracker.getBalance('acc1')).toBe(1500);
      expect(balanceTracker.getBalance('acc2')).toBe(2500);
    });

    it('should handle balance adjustments', () => {
      balanceTracker.adjustBalance('acc1', 500); // Add 500
      balanceTracker.adjustBalance('acc2', -300); // Subtract 300

      expect(balanceTracker.getBalance('acc1')).toBe(1500);
      expect(balanceTracker.getBalance('acc2')).toBe(1700);
    });

    it('should get all balances', () => {
      const allBalances = balanceTracker.getAllBalances();

      expect(allBalances).toEqual({
        acc1: 1000,
        acc2: 2000,
      });
    });

    it('should handle non-existent account IDs', () => {
      expect(balanceTracker.getBalance('non-existent')).toBe(0);
    });
  });

  describe('Interest state management', () => {
    beforeEach(() => {
      balanceTracker.initializeFromAccounts([mockAccount1]);
    });

    it('should track interest states', () => {
      const interestState: InterestState = {
        currentInterest: null,
        interestIndex: 0,
        nextInterestDate: new Date('2024-02-01'),
        accumulatedTaxableInterest: 100,
      };

      balanceTracker.setInterestState('acc1', interestState);

      const retrieved = balanceTracker.getInterestState('acc1');
      expect(retrieved).toEqual(interestState);
    });

    it('should return default interest state for new accounts', () => {
      const defaultState = balanceTracker.getInterestState('acc1');

      expect(defaultState.interestIndex).toBe(0);
      expect(defaultState.accumulatedTaxableInterest).toBe(0);
      expect(defaultState.currentInterest).toBeNull();
      expect(defaultState.nextInterestDate).toBeNull();
    });
  });

  describe('Activity index tracking', () => {
    beforeEach(() => {
      balanceTracker.initializeFromAccounts([mockAccount1]);
    });

    it('should track activity indices', () => {
      balanceTracker.setActivityIndex('acc1', 5);

      expect(balanceTracker.getActivityIndex('acc1')).toBe(5);
    });

    it('should increment activity indices', () => {
      balanceTracker.setActivityIndex('acc1', 3);
      balanceTracker.incrementActivityIndex('acc1');

      expect(balanceTracker.getActivityIndex('acc1')).toBe(4);
    });

    it('should return 0 for untracked account activity indices', () => {
      expect(balanceTracker.getActivityIndex('untracked')).toBe(0);
    });
  });

  describe('Snapshot creation and restoration', () => {
    beforeEach(() => {
      balanceTracker.initializeFromAccounts([mockAccount1, mockAccount2]);

      // Set up some state
      balanceTracker.setBalance('acc1', 1500);
      balanceTracker.setActivityIndex('acc1', 3);

      const interestState: InterestState = {
        currentInterest: null,
        interestIndex: 1,
        nextInterestDate: new Date('2024-02-01'),
        accumulatedTaxableInterest: 50,
      };
      balanceTracker.setInterestState('acc1', interestState);
    });

    it('should create snapshots correctly', () => {
      const snapshot = balanceTracker.createSnapshot(new Date('2024-01-15'), 'test-hash');

      expect(snapshot.date).toEqual(new Date('2024-01-15'));
      expect(snapshot.dataHash).toBe('test-hash');
      expect(snapshot.balances.acc1).toBe(1500);
      expect(snapshot.balances.acc2).toBe(2000);
      expect(snapshot.activityIndices.acc1).toBe(3);
      expect(snapshot.interestStates.acc1.interestIndex).toBe(1);
      expect(snapshot.interestStates.acc1.accumulatedTaxableInterest).toBe(50);
    });

    it('should restore from snapshots correctly', () => {
      const snapshot: BalanceSnapshot = {
        date: new Date('2024-01-10'),
        balances: { acc1: 800, acc2: 1800 },
        activityIndices: { acc1: 2, acc2: 1 },
        interestStates: {
          acc1: {
            currentInterest: null,
            interestIndex: 0,
            nextInterestDate: new Date('2024-02-01'),
            accumulatedTaxableInterest: 25,
          },
        },
        dataHash: 'restore-hash',
        processedEventIds: new Set(['event1', 'event2']),
      };

      balanceTracker.restoreFromSnapshot(snapshot);

      expect(balanceTracker.getBalance('acc1')).toBe(800);
      expect(balanceTracker.getBalance('acc2')).toBe(1800);
      expect(balanceTracker.getActivityIndex('acc1')).toBe(2);
      expect(balanceTracker.getActivityIndex('acc2')).toBe(1);
      expect(balanceTracker.getInterestState('acc1').accumulatedTaxableInterest).toBe(25);
    });
  });

  describe('Event processing tracking', () => {
    it('should track processed events', () => {
      balanceTracker.markEventProcessed('event1');
      balanceTracker.markEventProcessed('event2');

      expect(balanceTracker.isEventProcessed('event1')).toBe(true);
      expect(balanceTracker.isEventProcessed('event2')).toBe(true);
      expect(balanceTracker.isEventProcessed('event3')).toBe(false);
    });

    it('should include processed events in snapshots', () => {
      balanceTracker.markEventProcessed('event1');
      balanceTracker.markEventProcessed('event2');

      const snapshot = balanceTracker.createSnapshot(new Date(), 'hash');

      expect(snapshot.processedEventIds.has('event1')).toBe(true);
      expect(snapshot.processedEventIds.has('event2')).toBe(true);
    });

    it('should restore processed events from snapshots', () => {
      const snapshot: BalanceSnapshot = {
        date: new Date(),
        balances: {},
        activityIndices: {},
        interestStates: {},
        dataHash: 'hash',
        processedEventIds: new Set(['restored1', 'restored2']),
      };

      balanceTracker.restoreFromSnapshot(snapshot);

      expect(balanceTracker.isEventProcessed('restored1')).toBe(true);
      expect(balanceTracker.isEventProcessed('restored2')).toBe(true);
    });
  });

  describe('Validation and error handling', () => {
    it('should validate snapshot data integrity', () => {
      balanceTracker.initializeFromAccounts([mockAccount1]);

      const validSnapshot: BalanceSnapshot = {
        date: new Date(),
        balances: { acc1: 1000 },
        activityIndices: { acc1: 0 },
        interestStates: {},
        dataHash: 'valid-hash',
        processedEventIds: new Set(),
      };

      expect(() => balanceTracker.restoreFromSnapshot(validSnapshot)).not.toThrow();
    });

    it('should handle missing account data gracefully', () => {
      const snapshot: BalanceSnapshot = {
        date: new Date(),
        balances: { nonexistent: 1000 },
        activityIndices: { nonexistent: 0 },
        interestStates: {},
        dataHash: 'hash',
        processedEventIds: new Set(),
      };

      expect(() => balanceTracker.restoreFromSnapshot(snapshot)).not.toThrow();
      expect(balanceTracker.getBalance('nonexistent')).toBe(1000);
    });
  });

  describe('Performance considerations', () => {
    it('should handle large numbers of accounts efficiently', () => {
      const manyAccounts: Account[] = [];
      for (let i = 0; i < 1000; i++) {
        manyAccounts.push({
          id: `acc${i}`,
          name: `Account ${i}`,
          balance: i * 100,
        } as Account);
      }

      const startTime = Date.now();
      balanceTracker.initializeFromAccounts(manyAccounts);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
      expect(balanceTracker.getBalance('acc999')).toBe(99900);
    });

    it('should handle frequent balance updates efficiently', () => {
      balanceTracker.initializeFromAccounts([mockAccount1]);

      const startTime = Date.now();
      for (let i = 0; i < 10000; i++) {
        balanceTracker.adjustBalance('acc1', 1);
      }
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
      expect(balanceTracker.getBalance('acc1')).toBe(11000);
    });
  });
});
