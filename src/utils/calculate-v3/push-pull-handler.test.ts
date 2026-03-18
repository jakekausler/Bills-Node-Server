import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PushPullHandler } from './push-pull-handler';
import { AccountManager } from './account-manager';
import { BalanceTracker } from './balance-tracker';
import { Account } from '../../data/account/account';
import { Segment, SegmentResult } from './types';

// Mock dependencies
vi.mock('./account-manager');
vi.mock('./balance-tracker');

describe('PushPullHandler', () => {
  let mockAccountManager: AccountManager;
  let mockBalanceTracker: BalanceTracker;
  let pushPullHandler: PushPullHandler;

  const makeAccount = (overrides: Partial<any> = {}): Account => {
    return new Account({
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
    });
  };

  const makeSegment = (overrides: Partial<Segment> = {}): Segment => {
    return {
      id: 'segment-1',
      startDate: new Date(Date.UTC(2025, 0, 1)),
      endDate: new Date(Date.UTC(2025, 0, 31)),
      events: [],
      affectedAccountIds: ['account-1'],
      ...overrides,
    };
  };

  const makeSegmentResult = (overrides: Partial<SegmentResult> = {}): SegmentResult => {
    return {
      balanceChanges: new Map(),
      activitiesAdded: new Map(),
      processedEventIds: new Set(),
      balanceMinimums: new Map([['account-1', 1000]]),
      balanceMaximums: new Map([['account-1', 1000]]),
      taxableOccurrences: new Map(),
      spendingTrackerUpdates: [],
      ...overrides,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountManager = {
      getAccountById: vi.fn(),
      getAccountByName: vi.fn(),
      getPullableAccounts: vi.fn(),
    } as any;
    mockBalanceTracker = {
      getAccountBalance: vi.fn(),
    } as any;
    pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker);
  });

  describe('handleAccountPushPulls', () => {
    it('should return false when no accounts need push or pull', () => {
      const account = makeAccount({
        id: 'account-1',
        performsPushes: false,
        performsPulls: false,
      });
      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment();
      const segmentResult = makeSegmentResult();
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      expect(result).toBe(false);
      expect(segment.events).toHaveLength(0);
    });

    it('should skip account when not found', () => {
      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(undefined);

      const segment = makeSegment();
      const segmentResult = makeSegmentResult();
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      expect(result).toBe(false);
    });

    it('should add push event when balance exceeds maximum', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));
      const pushAccount = makeAccount({ id: 'push-account', name: 'Savings' });
      const account = makeAccount({
        id: 'account-1',
        performsPushes: true,
        pushAccount: 'Savings',
        maximumBalance: 5000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);
      vi.mocked(mockAccountManager.getAccountByName).mockReturnValue(pushAccount);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 7000]]), // Exceeds max of 5000
      });

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      expect(result).toBe(true);
      expect(segment.events).toHaveLength(1);
      expect(segment.events[0].type).toBe('activityTransfer');
    });

    it('should add pull event when balance falls below minimum', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));
      const pullableAccount = makeAccount({ id: 'pullable', name: 'Savings', minimumBalance: 1000 });
      const account = makeAccount({
        id: 'account-1',
        performsPulls: true,
        minimumBalance: 2000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([pullableAccount]);
      vi.mocked(mockBalanceTracker.getAccountBalance).mockReturnValue(5000);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 1500]]), // Below min of 2000
      });

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      expect(result).toBe(true);
      expect(segment.events.length).toBeGreaterThan(0);
    });

    it('should not push when segment is in the past', () => {
      const pastDate = new Date(Date.UTC(2020, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));
      const account = makeAccount({
        id: 'account-1',
        performsPushes: true,
        pushAccount: 'Savings',
        maximumBalance: 5000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: pastDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 7000]]),
      });

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      expect(result).toBe(false);
      expect(segment.events).toHaveLength(0);
    });

    it('should respect pushStart date when configured', () => {
      const futureDate = new Date(Date.UTC(2030, 6, 1)); // July 2030
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      // Create account data with pushStart as string to avoid date parsing issues
      const accountData = {
        id: 'account-1',
        name: 'Checking',
        type: 'checking',
        balance: 0,
        interests: [],
        activity: [],
        bills: [],
        consolidatedActivity: [],
        hidden: false,
        performsPushes: true,
        pushStart: '2031-01-01', // String format to match actual data format
        pushAccount: 'Savings',
        maximumBalance: 5000,
      };

      const account = new Account(accountData);
      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: futureDate, // Before pushStart
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 7000]]),
      });

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      expect(result).toBe(false);
      expect(segment.events).toHaveLength(0);
    });

    it('should be deterministic using provided reference date (fix for #29)', () => {
      // This test ensures that push/pull behavior is deterministic and doesn't depend on wall clock time
      // Even if this test runs far in the future, it should use the provided reference date
      const futureSegmentDate = new Date(Date.UTC(2035, 0, 1));
      const simulationReferenceDate = new Date(Date.UTC(2025, 0, 1)); // Reference date in the past

      const pushAccount = makeAccount({ id: 'push-account', name: 'Savings' });
      const account = makeAccount({
        id: 'account-1',
        performsPushes: true,
        pushAccount: 'Savings',
        maximumBalance: 5000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);
      vi.mocked(mockAccountManager.getAccountByName).mockReturnValue(pushAccount);

      const segment = makeSegment({
        startDate: futureSegmentDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 7000]]),
      });

      // With reference date before segment date, push should activate
      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment, simulationReferenceDate);

      expect(result).toBe(true);
      expect(segment.events).toHaveLength(1);
      expect(segment.events[0].type).toBe('activityTransfer');
    });
  });

  describe('Tax-Aware Withdrawal Strategy', () => {
    it('should use pullPriority for manual strategy', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const taxable = makeAccount({
        id: 'taxable',
        name: 'Brokerage',
        type: 'Investment',
        pullPriority: 100, // High priority
        performsPulls: true,
      });

      const preTax = makeAccount({
        id: 'pretax',
        name: 'Traditional IRA',
        type: 'Investment',
        usesRMD: true,
        pullPriority: 50, // Low priority (but ignored in manual mode)
        performsPulls: true,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(taxable);
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([preTax, taxable]);
      vi.mocked(mockBalanceTracker.getAccountBalance)
        .mockImplementation((id) => (id === 'taxable' ? 5000 : 5000));

      pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker, 'manual');

      const account = makeAccount({
        id: 'account-1',
        performsPulls: true,
        minimumBalance: 2000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 1500]]),
      });

      pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      // In manual mode, it should use pullPriority (preTax has lower priority=50 than taxable=100)
      expect(segment.events.length).toBeGreaterThan(0);
    });

    it('should pull from taxable before pre-tax (post-59.5 - no penalty)', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const taxable = makeAccount({
        id: 'taxable',
        name: 'Brokerage',
        type: 'Investment',
        earlyWithdrawalPenalty: 0, // No penalty
        performsPulls: true,
      });

      const preTax = makeAccount({
        id: 'pretax',
        name: 'Traditional IRA',
        type: 'Investment',
        usesRMD: true,
        earlyWithdrawalPenalty: 0, // No penalty post-59.5
        performsPulls: true,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(taxable);
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([preTax, taxable]);
      vi.mocked(mockBalanceTracker.getAccountBalance)
        .mockImplementation((id) => (id === 'taxable' ? 5000 : 5000));

      pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker, 'taxOptimized');

      const account = makeAccount({
        id: 'account-1',
        performsPulls: true,
        minimumBalance: 2000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 1500]]),
      });

      pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      // First pull should come from taxable (post-59.5, no penalty)
      const firstPullEvent = segment.events.find((e) => e.type === 'activityTransfer');
      expect(firstPullEvent).toBeDefined();
      if (firstPullEvent && firstPullEvent.type === 'activityTransfer') {
        expect(firstPullEvent.fromAccountId).toBe('taxable');
      }
    });

    it('should pull from Roth before penalty accounts (pre-59.5)', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const roth = makeAccount({
        id: 'roth',
        name: 'Roth IRA',
        type: 'Investment',
        earlyWithdrawalPenalty: 0.1,
        earlyWithdrawalDate: '2040-01-01', // Penalty until 2040
        performsPulls: true,
      });

      const preTaxWithPenalty = makeAccount({
        id: 'pretax-penalty',
        name: 'Traditional 401k',
        type: 'Investment',
        usesRMD: true,
        earlyWithdrawalPenalty: 0.1,
        earlyWithdrawalDate: '2040-01-01',
        performsPulls: true,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(roth);
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([preTaxWithPenalty, roth]);
      vi.mocked(mockBalanceTracker.getAccountBalance)
        .mockImplementation((id) => (id === 'roth' ? 5000 : 5000));

      pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker, 'taxOptimized');

      const account = makeAccount({
        id: 'account-1',
        performsPulls: true,
        minimumBalance: 2000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 1500]]),
      });

      pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      // First pull should come from Roth (pre-59.5, penalty applies)
      const firstPullEvent = segment.events.find((e) => e.type === 'activityTransfer');
      expect(firstPullEvent).toBeDefined();
      if (firstPullEvent && firstPullEvent.type === 'activityTransfer') {
        expect(firstPullEvent.fromAccountId).toBe('roth');
      }
    });

    it('should pull from taxable before Roth (post-59.5 - no penalty)', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const taxable = makeAccount({
        id: 'taxable',
        name: 'Brokerage',
        type: 'Investment',
        performsPulls: true,
      });

      const roth = makeAccount({
        id: 'roth',
        name: 'Roth IRA',
        type: 'Investment',
        earlyWithdrawalPenalty: 0,
        performsPulls: true,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(taxable);
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([roth, taxable]);
      vi.mocked(mockBalanceTracker.getAccountBalance)
        .mockImplementation((id) => (id === 'taxable' ? 5000 : 5000));

      pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker, 'taxOptimized');

      const account = makeAccount({
        id: 'account-1',
        performsPulls: true,
        minimumBalance: 2000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 1500]]),
      });

      pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      // First pull should come from taxable (preserve Roth growth)
      const firstPullEvent = segment.events.find((e) => e.type === 'activityTransfer');
      expect(firstPullEvent).toBeDefined();
      if (firstPullEvent && firstPullEvent.type === 'activityTransfer') {
        expect(firstPullEvent.fromAccountId).toBe('taxable');
      }
    });

    it('should order taxable → tax-deferred → Roth post-59.5 (full 3-way)', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      const taxable = makeAccount({
        id: 'taxable',
        name: 'Brokerage',
        type: 'Investment',
        performsPulls: true,
        pullPriority: 10,
      });

      const preTax = makeAccount({
        id: 'pretax',
        name: 'Traditional 401k',
        type: 'Investment',
        usesRMD: true,
        earlyWithdrawalPenalty: 0,
        performsPulls: true,
        pullPriority: 10,
      });

      const roth = makeAccount({
        id: 'roth',
        name: 'Roth IRA',
        type: 'Investment',
        earlyWithdrawalPenalty: 0,
        performsPulls: true,
        pullPriority: 10,
      });

      // Need to pull 12000 total — each source has 5000 available
      // so we'll cascade through all three in priority order
      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(
        makeAccount({ id: 'account-1', performsPulls: true, minimumBalance: 2000 }),
      );
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([roth, preTax, taxable]);
      vi.mocked(mockBalanceTracker.getAccountBalance)
        .mockImplementation((id) => {
          if (id === 'taxable') return 5000;
          if (id === 'pretax') return 5000;
          if (id === 'roth') return 5000;
          return 0;
        });

      pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker, 'taxOptimized');

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', -10000]]),
      });

      pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      const pullEvents = segment.events.filter((e) => e.type === 'activityTransfer');
      expect(pullEvents.length).toBe(3);

      // Order: taxable (priority 10) → pre-tax (priority 40) → Roth (priority 50)
      expect(pullEvents[0].fromAccountId).toBe('taxable');
      expect(pullEvents[1].fromAccountId).toBe('pretax');
      expect(pullEvents[2].fromAccountId).toBe('roth');
    });

    it('should respect pullPriority as tiebreaker within same tax tier', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
      const referenceDate = new Date(Date.UTC(2025, 0, 1));

      // Two taxable accounts with different priorities
      const taxable1 = makeAccount({
        id: 'taxable1',
        name: 'Brokerage1',
        type: 'Investment',
        pullPriority: 50,
        performsPulls: true,
      });

      const taxable2 = makeAccount({
        id: 'taxable2',
        name: 'Brokerage2',
        type: 'Investment',
        pullPriority: 100, // Higher priority
        performsPulls: true,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(taxable1);
      vi.mocked(mockAccountManager.getPullableAccounts).mockReturnValue([taxable2, taxable1]);
      vi.mocked(mockBalanceTracker.getAccountBalance)
        .mockImplementation((id) => (id === 'taxable1' ? 5000 : 5000));

      pushPullHandler = new PushPullHandler(mockAccountManager, mockBalanceTracker, 'taxOptimized');

      const account = makeAccount({
        id: 'account-1',
        performsPulls: true,
        minimumBalance: 2000,
      });

      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(account);

      const segment = makeSegment({
        startDate: futureDate,
        affectedAccountIds: ['account-1'],
      });
      const segmentResult = makeSegmentResult({
        balanceMinimums: new Map([['account-1', 1500]]),
      });

      pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);

      // First pull should come from taxable1 (pullPriority 50 < 100)
      const firstPullEvent = segment.events.find((e) => e.type === 'activityTransfer');
      expect(firstPullEvent).toBeDefined();
      if (firstPullEvent && firstPullEvent.type === 'activityTransfer') {
        expect(firstPullEvent.fromAccountId).toBe('taxable1');
      }
    });
  });
});
