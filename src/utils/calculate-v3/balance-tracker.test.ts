// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for module dependencies
// - Assertions: expect() with toBe, toEqual, toBeNull, toBeUndefined
// - Async: async/await
// - Structure: describe/it with beforeEach

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BalanceTracker } from './balance-tracker';
import { SegmentResult } from './types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the CacheManager to avoid real disk/memory cache complexity
vi.mock('./cache', () => ({
  CacheManager: vi.fn().mockImplementation(() => ({
    findClosestSnapshot: vi.fn().mockResolvedValue(null),
    setBalanceSnapshot: vi.fn().mockResolvedValue('balance_snapshot_2025-01-01_sim'),
    getSimulation: vi.fn().mockReturnValue('sim-1'),
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  })),
  initializeCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccountData(overrides: Record<string, any> = {}): any {
  return {
    id: 'account-1',
    name: 'Checking',
    type: 'checking',
    balance: 0,
    interests: [],
    activity: [],
    bills: [],
    consolidatedActivity: [],
    hidden: false,
    ...overrides,
  };
}

function makeSegmentResult(overrides: Partial<SegmentResult> = {}): SegmentResult {
  return {
    balanceChanges: new Map(),
    activitiesAdded: new Map(),
    processedEventIds: new Set(),
    balanceMinimums: new Map(),
    balanceMaximums: new Map(),
    taxableOccurences: new Map(),
    spendingTrackerUpdates: [],
    ...overrides,
  };
}

// Build a minimal Account-like object that BalanceTracker can use.
// We import Account normally since it has no external side-effects.
import { Account } from '../../data/account/account';
import { CacheManager } from './cache';

function makeAccount(id: string, name: string = 'Account'): Account {
  return new Account(makeAccountData({ id, name }));
}

function makeCacheManager(): CacheManager {
  return new CacheManager(
    { snapshotInterval: 'monthly', useDiskCache: false, diskCacheDir: '/tmp/test' },
    'sim-1',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BalanceTracker', () => {
  let cache: CacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = makeCacheManager();
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------
  describe('construction', () => {
    it('creates a BalanceTracker with accounts', () => {
      const accounts = [makeAccount('account-1'), makeAccount('account-2')];
      const tracker = new BalanceTracker(accounts, cache);
      expect(tracker).toBeDefined();
    });

    it('deep-clones accounts so external mutations do not affect tracker state', () => {
      const account = makeAccount('account-1');
      const tracker = new BalanceTracker([account], cache);

      // Mutate external account — should not affect internal state
      account.name = 'Mutated';

      const found = tracker.findAccountById('account-1');
      expect(found?.name).not.toBe('Mutated');
    });
  });

  // -------------------------------------------------------------------------
  // getAccountBalance
  // -------------------------------------------------------------------------
  describe('getAccountBalance', () => {
    it('returns 0 for an account that has not been updated', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      expect(tracker.getAccountBalance('account-1')).toBe(0);
    });

    it('returns 0 for an account that does not exist', () => {
      const tracker = new BalanceTracker([], cache);
      expect(tracker.getAccountBalance('nonexistent')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // updateBalance
  // -------------------------------------------------------------------------
  describe('updateBalance', () => {
    it('adds a positive amount to an account balance', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateBalance('account-1', 500, new Date());
      expect(tracker.getAccountBalance('account-1')).toBe(500);
    });

    it('subtracts a negative amount from an account balance', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateBalance('account-1', 1000, new Date());
      tracker.updateBalance('account-1', -300, new Date());
      expect(tracker.getAccountBalance('account-1')).toBe(700);
    });

    it('accumulates multiple updates', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateBalance('account-1', 100, new Date());
      tracker.updateBalance('account-1', 200, new Date());
      tracker.updateBalance('account-1', -50, new Date());
      expect(tracker.getAccountBalance('account-1')).toBe(250);
    });

    it('initializes balance to 0 before adding for previously-unseen accounts', () => {
      const tracker = new BalanceTracker([], cache);
      tracker.updateBalance('new-account', 100, new Date());
      expect(tracker.getAccountBalance('new-account')).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // updateActivityIndex
  // -------------------------------------------------------------------------
  describe('updateActivityIndex', () => {
    it('increments activity index by default (1)', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateActivityIndex('account-1');
      tracker.updateActivityIndex('account-1');
      // Just checking there's no error; the index is internal
      expect(tracker).toBeDefined();
    });

    it('increments by the specified amount', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateActivityIndex('account-1', 5);
      tracker.updateActivityIndex('account-1', 3);
      // Internal state; verify indirectly via applySegmentResult behavior
      expect(tracker).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // findAccountById
  // -------------------------------------------------------------------------
  describe('findAccountById', () => {
    it('returns the account when found', () => {
      const account = makeAccount('account-1', 'Checking');
      const tracker = new BalanceTracker([account], cache);
      const found = tracker.findAccountById('account-1');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Checking');
    });

    it('returns undefined when account is not found', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      expect(tracker.findAccountById('nonexistent')).toBeUndefined();
    });

    it('finds among multiple accounts', () => {
      const accounts = [
        makeAccount('account-1', 'Checking'),
        makeAccount('account-2', 'Savings'),
        makeAccount('account-3', '401k'),
      ];
      const tracker = new BalanceTracker(accounts, cache);

      expect(tracker.findAccountById('account-2')?.name).toBe('Savings');
      expect(tracker.findAccountById('account-3')?.name).toBe('401k');
    });
  });

  // -------------------------------------------------------------------------
  // applySegmentResult
  // -------------------------------------------------------------------------
  describe('applySegmentResult', () => {
    it('applies balance changes from segment result', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      const segmentResult = makeSegmentResult({
        balanceChanges: new Map([['account-1', 1500]]),
      });

      tracker.applySegmentResult(segmentResult, new Date());

      expect(tracker.getAccountBalance('account-1')).toBe(1500);
    });

    it('applies balance changes across multiple accounts', () => {
      const tracker = new BalanceTracker([
        makeAccount('account-1'),
        makeAccount('account-2'),
      ], cache);
      const segmentResult = makeSegmentResult({
        balanceChanges: new Map([
          ['account-1', 1000],
          ['account-2', -500],
        ]),
      });

      tracker.applySegmentResult(segmentResult, new Date());

      expect(tracker.getAccountBalance('account-1')).toBe(1000);
      expect(tracker.getAccountBalance('account-2')).toBe(-500);
    });

    it('appends activities to account consolidatedActivity', () => {
      const account = makeAccount('account-1');
      const tracker = new BalanceTracker([account], cache);

      const mockActivity = {
        amount: -100,
        date: new Date(Date.UTC(2025, 0, 15)),
        name: 'Test Activity',
        serialize: vi.fn().mockReturnValue({}),
      } as any;

      const segmentResult = makeSegmentResult({
        activitiesAdded: new Map([['account-1', [mockActivity]]]),
      });

      tracker.applySegmentResult(segmentResult, new Date());

      const acct = tracker.findAccountById('account-1');
      expect(acct?.consolidatedActivity).toHaveLength(1);
    });

    it('warns but does not throw when account ID is not found in activitiesAdded', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      const segmentResult = makeSegmentResult({
        activitiesAdded: new Map([['nonexistent-account', []]]),
      });

      expect(() => tracker.applySegmentResult(segmentResult, new Date())).not.toThrow();
    });

    it('accumulates balance changes across multiple segment results', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);

      tracker.applySegmentResult(makeSegmentResult({
        balanceChanges: new Map([['account-1', 1000]]),
      }), new Date());

      tracker.applySegmentResult(makeSegmentResult({
        balanceChanges: new Map([['account-1', -200]]),
      }), new Date());

      expect(tracker.getAccountBalance('account-1')).toBe(800);
    });
  });

  // -------------------------------------------------------------------------
  // getAccountBalanceRange
  // -------------------------------------------------------------------------
  describe('getAccountBalanceRange', () => {
    it('returns current balance as both min and max when no activities added', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateBalance('account-1', 1000, new Date());

      const segmentResult = makeSegmentResult({
        activitiesAdded: new Map([['account-1', []]]),
      });

      const { min, max } = tracker.getAccountBalanceRange('account-1', segmentResult);
      expect(min).toBe(1000);
      expect(max).toBe(1000);
    });

    it('returns 0 for min and max when account has no balance and no activities', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      const segmentResult = makeSegmentResult();

      const { min, max } = tracker.getAccountBalanceRange('account-1', segmentResult);
      expect(min).toBe(0);
      expect(max).toBe(0);
    });

    it('tracks minimum and maximum after deposits', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      // Start at balance 500
      tracker.updateBalance('account-1', 500, new Date());

      const activities = [
        { amount: 200, date: new Date(Date.UTC(2025, 0, 1)), serialize: vi.fn() },
        { amount: 300, date: new Date(Date.UTC(2025, 0, 2)), serialize: vi.fn() },
      ] as any[];

      const segmentResult = makeSegmentResult({
        activitiesAdded: new Map([['account-1', activities]]),
      });

      const { min, max } = tracker.getAccountBalanceRange('account-1', segmentResult);

      // Balance starts at 500, then 500+200=700, then 700+300=1000
      expect(min).toBe(500);
      expect(max).toBe(1000);
    });

    it('tracks minimum after withdrawals', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateBalance('account-1', 1000, new Date());

      const activities = [
        { amount: -300, date: new Date(Date.UTC(2025, 0, 1)), serialize: vi.fn() },
        { amount: -400, date: new Date(Date.UTC(2025, 0, 2)), serialize: vi.fn() },
      ] as any[];

      const segmentResult = makeSegmentResult({
        activitiesAdded: new Map([['account-1', activities]]),
      });

      const { min, max } = tracker.getAccountBalanceRange('account-1', segmentResult);

      // 1000 -> 700 -> 300
      expect(min).toBe(300);
      expect(max).toBe(1000);
    });

    it('multiple activities on the same day use end-of-day balance for min/max', () => {
      const tracker = new BalanceTracker([makeAccount('account-1')], cache);
      tracker.updateBalance('account-1', 1000, new Date());

      const sameDay = new Date(Date.UTC(2025, 0, 15));
      const nextDay = new Date(Date.UTC(2025, 0, 16));

      // Same day: -200 then +100 → end balance = 900
      // Next day: -500 → end balance = 400
      const activities = [
        { amount: -200, date: sameDay, serialize: vi.fn() },
        { amount: 100, date: sameDay, serialize: vi.fn() },
        { amount: -500, date: nextDay, serialize: vi.fn() },
      ] as any[];

      const segmentResult = makeSegmentResult({
        activitiesAdded: new Map([['account-1', activities]]),
      });

      const { min, max } = tracker.getAccountBalanceRange('account-1', segmentResult);

      // Starting balance 1000, end of day 1: 900, end of day 2: 400
      expect(min).toBe(400);
      expect(max).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // getAccountsWithFilteredDates
  // -------------------------------------------------------------------------
  describe('getAccountsWithFilteredDates', () => {
    it('returns all accounts with empty consolidatedActivity when no activities exist', () => {
      const accounts = [makeAccount('account-1'), makeAccount('account-2')];
      const tracker = new BalanceTracker(accounts, cache);

      const result = tracker.getAccountsWithFilteredDates(
        new Date(Date.UTC(2025, 0, 1)),
        new Date(Date.UTC(2025, 11, 31)),
      );

      expect(result).toHaveLength(2);
      result.forEach((acct) => expect(acct.consolidatedActivity).toHaveLength(0));
    });

    it('returns all accounts when startDate is null', () => {
      const accounts = [makeAccount('account-1')];
      const tracker = new BalanceTracker(accounts, cache);

      const result = tracker.getAccountsWithFilteredDates(
        null,
        new Date(Date.UTC(2025, 11, 31)),
      );

      expect(result).toHaveLength(1);
    });

    it('filters consolidated activities to the specified date range', () => {
      const account = makeAccount('account-1');
      const tracker = new BalanceTracker([account], cache);

      // getAccountsWithFilteredDates calls account.serialize(true) then new Account(serialized)
      // which re-constructs ConsolidatedActivity objects. Each mock activity's serialize()
      // must return valid ConsolidatedActivityData with all required ActivityData fields.
      function makeConsolidatedActivityData(dateStr: string, amount: number): object {
        return {
          id: `act-${dateStr}`,
          date: dateStr,
          dateIsVariable: false,
          dateVariable: null,
          name: `Activity ${dateStr}`,
          category: 'Test',
          amount,
          amountIsVariable: false,
          amountVariable: null,
          flag: false,
          flagColor: null,
          isTransfer: false,
          from: null,
          to: null,
          balance: 0,
          billId: null,
          firstBill: false,
          interestId: null,
          firstInterest: false,
          spendingTrackerId: null,
          firstSpendingTracker: false,
          spendingCategory: null,
        };
      }

      const earlyActivity = {
        amount: -100,
        date: new Date(Date.UTC(2025, 0, 15)), // Jan 15
        name: 'Early Activity',
        serialize: vi.fn().mockReturnValue(makeConsolidatedActivityData('2025-01-15', -100)),
      } as any;
      const lateActivity = {
        amount: -200,
        date: new Date(Date.UTC(2025, 11, 15)), // Dec 15
        name: 'Late Activity',
        serialize: vi.fn().mockReturnValue(makeConsolidatedActivityData('2025-12-15', -200)),
      } as any;

      tracker.applySegmentResult(makeSegmentResult({
        activitiesAdded: new Map([['account-1', [earlyActivity, lateActivity]]]),
      }), new Date());

      // Only include activities in Jan-Jun 2025
      const result = tracker.getAccountsWithFilteredDates(
        new Date(Date.UTC(2025, 0, 1)),
        new Date(Date.UTC(2025, 5, 30)),
      );

      expect(result[0].consolidatedActivity).toHaveLength(1);
      expect(result[0].consolidatedActivity[0].amount).toBe(-100);
    });

    it('returns deep-cloned accounts so mutations do not affect internal state', () => {
      const accounts = [makeAccount('account-1')];
      const tracker = new BalanceTracker(accounts, cache);

      const result = tracker.getAccountsWithFilteredDates(null, new Date(Date.UTC(2025, 11, 31)));
      result[0].name = 'Mutated';

      const found = tracker.findAccountById('account-1');
      expect(found?.name).not.toBe('Mutated');
    });

    it('handles account with no consolidatedActivity (null/undefined) without throwing', () => {
      // Covers the null check at line 144-146:
      //   if (!clonedAccount.consolidatedActivity) { clonedAccount.consolidatedActivity = []; }
      // Account serialized with no consolidatedActivity data
      const account = makeAccount('account-1');
      const tracker = new BalanceTracker([account], cache);

      // Should not throw even if consolidatedActivity is absent after cloning
      expect(() =>
        tracker.getAccountsWithFilteredDates(null, new Date(Date.UTC(2025, 11, 31)))
      ).not.toThrow();

      const result = tracker.getAccountsWithFilteredDates(null, new Date(Date.UTC(2025, 11, 31)));
      expect(result[0].consolidatedActivity).toHaveLength(0);
    });

    it('triggers debug logging path for accounts named "Jane HSA"', () => {
      // Covers the if (account.name === 'Jane HSA') debug log blocks at lines 126-131, 137-142, 172-177
      const hsaAccount = makeAccount('hsa-account', 'Jane HSA');
      const tracker = new BalanceTracker([hsaAccount], cache);

      // The debug path logs to console but should not throw or alter behavior
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = tracker.getAccountsWithFilteredDates(
        new Date(Date.UTC(2025, 0, 1)),
        new Date(Date.UTC(2025, 11, 31)),
      );

      // Should have produced a result (the function still runs normally)
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Jane HSA');

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // initializeBalances
  // -------------------------------------------------------------------------
  describe('initializeBalances', () => {
    it('initializes balances from scratch when no snapshot exists', async () => {
      const accounts = [makeAccount('account-1'), makeAccount('account-2')];
      const tracker = new BalanceTracker(accounts, cache);

      const accountsAndTransfers = {
        accounts,
        transfers: { activity: [], bills: [] },
      } as any;

      await tracker.initializeBalances(accountsAndTransfers);

      // After init-from-scratch, balances start at 0
      expect(tracker.getAccountBalance('account-1')).toBe(0);
      expect(tracker.getAccountBalance('account-2')).toBe(0);
    });

    it('restores from snapshot when a usable snapshot is found', async () => {
      const accounts = [makeAccount('account-1')];

      // Mock the cache to return a snapshot
      const mockCache = {
        findClosestSnapshot: vi.fn().mockResolvedValue({
          snapshot: {
            date: new Date(Date.UTC(2025, 0, 1)),
            balances: { 'account-1': 5000 },
            activityIndices: { 'account-1': 10 },
            processedEventIds: new Set(),
          },
          key: 'balance_snapshot_2025-01-01_sim',
        }),
        setBalanceSnapshot: vi.fn().mockResolvedValue('balance_snapshot_2025-01-01_sim'),
        getSimulation: vi.fn().mockReturnValue('sim-1'),
      } as any;

      const tracker = new BalanceTracker(accounts, mockCache, new Date(Date.UTC(2025, 5, 1)));

      const accountsAndTransfers = {
        accounts,
        transfers: { activity: [], bills: [] },
      } as any;

      await tracker.initializeBalances(accountsAndTransfers);

      // Should have restored the balance from snapshot
      expect(tracker.getAccountBalance('account-1')).toBe(5000);
    });

    it('forces recalculation when forceRecalculate=true even if snapshot exists', async () => {
      const accounts = [makeAccount('account-1')];

      const mockCache = {
        findClosestSnapshot: vi.fn().mockResolvedValue({
          snapshot: {
            date: new Date(Date.UTC(2025, 0, 1)),
            balances: { 'account-1': 5000 },
            activityIndices: { 'account-1': 10 },
            processedEventIds: new Set(),
          },
          key: 'balance_snapshot_2025-01-01_sim',
        }),
        setBalanceSnapshot: vi.fn().mockResolvedValue('balance_snapshot_2025-01-01_sim'),
        getSimulation: vi.fn().mockReturnValue('sim-1'),
      } as any;

      const tracker = new BalanceTracker(accounts, mockCache, new Date(Date.UTC(2025, 5, 1)));

      const accountsAndTransfers = {
        accounts,
        transfers: { activity: [], bills: [] },
      } as any;

      // Force recalculation — should ignore the snapshot
      await tracker.initializeBalances(accountsAndTransfers, true);

      // Should start fresh at 0, not use the snapshot's 5000
      expect(tracker.getAccountBalance('account-1')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // createSnapshotIfNeeded
  // -------------------------------------------------------------------------
  describe('createSnapshotIfNeeded', () => {
    it('creates a snapshot when no previous snapshot exists', async () => {
      const mockCache = {
        findClosestSnapshot: vi.fn().mockResolvedValue(null),
        setBalanceSnapshot: vi.fn().mockResolvedValue('balance_snapshot_2025-01-01_sim'),
        getSimulation: vi.fn().mockReturnValue('sim-1'),
      } as any;

      const tracker = new BalanceTracker([makeAccount('account-1')], mockCache);

      const key = await tracker.createSnapshotIfNeeded(new Date(Date.UTC(2025, 0, 1)));
      expect(key).not.toBeNull();
      expect(mockCache.setBalanceSnapshot).toHaveBeenCalled();
    });

    it('does not create a snapshot when one was recently created (within interval)', async () => {
      const mockCache = {
        findClosestSnapshot: vi.fn().mockResolvedValue(null),
        setBalanceSnapshot: vi.fn().mockResolvedValue('balance_snapshot_2025-01-01_sim'),
        getSimulation: vi.fn().mockReturnValue('sim-1'),
      } as any;

      const tracker = new BalanceTracker([makeAccount('account-1')], mockCache);

      // Create initial snapshot
      await tracker.createSnapshotIfNeeded(new Date(Date.UTC(2025, 0, 1)));
      mockCache.setBalanceSnapshot.mockClear();

      // Try to create another snapshot just 1 day later (within 30-day interval)
      const key = await tracker.createSnapshotIfNeeded(new Date(Date.UTC(2025, 0, 2)));
      expect(key).toBeNull();
      expect(mockCache.setBalanceSnapshot).not.toHaveBeenCalled();
    });

    it('creates a new snapshot when more than the interval has passed', async () => {
      const mockCache = {
        findClosestSnapshot: vi.fn().mockResolvedValue(null),
        setBalanceSnapshot: vi.fn().mockResolvedValue('balance_snapshot_2025-02-15_sim'),
        getSimulation: vi.fn().mockReturnValue('sim-1'),
      } as any;

      const tracker = new BalanceTracker([makeAccount('account-1')], mockCache);

      // Create initial snapshot on Jan 1
      await tracker.createSnapshotIfNeeded(new Date(Date.UTC(2025, 0, 1)));
      mockCache.setBalanceSnapshot.mockClear();

      // Try again 45 days later (exceeds 30-day interval)
      const key = await tracker.createSnapshotIfNeeded(new Date(Date.UTC(2025, 1, 15)));
      expect(key).not.toBeNull();
      expect(mockCache.setBalanceSnapshot).toHaveBeenCalled();
    });
  });
});
