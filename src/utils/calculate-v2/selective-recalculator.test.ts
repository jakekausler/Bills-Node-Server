import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SelectiveRecalculator, RecalculationScope, RecalculationResult } from './selective-recalculator.js';
import { AppliedTransfer } from './retroactive-applicator.js';
import { Timeline } from './timeline.js';
import { BalanceTracker } from './balance-tracker.js';
import { Account } from '../../data/account/account.js';
import { AccountsAndTransfers } from '../../data/account/types.js';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity.js';
import { RequiredTransfer } from './month-end-analyzer.js';
import { TimelineEvent, EventType, InterestEvent, TransferEvent, BillEvent } from './types.js';
import { Interest } from '../../data/interest/interest.js';
import { Bill } from '../../data/bill/bill.js';
import { Transfer } from './types.js';

describe('SelectiveRecalculator', () => {
  let recalculator: SelectiveRecalculator;
  let mockTimeline: Timeline;
  let mockBalanceTracker: BalanceTracker;
  let mockAccountsAndTransfers: AccountsAndTransfers;
  let testAccount1: Account;
  let testAccount2: Account;

  beforeEach(() => {
    recalculator = new SelectiveRecalculator();
    
    // Create test accounts
    testAccount1 = new Account({
      id: 'account1',
      name: 'Test Account 1',
      balance: 10000,
      isManaged: true,
      minimumBalance: 1000,
      activities: [],
      bills: [],
      interests: []
    });

    testAccount2 = new Account({
      id: 'account2',
      name: 'Test Account 2',
      balance: 5000,
      isManaged: true,
      minimumBalance: 500,
      activities: [],
      bills: [],
      interests: []
    });

    // Mock dependencies
    mockTimeline = {
      getEventsInRange: vi.fn(),
      addRetroactiveEvents: vi.fn(),
    } as any;

    mockBalanceTracker = {
      getBalance: vi.fn(),
      updateBalance: vi.fn(),
    } as any;

    mockAccountsAndTransfers = {
      accounts: [testAccount1, testAccount2],
      transfers: []
    } as any;
  });

  describe('identifyAffectedEvents', () => {
    it('should identify events in affected accounts within date range', () => {
      const appliedTransfers: AppliedTransfer[] = [{
        originalTransfer: {
          type: 'push',
          fromAccount: testAccount2,
          toAccount: testAccount1,
          amount: 1000,
          insertDate: new Date('2025-01-01'),
          reason: 'Test transfer'
        } as RequiredTransfer,
        createdActivities: [],
        insertedAt: new Date('2025-01-01'),
        affectedAccounts: ['account1', 'account2']
      }];

      const testEvents: TimelineEvent[] = [
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent,
        {
          id: 'interest2',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account3', // Not affected
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent,
        {
          id: 'activity1',
          type: EventType.activity,
          date: new Date('2025-01-10'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          activity: {} as ConsolidatedActivity
        }
      ];

      (mockTimeline.getEventsInRange as any).mockReturnValue(testEvents);

      const result = recalculator.identifyAffectedEvents(appliedTransfers, mockTimeline);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('interest1');
      expect(result[0].accountId).toBe('account1');
    });

    it('should exclude events outside the date range', () => {
      const appliedTransfers: AppliedTransfer[] = [{
        originalTransfer: {
          type: 'push',
          fromAccount: testAccount2,
          toAccount: testAccount1,
          amount: 1000,
          insertDate: new Date('2025-01-01'),
          reason: 'Test transfer'
        } as RequiredTransfer,
        createdActivities: [],
        insertedAt: new Date('2025-01-01'),
        affectedAccounts: ['account1']
      }];

      const testEvents: TimelineEvent[] = [
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2024-12-15'), // Before start date
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent
      ];

      (mockTimeline.getEventsInRange as any).mockReturnValue(testEvents);

      const result = recalculator.identifyAffectedEvents(appliedTransfers, mockTimeline);

      expect(result).toHaveLength(0);
    });

    it('should include all relevant event types', () => {
      const appliedTransfers: AppliedTransfer[] = [{
        originalTransfer: {
          type: 'push',
          fromAccount: testAccount2,
          toAccount: testAccount1,
          amount: 1000,
          insertDate: new Date('2025-01-01'),
          reason: 'Test transfer'
        } as RequiredTransfer,
        createdActivities: [],
        insertedAt: new Date('2025-01-01'),
        affectedAccounts: ['account1']
      }];

      const testEvents: TimelineEvent[] = [
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent,
        {
          id: 'transfer1',
          type: EventType.transfer,
          date: new Date('2025-01-20'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          transfer: {} as Transfer,
          fromAccountId: 'account1',
          toAccountId: 'account2',
          amount: 500
        } as TransferEvent,
        {
          id: 'pushpull1',
          type: EventType.pushPullCheck,
          date: new Date('2025-02-01'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          checkType: 'monthly'
        }
      ];

      (mockTimeline.getEventsInRange as any).mockReturnValue(testEvents);

      const result = recalculator.identifyAffectedEvents(appliedTransfers, mockTimeline);

      expect(result).toHaveLength(3);
      expect(result.map(e => e.type)).toEqual([
        EventType.interest,
        EventType.transfer,
        EventType.pushPullCheck
      ]);
    });
  });

  describe('recalculateEvents', () => {
    it('should successfully recalculate a list of events', () => {
      const testEvents: TimelineEvent[] = [
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent
      ];

      (mockBalanceTracker.getBalance as any).mockReturnValue(10000);

      const result = recalculator.recalculateEvents(testEvents, mockBalanceTracker, mockAccountsAndTransfers);

      expect(result.success).toBe(true);
      expect(result.recalculatedEvents).toHaveLength(1);
      expect(result.affectedEventIds.has('interest1')).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should handle errors gracefully', () => {
      const testEvents: TimelineEvent[] = [
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent
      ];

      (mockBalanceTracker.getBalance as any).mockImplementation(() => {
        throw new Error('Balance tracker error');
      });

      const result = recalculator.recalculateEvents(testEvents, mockBalanceTracker, mockAccountsAndTransfers);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Balance tracker error');
      expect(result.recalculatedEvents).toHaveLength(0);
    });

    it('should sort events by date before processing', () => {
      const testEvents: TimelineEvent[] = [
        {
          id: 'interest2',
          type: EventType.interest,
          date: new Date('2025-01-20'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent,
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent
      ];

      (mockBalanceTracker.getBalance as any).mockReturnValue(10000);

      const result = recalculator.recalculateEvents(testEvents, mockBalanceTracker, mockAccountsAndTransfers);

      expect(result.success).toBe(true);
      expect(result.recalculatedEvents).toHaveLength(2);
      // Should be sorted by date
      expect(result.recalculatedEvents[0].id).toBe('interest1');
      expect(result.recalculatedEvents[1].id).toBe('interest2');
    });

    it('should track balance changes for balance-affecting events', () => {
      const billEvent: BillEvent = {
        id: 'bill1',
        type: EventType.bill,
        date: new Date('2025-01-15'),
        accountId: 'account1',
        priority: 1,
        cacheable: true,
        dependencies: [],
        bill: {} as Bill,
        amount: 1000,
        isVariable: false
      };

      (mockBalanceTracker.getBalance as any).mockReturnValue(10000);

      const result = recalculator.recalculateEvents([billEvent], mockBalanceTracker, mockAccountsAndTransfers);

      expect(result.success).toBe(true);
      expect(result.balanceChanges.has('account1')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty transfer list', () => {
      (mockTimeline.getEventsInRange as any).mockReturnValue([]);
      const result = recalculator.identifyAffectedEvents([], mockTimeline);
      expect(result).toHaveLength(0);
    });

    it('should handle empty event list for recalculation', () => {
      const result = recalculator.recalculateEvents([], mockBalanceTracker, mockAccountsAndTransfers);
      
      expect(result.success).toBe(true);
      expect(result.recalculatedEvents).toHaveLength(0);
      expect(result.affectedEventIds.size).toBe(0);
    });

    it('should handle events with null or undefined properties gracefully', () => {
      const testEvents: TimelineEvent[] = [
        {
          id: 'interest1',
          type: EventType.interest,
          date: new Date('2025-01-15'),
          accountId: 'account1',
          priority: 1,
          cacheable: true,
          dependencies: [],
          interest: {} as Interest,
          rate: 0.05,
          taxDeferred: false
        } as InterestEvent
      ];

      (mockBalanceTracker.getBalance as any).mockReturnValue(null);

      // Should not throw an error
      expect(() => {
        recalculator.recalculateEvents(testEvents, mockBalanceTracker, mockAccountsAndTransfers);
      }).not.toThrow();
    });
  });

  describe('calculateRecalculationScope', () => {
    it('should include all affected accounts from transfers', () => {
      const appliedTransfers: AppliedTransfer[] = [
        {
          originalTransfer: {} as RequiredTransfer,
          createdActivities: [],
          insertedAt: new Date('2025-01-01'),
          affectedAccounts: ['account1', 'account2']
        },
        {
          originalTransfer: {} as RequiredTransfer,
          createdActivities: [],
          insertedAt: new Date('2025-01-15'),
          affectedAccounts: ['account3', 'account4']
        }
      ];

      (mockTimeline.getEventsInRange as any).mockReturnValue([]);

      recalculator.identifyAffectedEvents(appliedTransfers, mockTimeline);

      // Verify that getEventsInRange was called with a scope that includes all accounts
      const call = (mockTimeline.getEventsInRange as any).mock.calls[0];
      expect(call).toBeDefined();
      expect(call[0]).toEqual(new Date('2025-01-01')); // Start date should be earliest
    });

    it('should extend end date for cascade effects', () => {
      const appliedTransfers: AppliedTransfer[] = [{
        originalTransfer: {} as RequiredTransfer,
        createdActivities: [],
        insertedAt: new Date('2025-01-01'),
        affectedAccounts: ['account1']
      }];

      (mockTimeline.getEventsInRange as any).mockReturnValue([]);

      recalculator.identifyAffectedEvents(appliedTransfers, mockTimeline);

      const call = (mockTimeline.getEventsInRange as any).mock.calls[0];
      const endDate = call[1];
      const expectedEndDate = new Date('2025-01-01');
      expectedEndDate.setMonth(expectedEndDate.getMonth() + 6);

      expect(endDate.getMonth()).toBe(expectedEndDate.getMonth());
      expect(endDate.getFullYear()).toBe(expectedEndDate.getFullYear());
    });
  });
});