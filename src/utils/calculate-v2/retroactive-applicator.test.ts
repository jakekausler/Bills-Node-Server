import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetroactiveApplicator } from './retroactive-applicator.js';
import { MonthEndAnalyzer, RequiredTransfer } from './month-end-analyzer.js';
import { Timeline } from './timeline.js';
import { BalanceTracker } from './balance-tracker.js';
import { Account } from '../../data/account/account.js';
import { CacheManager } from './cache.js';

describe('RetroactiveApplicator', () => {
  let applicator: RetroactiveApplicator;
  let timeline: Timeline;
  let balanceTracker: BalanceTracker;
  let sourceAccount: Account;
  let targetAccount: Account;
  let cache: CacheManager;

  beforeEach(() => {
    applicator = new RetroactiveApplicator();

    // Create test accounts
    sourceAccount = new Account({
      id: 'checking',
      name: 'Checking Account',
      todayBalance: 10000,
      pullPriority: 1,
    } as any);

    targetAccount = new Account({
      id: 'savings',
      name: 'Savings Account',
      todayBalance: 500,
      performsPulls: true,
      minimumBalance: 1000,
      pullPriority: 3,
    } as any);

    // Create cache manager
    cache = new CacheManager('test');

    // Create balance tracker and timeline
    balanceTracker = new BalanceTracker([sourceAccount, targetAccount], cache);
    timeline = new Timeline();
  });

  describe('createPushPullActivities', () => {
    it('should create withdrawal and deposit activities for a pull transfer', () => {
      const transfer: RequiredTransfer = {
        type: 'pull',
        fromAccount: sourceAccount,
        toAccount: targetAccount,
        amount: 500,
        insertDate: new Date('2025-01-01'),
        reason: 'Maintain minimum balance',
      };

      const activities = applicator.createPushPullActivities(transfer);

      expect(activities).toHaveLength(2);

      // Check withdrawal activity
      const withdrawal = activities.find((a) => a.amount < 0);
      expect(withdrawal).toBeDefined();
      expect(withdrawal!.amount).toBe(-500);
      expect(withdrawal!.date).toEqual(transfer.insertDate);
      expect(withdrawal!.name).toContain('PULL');
      expect(withdrawal!.category).toBe('Transfer');
      expect(withdrawal!.fro).toBe(sourceAccount.id);
      expect(withdrawal!.to).toBe(targetAccount.id);
      expect(withdrawal!.isTransfer).toBe(true);

      // Check deposit activity
      const deposit = activities.find((a) => a.amount > 0);
      expect(deposit).toBeDefined();
      expect(deposit!.amount).toBe(500);
      expect(deposit!.date).toEqual(transfer.insertDate);
      expect(deposit!.name).toContain('PULL');
      expect(deposit!.category).toBe('Transfer');
      expect(deposit!.fro).toBe(sourceAccount.id);
      expect(deposit!.to).toBe(targetAccount.id);
      expect(deposit!.isTransfer).toBe(true);
    });

    it('should create activities for a push transfer', () => {
      const transfer: RequiredTransfer = {
        type: 'push',
        fromAccount: targetAccount,
        toAccount: sourceAccount,
        amount: 2000,
        insertDate: new Date('2025-01-01'),
        reason: 'Excess balance push',
      };

      const activities = applicator.createPushPullActivities(transfer);

      expect(activities).toHaveLength(2);

      const withdrawal = activities.find((a) => a.amount < 0);
      expect(withdrawal!.name).toContain('PUSH');

      const deposit = activities.find((a) => a.amount > 0);
      expect(deposit!.name).toContain('PUSH');
    });
  });

  describe('applyTransfers', () => {
    it('should apply a single transfer successfully', () => {
      const transfer: RequiredTransfer = {
        type: 'pull',
        fromAccount: sourceAccount,
        toAccount: targetAccount,
        amount: 500,
        insertDate: new Date('2025-01-01'),
        reason: 'Maintain minimum balance',
      };

      const appliedTransfers = applicator.applyTransfers([transfer], timeline, balanceTracker);

      expect(appliedTransfers).toHaveLength(1);

      const applied = appliedTransfers[0];
      expect(applied.originalTransfer).toBe(transfer);
      expect(applied.createdActivities).toHaveLength(2);
      expect(applied.insertedAt).toEqual(transfer.insertDate);
      expect(applied.affectedAccounts).toEqual([sourceAccount.id, targetAccount.id]);
    });

    it('should apply multiple transfers', () => {
      const transfers: RequiredTransfer[] = [
        {
          type: 'pull',
          fromAccount: sourceAccount,
          toAccount: targetAccount,
          amount: 500,
          insertDate: new Date('2025-01-01'),
          reason: 'First transfer',
        },
        {
          type: 'push',
          fromAccount: targetAccount,
          toAccount: sourceAccount,
          amount: 200,
          insertDate: new Date('2025-01-15'),
          reason: 'Second transfer',
        },
      ];

      const appliedTransfers = applicator.applyTransfers(transfers, timeline, balanceTracker);

      expect(appliedTransfers).toHaveLength(2);
      expect(appliedTransfers[0].originalTransfer.type).toBe('pull');
      expect(appliedTransfers[1].originalTransfer.type).toBe('push');
    });

    it('should handle empty transfer list', () => {
      const appliedTransfers = applicator.applyTransfers([], timeline, balanceTracker);
      expect(appliedTransfers).toHaveLength(0);
    });
  });

  describe('integration with Timeline', () => {
    it('should add events to timeline with correct properties', () => {
      const transfer: RequiredTransfer = {
        type: 'pull',
        fromAccount: sourceAccount,
        toAccount: targetAccount,
        amount: 500,
        insertDate: new Date('2025-01-01'),
        reason: 'Test transfer',
      };

      const initialEventCount = timeline.getEvents().length;
      applicator.applyTransfers([transfer], timeline, balanceTracker);

      const finalEventCount = timeline.getEvents().length;
      expect(finalEventCount).toBe(initialEventCount + 2); // Two activities added

      const newEvents = timeline.getEventsForDate(transfer.insertDate);
      expect(newEvents.length).toBeGreaterThanOrEqual(2);

      // Check that events have correct properties
      const activityEvents = newEvents.filter((e) => e.type === 'activity');
      expect(activityEvents).toHaveLength(2);

      for (const event of activityEvents) {
        expect(event.date).toEqual(transfer.insertDate);
        expect(event.cacheable).toBe(false);
        expect(event.dependencies).toEqual([]);
        expect(event.activity).toBeDefined();
      }
    });
  });

  describe('integration with BalanceTracker', () => {
    it('should update balances correctly', async () => {
      await balanceTracker.initializeBalances();

      const initialSourceBalance = balanceTracker.getAccountBalance(sourceAccount.id);
      const initialTargetBalance = balanceTracker.getAccountBalance(targetAccount.id);

      const transfer: RequiredTransfer = {
        type: 'pull',
        fromAccount: sourceAccount,
        toAccount: targetAccount,
        amount: 500,
        insertDate: new Date('2025-01-01'),
        reason: 'Test transfer',
      };

      applicator.applyTransfers([transfer], timeline, balanceTracker);

      const finalSourceBalance = balanceTracker.getAccountBalance(sourceAccount.id);
      const finalTargetBalance = balanceTracker.getAccountBalance(targetAccount.id);

      expect(finalSourceBalance).toBe(initialSourceBalance - 500);
      expect(finalTargetBalance).toBe(initialTargetBalance + 500);
    });
  });
});
