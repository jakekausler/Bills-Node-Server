import { Account } from '../../data/account/account.js';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity.js';
import { BalanceTracker } from './balance-tracker.js';
import { Timeline } from './timeline.js';
import { TimelineEvent, EventType, ActivityEvent } from './types.js';
import { RequiredTransfer } from './month-end-analyzer.js';
import { debug, log, warn } from './logger.js';

export interface AppliedTransfer {
  originalTransfer: RequiredTransfer;
  createdActivities: ConsolidatedActivity[];
  insertedAt: Date;
  affectedAccounts: string[];
}

export class RetroactiveApplicator {
  /**
   * Applies required transfers retroactively by inserting push/pull activities at month start
   */
  applyTransfers(transfers: RequiredTransfer[], timeline: Timeline, balanceTracker: BalanceTracker): AppliedTransfer[] {
    debug('RetroactiveApplicator.applyTransfers', 'Applying retroactive transfers', {
      transferCount: transfers.length,
    });

    const appliedTransfers: AppliedTransfer[] = [];

    for (const transfer of transfers) {
      try {
        const appliedTransfer = this.applyTransfer(transfer, timeline, balanceTracker);
        appliedTransfers.push(appliedTransfer);

        log('RetroactiveApplicator.applyTransfers', 'Successfully applied transfer', {
          type: transfer.type,
          amount: transfer.amount,
          fromAccount: transfer.fromAccount.name,
          toAccount: transfer.toAccount.name,
          reason: transfer.reason,
        });
      } catch (error) {
        warn('RetroactiveApplicator.applyTransfers', 'Failed to apply transfer', {
          type: transfer.type,
          amount: transfer.amount,
          fromAccount: transfer.fromAccount.name,
          toAccount: transfer.toAccount.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    log('RetroactiveApplicator.applyTransfers', 'Completed retroactive transfer application', {
      totalTransfers: transfers.length,
      successfulTransfers: appliedTransfers.length,
      failedTransfers: transfers.length - appliedTransfers.length,
    });

    return appliedTransfers;
  }

  /**
   * Applies a single transfer by creating activities and inserting them into the timeline
   */
  private applyTransfer(
    transfer: RequiredTransfer,
    timeline: Timeline,
    balanceTracker: BalanceTracker,
  ): AppliedTransfer {
    debug('RetroactiveApplicator.applyTransfer', 'Applying single transfer', {
      type: transfer.type,
      amount: transfer.amount,
      insertDate: transfer.insertDate.toISOString(),
    });

    // Create the push/pull activities
    const activities = this.createPushPullActivities(transfer);

    // Insert activities into timeline at the correct position
    this.insertActivitiesIntoTimeline(activities, transfer.insertDate, timeline);

    // Update balance tracker with retroactive changes
    this.updateBalanceTracker(activities, transfer.insertDate, balanceTracker);

    const appliedTransfer: AppliedTransfer = {
      originalTransfer: transfer,
      createdActivities: activities,
      insertedAt: transfer.insertDate,
      affectedAccounts: [transfer.fromAccount.id, transfer.toAccount.id],
    };

    return appliedTransfer;
  }

  /**
   * Creates ConsolidatedActivity objects for push/pull transfers
   */
  createPushPullActivities(transfer: RequiredTransfer): ConsolidatedActivity[] {
    debug('RetroactiveApplicator.createPushPullActivities', 'Creating activities for transfer', {
      type: transfer.type,
      amount: transfer.amount,
    });

    const activities: ConsolidatedActivity[] = [];
    const transferDate = transfer.insertDate;

    // Create withdrawal activity from source account
    const withdrawalActivity = new ConsolidatedActivity({
      id: `${transfer.type}-withdrawal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount: -transfer.amount, // Negative for withdrawal
      date: transferDate,
      name: `${transfer.type.toUpperCase()}: ${transfer.reason}`,
      category: 'Transfer',
      from: transfer.fromAccount.id, // Source account for withdrawal
      to: transfer.toAccount.id,
      isTransfer: true,
    });

    // Create deposit activity for destination account
    const depositActivity = new ConsolidatedActivity({
      id: `${transfer.type}-deposit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount: transfer.amount, // Positive for deposit
      date: transferDate,
      name: `${transfer.type.toUpperCase()}: ${transfer.reason}`,
      category: 'Transfer',
      from: transfer.fromAccount.id,
      to: transfer.toAccount.id,
      isTransfer: true,
    });

    activities.push(withdrawalActivity, depositActivity);

    debug('RetroactiveApplicator.createPushPullActivities', 'Created activities', {
      activityCount: activities.length,
      withdrawalId: withdrawalActivity.id,
      depositId: depositActivity.id,
    });

    return activities;
  }

  /**
   * Inserts activities into the timeline at the correct chronological position
   */
  private insertActivitiesIntoTimeline(activities: ConsolidatedActivity[], insertDate: Date, timeline: Timeline): void {
    debug('RetroactiveApplicator.insertActivitiesIntoTimeline', 'Inserting activities into timeline', {
      activityCount: activities.length,
      insertDate: insertDate.toISOString(),
    });

    // Convert activities to timeline events
    // We need to create separate events for withdrawal (from account) and deposit (to account)
    const timelineEvents: ActivityEvent[] = [];

    for (let i = 0; i < activities.length; i++) {
      const activity = activities[i];
      // Determine which account this activity affects
      // For withdrawal (negative amount), it affects the 'from' account
      // For deposit (positive amount), it affects the 'to' account
      const affectedAccountId = activity.amount < 0 ? activity.fro : activity.to;

      const event: ActivityEvent = {
        id: `retroactive_activity_${Date.now()}_${i}`,
        type: EventType.activity,
        date: activity.date,
        accountId: affectedAccountId || '',
        priority: this.getEventPriority('retroactive-transfer'),
        cacheable: false, // Retroactive events should not be cached
        dependencies: [],
        activity: activity,
      };

      timelineEvents.push(event);
    }

    // Use the new public method to add retroactive events
    timeline.addRetroactiveEvents(timelineEvents);

    log('RetroactiveApplicator.insertActivitiesIntoTimeline', 'Inserted activities into timeline', {
      eventCount: timelineEvents.length,
    });
  }

  /**
   * Returns priority for different event types to maintain proper ordering
   */
  private getEventPriority(eventType: string): number {
    const priorities: Record<string, number> = {
      'retroactive-transfer': 1, // Highest priority - should come first on any given day
      activity: 2,
      bill: 3,
      interest: 4,
      monthEndCheck: 5,
    };

    return priorities[eventType] || 10;
  }

  /**
   * Updates the balance tracker with retroactive changes
   */
  private updateBalanceTracker(
    activities: ConsolidatedActivity[],
    insertDate: Date,
    balanceTracker: BalanceTracker,
  ): void {
    debug('RetroactiveApplicator.updateBalanceTracker', 'Updating balance tracker', {
      activityCount: activities.length,
      insertDate: insertDate.toISOString(),
    });

    // Apply each activity to the balance tracker
    // Since we're doing retroactive changes, we need to update balances
    for (const activity of activities) {
      // Determine which account this activity affects
      const affectedAccountId = activity.amount < 0 ? activity.fro : activity.to;
      if (affectedAccountId) {
        balanceTracker.updateBalance(affectedAccountId, activity.amount);

        // CRITICAL FIX: Also add the activity to the account's consolidatedActivity array
        // This ensures the activities appear in the final results
        balanceTracker.addActivityToAccount(affectedAccountId, activity);
      }
    }

    log('RetroactiveApplicator.updateBalanceTracker', 'Updated balance tracker with retroactive changes', {
      affectedAccounts: [...new Set(activities.map((a) => (a.amount < 0 ? a.fro : a.to)).filter(Boolean))],
    });
  }

  /**
   * Validates that a transfer can be applied without causing issues
   */
  private validateTransfer(transfer: RequiredTransfer): void {
    if (transfer.amount <= 0) {
      throw new Error(`Invalid transfer amount: ${transfer.amount}`);
    }

    if (!transfer.fromAccount || !transfer.toAccount) {
      throw new Error('Transfer must have both source and destination accounts');
    }

    if (transfer.fromAccount.id === transfer.toAccount.id) {
      throw new Error('Cannot transfer from an account to itself');
    }

    // Additional validations could include:
    // - Check account balance availability at the time
    // - Validate account transfer restrictions
    // - Check for tax implications
  }
}
