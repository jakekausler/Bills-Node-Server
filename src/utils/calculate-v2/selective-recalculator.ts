import { Account } from '../../data/account/account.js';
import { AccountsAndTransfers } from '../../data/account/types.js';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity.js';
import { BalanceTracker } from './balance-tracker.js';
import { Timeline } from './timeline.js';
import { TimelineEvent, EventType, InterestEvent, TransferEvent, BillEvent } from './types.js';
import { AppliedTransfer } from './retroactive-applicator.js';
import { debug, log, warn } from './logger.js';

export interface RecalculationScope {
  affectedAccounts: Set<string>;
  startDate: Date;
  endDate: Date;
  eventTypes: Set<EventType>;
}

export interface RecalculationResult {
  success: boolean;
  recalculatedEvents: TimelineEvent[];
  balanceChanges: Map<string, number>;
  errorMessage?: string;
  affectedEventIds: Set<string>;
}

/**
 * SelectiveRecalculator efficiently recalculates only events affected by retroactive changes
 * 
 * This class implements the selective recalculation strategy outlined in the Push-Pull_Rework.md:
 * - Identifies events that depend on account balances
 * - Recalculates interest events with new balance history
 * - Updates transfers that may be affected by balance changes
 * - Propagates changes to subsequent months
 */
export class SelectiveRecalculator {
  
  /**
   * Identifies events that are affected by the applied retroactive transfers
   */
  identifyAffectedEvents(
    appliedTransfers: AppliedTransfer[],
    timeline: Timeline
  ): TimelineEvent[] {
    debug('SelectiveRecalculator.identifyAffectedEvents', 'Identifying events affected by transfers', {
      transferCount: appliedTransfers.length
    });

    const affectedEvents: TimelineEvent[] = [];
    const scope = this.calculateRecalculationScope(appliedTransfers);
    
    log('SelectiveRecalculator.identifyAffectedEvents', 'Calculated recalculation scope', {
      affectedAccounts: Array.from(scope.affectedAccounts),
      startDate: scope.startDate.toISOString(),
      endDate: scope.endDate.toISOString(),
      eventTypes: Array.from(scope.eventTypes)
    });

    // Get all events from the timeline within the scope
    const allEvents = timeline.getEventsInRange(scope.startDate, scope.endDate);
    
    for (const event of allEvents) {
      if (this.isEventAffected(event, scope)) {
        affectedEvents.push(event);
        debug('SelectiveRecalculator.identifyAffectedEvents', 'Event marked as affected', {
          eventId: event.id,
          eventType: event.type,
          accountId: event.accountId,
          date: event.date.toISOString()
        });
      }
    }

    log('SelectiveRecalculator.identifyAffectedEvents', 'Identified affected events', {
      totalEventsInRange: allEvents.length,
      affectedEventCount: affectedEvents.length
    });

    return affectedEvents;
  }

  /**
   * Recalculates the identified affected events with updated balance information
   */
  recalculateEvents(
    events: TimelineEvent[],
    balanceTracker: BalanceTracker,
    accountsAndTransfers: AccountsAndTransfers
  ): RecalculationResult {
    debug('SelectiveRecalculator.recalculateEvents', 'Starting recalculation of affected events', {
      eventCount: events.length
    });

    const result: RecalculationResult = {
      success: true,
      recalculatedEvents: [],
      balanceChanges: new Map(),
      affectedEventIds: new Set()
    };

    try {
      // Sort events by date to ensure proper processing order
      const sortedEvents = events.sort((a, b) => a.date.getTime() - b.date.getTime());

      for (const event of sortedEvents) {
        const recalculatedEvent = this.recalculateEvent(event, balanceTracker, accountsAndTransfers);
        
        if (recalculatedEvent) {
          result.recalculatedEvents.push(recalculatedEvent);
          result.affectedEventIds.add(event.id);
          
          // Track balance changes if this is a balance-affecting event
          if (this.isBalanceAffectingEvent(recalculatedEvent)) {
            const balanceChange = this.calculateBalanceChange(recalculatedEvent, event);
            // Always track balance changes for balance-affecting events, even if the change is 0
            const existingChange = result.balanceChanges.get(event.accountId) || 0;
            result.balanceChanges.set(event.accountId, existingChange + balanceChange);
          }

          debug('SelectiveRecalculator.recalculateEvents', 'Event recalculated', {
            eventId: event.id,
            eventType: event.type,
            accountId: event.accountId
          });
        }
      }

      log('SelectiveRecalculator.recalculateEvents', 'Completed event recalculation', {
        totalEvents: events.length,
        recalculatedEvents: result.recalculatedEvents.length,
        affectedAccounts: Array.from(result.balanceChanges.keys())
      });

    } catch (error) {
      result.success = false;
      result.errorMessage = error instanceof Error ? error.message : 'Unknown error during recalculation';
      
      warn('SelectiveRecalculator.recalculateEvents', 'Recalculation failed', {
        error: result.errorMessage,
        processedEvents: result.recalculatedEvents.length
      });
    }

    return result;
  }

