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

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment);

      expect(result).toBe(false);
      expect(segment.events).toHaveLength(0);
    });

    it('should skip account when not found', () => {
      vi.mocked(mockAccountManager.getAccountById).mockReturnValue(undefined);

      const segment = makeSegment();
      const segmentResult = makeSegmentResult();

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment);

      expect(result).toBe(false);
    });

    it('should add push event when balance exceeds maximum', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
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

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment);

      expect(result).toBe(true);
      expect(segment.events).toHaveLength(1);
      expect(segment.events[0].type).toBe('activityTransfer');
    });

    it('should add pull event when balance falls below minimum', () => {
      const futureDate = new Date(Date.UTC(2030, 0, 1));
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

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment);

      expect(result).toBe(true);
      expect(segment.events.length).toBeGreaterThan(0);
    });

    it('should not push when segment is in the past', () => {
      const pastDate = new Date(Date.UTC(2020, 0, 1));
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

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment);

      expect(result).toBe(false);
      expect(segment.events).toHaveLength(0);
    });

    it('should respect pushStart date when configured', () => {
      const futureDate = new Date(Date.UTC(2030, 6, 1)); // July 2030
      const pushStartDate = new Date(Date.UTC(2031, 0, 1)); // Jan 2031

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

      const result = pushPullHandler.handleAccountPushPulls(segmentResult, segment);

      expect(result).toBe(false);
      expect(segment.events).toHaveLength(0);
    });
  });
});