  /**
   * Calculates the scope of recalculation based on applied transfers
   */
  private calculateRecalculationScope(appliedTransfers: AppliedTransfer[]): RecalculationScope {
    const affectedAccounts = new Set<string>();
    let earliestDate = new Date();
    let latestDate = new Date(0);

    // Handle empty transfers array
    if (appliedTransfers.length === 0) {
      return {
        affectedAccounts,
        startDate: new Date(),
        endDate: new Date(),
        eventTypes: new Set()
      };
    }

    // Collect all affected accounts and determine date range
    for (const transfer of appliedTransfers) {
      transfer.affectedAccounts.forEach(accountId => affectedAccounts.add(accountId));
      
      if (transfer.insertedAt < earliestDate) {
        earliestDate = transfer.insertedAt;
      }
      if (transfer.insertedAt > latestDate) {
        latestDate = transfer.insertedAt;
      }
    }

    // Extend the date range to include subsequent months for cascade effects
    const endDate = new Date(latestDate);
    endDate.setMonth(endDate.getMonth() + 6); // Look ahead 6 months for cascade effects

    // Event types that are sensitive to balance changes
    const eventTypes = new Set<EventType>([
      EventType.interest,      // Interest calculations depend on balance
      EventType.transfer,      // Transfers may have balance restrictions
      EventType.pushPullCheck, // Push/pull decisions depend on balance projections
      EventType.bill,          // Some bills may have balance-dependent amounts
      EventType.tax,           // Tax calculations may depend on balances
      EventType.rmd            // RMDs depend on account balances
    ]);

    return {
      affectedAccounts,
      startDate: earliestDate,
      endDate,
      eventTypes
    };
  }

  /**
   * Determines if an event is affected by the retroactive changes
   */
  private isEventAffected(event: TimelineEvent, scope: RecalculationScope): boolean {
    // Check if event is in affected accounts
    if (!scope.affectedAccounts.has(event.accountId)) {
      return false;
    }

    // Check if event type is sensitive to balance changes
    if (!scope.eventTypes.has(event.type)) {
      return false;
    }

    // Check if event is within the recalculation date range
    if (event.date < scope.startDate || event.date > scope.endDate) {
      return false;
    }

    // Additional logic for specific event types
    switch (event.type) {
      case EventType.interest:
        // Interest events are always affected if in scope
        return true;
        
      case EventType.transfer:
        // Transfer events are affected if they have balance restrictions
        return this.hasBalanceRestrictions(event as TransferEvent);
        
      case EventType.pushPullCheck:
        // Push/pull checks are always affected as they depend on balance projections
        return true;
        
      case EventType.bill:
        // Bills are affected if they have variable amounts based on balance
        return this.hasBalanceDependentAmount(event as BillEvent);
        
      default:
        return true; // Conservative approach - include if in doubt
    }
  }

  /**
   * Recalculates a specific event with updated balance information
   */
  private recalculateEvent(
    event: TimelineEvent,
    balanceTracker: BalanceTracker,
    accountsAndTransfers: AccountsAndTransfers
  ): TimelineEvent | null {
    switch (event.type) {
      case EventType.interest:
        return this.recalculateInterestEvent(event as InterestEvent, balanceTracker, accountsAndTransfers);
        
      case EventType.transfer:
        return this.recalculateTransferEvent(event as TransferEvent, balanceTracker, accountsAndTransfers);
        
      case EventType.bill:
        return this.recalculateBillEvent(event as BillEvent, balanceTracker, accountsAndTransfers);
        
      default:
        // For other event types, return the original event (no recalculation needed)
        return event;
    }
  }

  /**
   * Recalculates an interest event with updated balance history
   */
  private recalculateInterestEvent(
    event: InterestEvent,
    balanceTracker: BalanceTracker,
    accountsAndTransfers: AccountsAndTransfers
  ): InterestEvent {
    debug('SelectiveRecalculator.recalculateInterestEvent', 'Recalculating interest event', {
      eventId: event.id,
      accountId: event.accountId,
      originalRate: event.rate
    });

    // Get the current balance at the time of interest calculation
    const currentBalance = balanceTracker.getBalance(event.accountId);
    
    // Interest rate typically doesn't change, but we might need to recalculate
    // the actual interest amount based on the new balance
    // For now, return the event unchanged as the interest calculation 
    // will be handled by the interest processor with the updated balance
    
    return event;
  }

  /**
   * Recalculates a transfer event considering balance restrictions
   */
  private recalculateTransferEvent(
    event: TransferEvent,
    balanceTracker: BalanceTracker,
    accountsAndTransfers: AccountsAndTransfers
  ): TransferEvent {
    debug('SelectiveRecalculator.recalculateTransferEvent', 'Recalculating transfer event', {
      eventId: event.id,
      fromAccount: event.fromAccountId,
      toAccount: event.toAccountId,
      originalAmount: event.amount
    });

    // Check if the transfer amount needs to be adjusted based on available balance
    const fromAccountBalance = balanceTracker.getBalance(event.fromAccountId);
    
    // If the transfer amount exceeds available balance, we might need to adjust
    // For now, return the event unchanged and let the transfer processor handle it
    
    return event;
  }

  /**
   * Recalculates a bill event with potentially balance-dependent amounts
   */
  private recalculateBillEvent(
    event: BillEvent,
    balanceTracker: BalanceTracker,
    accountsAndTransfers: AccountsAndTransfers
  ): BillEvent {
    debug('SelectiveRecalculator.recalculateBillEvent', 'Recalculating bill event', {
      eventId: event.id,
      accountId: event.accountId,
      originalAmount: event.amount,
      isVariable: event.isVariable
    });

    // If the bill has a variable amount that depends on balance, recalculate it
    if (event.isVariable) {
      // This would require evaluating the variable expression with current balance
      // For now, return the event unchanged
    }
    
    return event;
  }

  /**
   * Checks if a transfer event has balance restrictions
   */
  private hasBalanceRestrictions(event: TransferEvent): boolean {
    // This would check if the transfer has restrictions like minimum balance requirements
    // or maximum withdrawal limits
    return true; // Conservative approach - assume all transfers have restrictions
  }

  /**
   * Checks if a bill event has balance-dependent amounts
   */
  private hasBalanceDependentAmount(event: BillEvent): boolean {
    // Check if the bill amount is variable and potentially depends on balance
    return event.isVariable;
  }

  /**
   * Determines if an event affects account balances
   */
  private isBalanceAffectingEvent(event: TimelineEvent): boolean {
    return [
      EventType.activity,
      EventType.bill,
      EventType.interest,
      EventType.transfer,
      EventType.pension,
      EventType.socialSecurity,
      EventType.tax,
      EventType.rmd
    ].includes(event.type);
  }

  /**
   * Calculates the balance change between original and recalculated events
   */
  private calculateBalanceChange(recalculatedEvent: TimelineEvent, originalEvent: TimelineEvent): number {
    // This is a simplified implementation - actual balance change calculation
    // would need to look at the specific event types and their amounts
    
    if (recalculatedEvent.type === EventType.interest) {
      const recalc = recalculatedEvent as InterestEvent;
      const original = originalEvent as InterestEvent;
      // Interest amount calculation would need to be done here
      return 0; // Placeholder
    }
    
    if (recalculatedEvent.type === EventType.transfer) {
      const recalc = recalculatedEvent as TransferEvent;
      const original = originalEvent as TransferEvent;
      return recalc.amount - original.amount;
    }
    
    if (recalculatedEvent.type === EventType.bill) {
      const recalc = recalculatedEvent as BillEvent;
      const original = originalEvent as BillEvent;
      return recalc.amount - original.amount;
    }
    
    return 0;
  }
}