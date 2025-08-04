/**
 * Event-based timeline management for optimized financial calculations
 *
 * This module replaces daily iteration with event-driven processing, dramatically
 * reducing the number of calculation steps from ~22,000 days to ~200-500 events
 * for typical 60-year calculations.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import crypto from 'crypto';
import {
  TimelineEvent,
  EventType,
  ActivityEvent,
  BillEvent,
  InterestEvent,
  TransferEvent,
  PushPullEvent,
  MonthEndCheckEvent,
  CalculationSegment,
  Transfer,
} from './types';
import { AccountsAndTransfers } from '../../data/account/types';
import { Account } from '../../data/account/account';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Bill } from '../../data/bill/bill';
import { Interest } from '../../data/interest/interest';
// Transfer data is handled through AccountsAndTransfers.transfers
import { loadVariable } from '../simulation/variable';
import { nextDate } from '../calculate/helpers';
import { debug } from './logger';
import { format } from 'util';
import { formatDate, isAfterOrSame, isBefore, isBeforeOrSame } from '../date/date';

dayjs.extend(utc);

/**
 * Timeline manager for event-based calculations
 */
export class Timeline {
  private events: TimelineEvent[] = [];
  private segments: CalculationSegment[] = [];
  private eventIndex: Map<string, TimelineEvent> = new Map();
  private dateIndex: Map<string, TimelineEvent[]> = new Map();

  /**
   * Creates a timeline from accounts and transfers data
   */
  static fromAccountsAndTransfers(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
    simulation: string,
  ): Timeline {
    const timeline = new Timeline();

    // Add activity events
    timeline.addActivityEvents(accountsAndTransfers, endDate);

    // Add bill events
    timeline.addBillEvents(accountsAndTransfers, endDate, simulation);

    // Add interest events
    timeline.addInterestEvents(accountsAndTransfers, endDate);

    // Add transfer events
    timeline.addTransferEvents(accountsAndTransfers, endDate, simulation);

    // Add monthly month-end check events for retroactive balance analysis
    timeline.addMonthEndCheckEvents(accountsAndTransfers, startDate, endDate);

    // Sort and optimize timeline
    timeline.sortEvents();
    timeline.createSegments(startDate, endDate);

    return timeline;
  }

  /**
   * Adds manual activity events to the timeline
   * Excludes transfer activities since they're handled separately in addTransferEvents
   */
  private addActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const account of accountsAndTransfers.accounts) {
      for (const activity of account.activity) {
        // Skip transfer activities to prevent double-counting
        // Transfer activities are processed separately in addTransferEvents method
        if (activity.isTransfer) {
          continue;
        }

        if (activity.date <= endDate) {
          const event: ActivityEvent = {
            id: `activity_${account.id}_${activity.id}`,
            type: EventType.activity,
            date: activity.date,
            accountId: account.id,
            priority: 1, // Activities have high priority
            cacheable: true,
            dependencies: [],
            activity: new ConsolidatedActivity(activity.serialize()),
          };

          this.addEvent(event);
        }
      }
    }
  }

  /**
   * Adds bill events to the timeline with proper scheduling
   */
  private addBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date, simulation: string): void {
    for (const account of accountsAndTransfers.accounts) {
      for (const bill of account.bills) {
        this.generateBillEvents(account, bill, endDate, simulation);
      }
    }

    // Add transfer bills
    for (const transfer of accountsAndTransfers.transfers.bills) {
      this.generateTransferBillEvents(accountsAndTransfers.accounts, transfer, endDate, simulation);
    }
  }

  /**
   * Generates recurring bill events for a specific bill
   */
  private generateBillEvents(account: Account, bill: Bill, endDate: Date, simulation: string): void {
    if (!bill.startDate || bill.startDate > endDate) return;

    let currentDate = bill.startDate;
    let eventCount = 0;

    // Calculate bill occurrences up to end date
    while (currentDate <= endDate && (!bill.endDate || currentDate <= bill.endDate)) {
      const amount = this.calculateBillAmount(bill, currentDate, simulation);

      const event: BillEvent = {
        id: `bill_${account.id}_${bill.id}_${eventCount}`,
        type: EventType.bill,
        date: new Date(currentDate),
        accountId: account.id,
        priority: 2, // Bills processed after activities
        cacheable: true,
        dependencies: [],
        bill,
        amount,
        isVariable: bill.amountIsVariable || false,
      };

      this.addEvent(event);

      // Calculate next occurrence
      currentDate = nextDate(currentDate, bill.periods, bill.everyN);
      currentDate = bill.checkAnnualDates(currentDate);
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many bill events generated for bill ${bill.id}`);
      }
    }
  }

  /**
   * Calculates the number of years between two dates, considering increaseByDate
   */
  private yearIncreases(startDate: Date, endDate: Date, increaseDate: { day: number; month: number }): number {
    let count = 0;

    // Start from the first possible increase date after startDate
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();

    for (let year = startYear; year <= endYear; year++) {
      const milestone = new Date(year, increaseDate.month, increaseDate.day);
      if (isAfterOrSame(milestone, startDate) && isBeforeOrSame(milestone, endDate)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Calculates bill amount with inflation and variables
   */
  private calculateBillAmount(bill: Bill, date: Date, simulation: string): number {
    let amount = bill.amount;

    // Handle variable amounts
    if (bill.amountIsVariable && bill.amountVariable) {
      const variableValue = loadVariable(bill.amountVariable, simulation);
      if (typeof variableValue === 'number') {
        amount = variableValue;
      }
    }

    // Apply ceilingMultiple if configured
    if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
      amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
    }

    // Apply inflation if configured
    if (bill.increaseBy && bill.increaseBy > 0) {
      const yearsDiff = this.yearIncreases(bill.startDate, date, bill.increaseByDate);
      for (let i = 0; i < yearsDiff; i++) {
        amount *= 1 + bill.increaseBy;
        // Apply ceilingMultiple if configured
        if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
          amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
        }
      }
    }

    return amount;
  }

  /**
   * Generates transfer bill events
   */
  private generateTransferBillEvents(accounts: Account[], transfer: Transfer, endDate: Date, simulation: string): void {
    if (!transfer.startDate || transfer.startDate > endDate) {
      return;
    }

    const fromAccount = accounts.find((acc) => acc.name === transfer.fro);
    const toAccount = accounts.find((acc) => acc.name === transfer.to);

    if (!fromAccount || !toAccount) {
      return;
    }

    let currentDate = transfer.startDate;
    let eventCount = 0;

    while (currentDate <= endDate && (!transfer.endDate || currentDate <= transfer.endDate)) {
      const amount = this.calculateTransferAmount(transfer, currentDate, simulation);

      const event: TransferEvent = {
        id: `transfer_${transfer.id}_${eventCount}`,
        type: EventType.transfer,
        date: new Date(currentDate),
        accountId: fromAccount.id, // Primary account for processing
        priority: 3, // Transfers after bills
        cacheable: true,
        dependencies: [toAccount.id], // Depends on destination account
        transfer,
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        amount,
      };

      this.addEvent(event);

      currentDate = nextDate(currentDate, transfer.periods, transfer.everyN);
      eventCount++;

      if (eventCount > 10000) {
        throw new Error(`Too many transfer events generated for transfer ${transfer.id}`);
      }
    }
  }

  /**
   * Calculates transfer amount with variables, inflation, and ceiling multiple
   */
  private calculateTransferAmount(transfer: Transfer, date: Date, simulation: string): number {
    let amount: number;

    // Handle string literal amounts first
    if (typeof transfer.amount === 'string') {
      switch (transfer.amount) {
        case '{HALF}':
          amount = 0.5; // Placeholder - will be resolved during processing
          break;
        case '{FULL}':
          amount = 1.0; // Placeholder - will be resolved during processing
          break;
        case '-{HALF}':
          amount = -0.5; // Placeholder - will be resolved during processing
          break;
        case '-{FULL}':
          amount = -1.0; // Placeholder - will be resolved during processing
          break;
        default:
          amount = 0;
      }
    } else {
      amount = transfer.amount;
    }

    if (transfer.amountIsVariable && transfer.amountVariable) {
      const variableValue = loadVariable(transfer.amountVariable, simulation);
      if (typeof variableValue === 'number') {
        amount = variableValue;
      } else if (typeof variableValue === 'string') {
        // Handle special fraction values from variables
        switch (variableValue) {
          case '{HALF}':
            amount = 0.5; // Placeholder - will be resolved during processing
            break;
          case '{FULL}':
            amount = 1.0; // Placeholder - will be resolved during processing
            break;
          case '-{HALF}':
            amount = -0.5; // Placeholder - will be resolved during processing
            break;
          case '-{FULL}':
            amount = -1.0; // Placeholder - will be resolved during processing
            break;
        }
      }
    }

    // Apply ceilingMultiple if configured
    if (typeof amount === 'number' && transfer.ceilingMultiple && transfer.ceilingMultiple > 0) {
      amount = Math.ceil(amount / transfer.ceilingMultiple) * transfer.ceilingMultiple;
    }

    // Apply inflation if configured (similar to original bill logic)
    if (transfer.increaseBy && transfer.increaseBy > 0) {
      const yearsDiff = this.yearIncreases(transfer.startDate, date, transfer.increaseByDate);
      for (let i = 0; i < yearsDiff; i++) {
        amount *= 1 + transfer.increaseBy;
        // Apply ceilingMultiple if configured
        if (typeof amount === 'number' && transfer.ceilingMultiple && transfer.ceilingMultiple > 0) {
          amount = Math.ceil(amount / transfer.ceilingMultiple) * transfer.ceilingMultiple;
        }
      }
    }

    return amount;
  }

  /**
   * Determines if inflation increase should be applied based on increaseByDate
   */
  private shouldApplyInflationIncrease(transfer: Transfer, currentDate: Date): boolean {
    if (!transfer.increaseByDate || !transfer.startDate) return false;

    // increaseByDate is an object with { day: number; month: number }
    const { day, month } = transfer.increaseByDate;

    // Get the increase date for the current year
    const currentYear = dayjs.utc(currentDate).year();
    const increaseDate = dayjs
      .utc()
      .year(currentYear)
      .month(month - 1)
      .date(day);

    // Check if current date is past the increase date and after start date
    return (
      dayjs.utc(currentDate).isAfter(increaseDate) && dayjs.utc(currentDate).isAfter(dayjs.utc(transfer.startDate))
    );
  }

  /**
   * Gets variable increase rate (like inflation rate)
   */
  private getVariableIncreaseRate(variable: string, simulation: string): number {
    const value = loadVariable(variable, simulation);
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Adds interest events to the timeline
   */
  private addInterestEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const account of accountsAndTransfers.accounts) {
      for (const interest of account.interests) {
        this.generateInterestEvents(account, interest, endDate);
      }
    }
  }

  /**
   * Generates interest application events
   */
  private generateInterestEvents(account: Account, interest: Interest, endDate: Date): void {
    if (!interest.applicableDate || interest.applicableDate > endDate) return;

    let currentDate = interest.applicableDate;
    let eventCount = 0;

    while (currentDate <= endDate && (!interest.endDate || currentDate <= interest.endDate)) {
      const event: InterestEvent = {
        id: `interest_${account.id}_${interest.id}_${eventCount}`,
        type: EventType.interest,
        date: new Date(currentDate),
        accountId: account.id,
        priority: 0, // Interest after transfers
        cacheable: true,
        dependencies: [],
        interest,
        rate: interest.apr,
        taxDeferred: account.type !== 'Checking' && account.type !== 'Savings',
      };

      this.addEvent(event);

      // Calculate next interest application date
      currentDate = nextDate(currentDate, interest.compounded, 1);
      eventCount++;

      if (eventCount > 10000) {
        throw new Error(`Too many interest events generated for interest ${interest.id}`);
      }
    }
  }

  /**
   * Adds transfer events to the timeline
   */
  private addTransferEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date, simulation: string): void {
    // Add manual transfer activities
    for (const transfer of accountsAndTransfers.transfers.activity) {
      if (transfer.date <= endDate && transfer.isTransfer) {
        // Find the accounts involved in the transfer
        const fromAccount = accountsAndTransfers.accounts.find((acc) => acc.name === transfer.fro);
        const toAccount = accountsAndTransfers.accounts.find((acc) => acc.name === transfer.to);

        // Only create transfer events if both accounts are present in our dataset
        // This prevents errors when testing with account subsets
        if (!fromAccount && !toAccount) {
          continue;
        }

        // Handle cases where only one account is present (partial transfer processing)
        let shouldProcessTransfer = false;
        let accountsToProcess: { account: any; isSource: boolean }[] = [];

        if (fromAccount) {
          accountsToProcess.push({ account: fromAccount, isSource: true });
          shouldProcessTransfer = true;
        }

        if (toAccount) {
          accountsToProcess.push({ account: toAccount, isSource: false });
          shouldProcessTransfer = true;
        }

        if (!shouldProcessTransfer) {
          continue;
        }

        // Create transfer events for each account that exists in our dataset
        for (const { account, isSource } of accountsToProcess) {
          const amount = isSource ? -(transfer.amount as number) : (transfer.amount as number);
          const eventId = isSource ? `transfer_from_${transfer.id}` : `transfer_to_${transfer.id}`;

          const transferEvent: ActivityEvent = {
            id: eventId,
            type: EventType.activity,
            date: transfer.date,
            accountId: account.id,
            priority: 1, // Same priority as activities
            cacheable: true,
            dependencies: [],
            activity: new ConsolidatedActivity({
              id: transfer.id,
              name: transfer.name,
              amount: amount,
              amountIsVariable: transfer.amountIsVariable,
              amountVariable: transfer.amountVariable,
              date: new Date(transfer.date),
              dateIsVariable: transfer.dateIsVariable,
              dateVariable: transfer.dateVariable,
              from: transfer.fro,
              to: transfer.to,
              isTransfer: true,
              category: transfer.category,
              flag: transfer.flag || false,
              flagColor: transfer.flagColor || null,
            }),
          };

          this.addEvent(transferEvent);
        }
      }
    }
  }

  /**
   * Adds monthly push/pull check events
   */
  private addPushPullEvents(startDate: Date, endDate: Date): void {
    let currentDate = dayjs.utc(startDate).startOf('month').toDate();
    let eventCount = 0;

    while (currentDate <= endDate) {
      const event: PushPullEvent = {
        id: `pushpull_${eventCount}`,
        type: EventType.pushPullCheck,
        date: new Date(currentDate),
        accountId: '', // Affects all accounts
        priority: 10, // Lowest priority - process last
        cacheable: false, // Cannot cache due to complex lookahead logic
        dependencies: [], // Depends on all accounts (handled specially)
        checkType: 'monthly',
      };

      this.addEvent(event);

      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;
    }
  }

  /**
   * Adds monthly month-end check events for retroactive balance analysis
   */
  private addMonthEndCheckEvents(accountsAndTransfers: AccountsAndTransfers, startDate: Date, endDate: Date): void {
    let currentDate = dayjs.utc(startDate).startOf('month').toDate();
    let eventCount = 0;

    // Find accounts that need push/pull management
    const managedAccounts = accountsAndTransfers.accounts
      .filter((account) => account.minimumBalance !== null || account.performsPulls || account.performsPushes)
      .map((account) => account.id);

    while (currentDate <= endDate) {
      const monthStart = new Date(currentDate);
      const monthEnd = dayjs.utc(currentDate).endOf('month').toDate();
      const actualMonthEnd = monthEnd > endDate ? endDate : monthEnd;

      const event: MonthEndCheckEvent = {
        id: `monthend_${eventCount}`,
        type: EventType.monthEndCheck,
        date: new Date(actualMonthEnd), // Process at month end
        accountId: '', // Affects all managed accounts
        priority: 10, // Lowest priority - process last
        cacheable: false, // Cannot cache due to retroactive logic
        dependencies: managedAccounts, // Depends on all managed accounts
        monthStart,
        monthEnd: actualMonthEnd,
        managedAccounts,
      };

      this.addEvent(event);

      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;
    }
  }

  /**
   * Adds an event to the timeline
   */
  private addEvent(event: TimelineEvent): void {
    this.events.push(event);
    this.eventIndex.set(event.id, event);

    // Add to date index
    const dateKey = dayjs.utc(event.date).format('YYYY-MM-DD');
    if (!this.dateIndex.has(dateKey)) {
      this.dateIndex.set(dateKey, []);
    }
    this.dateIndex.get(dateKey)!.push(event);
  }

  /**
   * Sorts events by date and priority
   */
  private sortEvents(): void {
    this.events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;

      // Same date - sort by priority
      return a.priority - b.priority;
    });

    // Re-index after sorting
    this.rebuildIndices();
  }

  /**
   * Rebuilds the event indices after modifications
   */
  private rebuildIndices(): void {
    this.eventIndex.clear();
    this.dateIndex.clear();

    for (const event of this.events) {
      this.eventIndex.set(event.id, event);

      const dateKey = dayjs.utc(event.date).format('YYYY-MM-DD');
      if (!this.dateIndex.has(dateKey)) {
        this.dateIndex.set(dateKey, []);
      }
      this.dateIndex.get(dateKey)!.push(event);
    }
  }

  /**
   * Creates calculation segments for optimized processing
   */
  private createSegments(startDate: Date, endDate: Date): void {
    const segmentSize = 'month'; // Create monthly segments
    let currentStart = dayjs.utc(startDate).startOf(segmentSize).toDate();
    let segmentCount = 0;

    while (currentStart <= endDate) {
      const currentEnd = dayjs.utc(currentStart).endOf(segmentSize).toDate();
      const actualEnd = currentEnd > endDate ? endDate : currentEnd;

      const segmentEvents = this.getEventsInRange(currentStart, actualEnd);
      // For TransferEvents, we need both fromAccountId and toAccountId in affectedAccounts
      const affectedAccounts = new Set<string>();
      for (const event of segmentEvents) {
        if (event.accountId) {
          affectedAccounts.add(event.accountId);
        }
        // Add transfer-specific account IDs
        if (event.type === EventType.transfer) {
          const transferEvent = event as TransferEvent;
          if (transferEvent.fromAccountId) affectedAccounts.add(transferEvent.fromAccountId);
          if (transferEvent.toAccountId) affectedAccounts.add(transferEvent.toAccountId);
        }
      }

      const segment: CalculationSegment = {
        id: `segment_${segmentCount}`,
        startDate: new Date(currentStart),
        endDate: new Date(actualEnd),
        events: segmentEvents,
        affectedAccounts,
        dependencies: this.calculateSegmentDependencies(segmentEvents),
        cached: false,
        cacheKey: this.generateSegmentCacheKey(segmentEvents),
      };

      this.segments.push(segment);
      currentStart = dayjs.utc(currentStart).add(1, segmentSize).toDate();
      segmentCount++;
    }
  }

  /**
   * Calculates dependencies for a segment
   */
  private calculateSegmentDependencies(events: TimelineEvent[]): string[] {
    const dependencies = new Set<string>();

    for (const event of events) {
      for (const dep of event.dependencies) {
        dependencies.add(dep);
      }
    }

    return Array.from(dependencies);
  }

  /**
   * Generates a cache key for a segment using a hash to prevent long filenames
   */
  private generateSegmentCacheKey(events: TimelineEvent[]): string {
    if (events.length === 0) {
      return 'empty';
    }

    // Create a compact representation for hashing
    const eventSummary = events.map((e) => `${e.type}_${e.date.getTime()}_${e.accountId || ''}`).join('|');

    // Generate a short hash to prevent filesystem length issues
    const hash = crypto.createHash('sha256').update(eventSummary).digest('hex').substring(0, 16); // Use first 16 characters for reasonable uniqueness

    // Include event count and date range for debugging
    const startDate = Math.min(...events.map((e) => e.date.getTime()));
    const endDate = Math.max(...events.map((e) => e.date.getTime()));

    return `${events.length}evt_${startDate}_${endDate}_${hash}`;
  }

  /**
   * Gets all events in the timeline
   */
  getEvents(): TimelineEvent[] {
    return [...this.events];
  }

  /**
   * Gets events for a specific date
   */
  getEventsForDate(date: Date): TimelineEvent[] {
    const dateKey = dayjs.utc(date).format('YYYY-MM-DD');
    return this.dateIndex.get(dateKey) || [];
  }

  /**
   * Gets events in a date range
   */
  getEventsInRange(startDate: Date, endDate: Date): TimelineEvent[] {
    return this.events.filter((event) => event.date >= startDate && event.date <= endDate);
  }

  /**
   * Gets events for a specific account
   */
  getEventsForAccount(accountId: string): TimelineEvent[] {
    return this.events.filter((event) => event.accountId === accountId || event.dependencies.includes(accountId));
  }

  /**
   * Gets calculation segments
   */
  getSegments(): CalculationSegment[] {
    return [...this.segments];
  }

  /**
   * Gets a specific event by ID
   */
  getEvent(eventId: string): TimelineEvent | undefined {
    return this.eventIndex.get(eventId);
  }

  /**
   * Gets the total number of events
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Gets events by type
   */
  getEventsByType(type: EventType): TimelineEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  /**
   * Adds events retroactively and maintains proper ordering
   */
  addRetroactiveEvents(events: TimelineEvent[]): void {
    debug('Timeline.addRetroactiveEvents', 'Adding retroactive events', {
      eventCount: events.length,
    });

    // Add events using the private addEvent method
    for (const event of events) {
      this.addEvent(event);
    }

    // Re-sort and rebuild indices to maintain proper ordering
    this.sortEvents();

    debug('Timeline.addRetroactiveEvents', 'Completed adding retroactive events', {
      totalEvents: this.events.length,
    });
  }

  /**
   * Validates the timeline for consistency
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for duplicate event IDs
    const eventIds = new Set<string>();
    for (const event of this.events) {
      if (eventIds.has(event.id)) {
        errors.push(`Duplicate event ID: ${event.id}`);
      }
      eventIds.add(event.id);
    }

    // Check that events are sorted
    for (let i = 1; i < this.events.length; i++) {
      const prev = this.events[i - 1];
      const curr = this.events[i];

      if (prev.date > curr.date || (prev.date.getTime() === curr.date.getTime() && prev.priority > curr.priority)) {
        errors.push(`Events not properly sorted at index ${i}`);
        break;
      }
    }

    // Check segment coverage
    if (this.segments.length > 0) {
      for (let i = 1; i < this.segments.length; i++) {
        const prev = this.segments[i - 1];
        const curr = this.segments[i];

        if (prev.endDate >= curr.startDate) {
          errors.push(`Overlapping segments: ${prev.id} and ${curr.id}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gets performance statistics about the timeline
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<EventType, number>;
    dateRange: { start: Date; end: Date } | null;
    segmentCount: number;
    cacheableEvents: number;
  } {
    if (this.events.length === 0) {
      return {
        totalEvents: 0,
        eventsByType: {} as Record<EventType, number>,
        dateRange: null,
        segmentCount: 0,
        cacheableEvents: 0,
      };
    }

    const eventsByType: Record<EventType, number> = {} as Record<EventType, number>;
    let cacheableEvents = 0;

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      if (event.cacheable) cacheableEvents++;
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      dateRange: {
        start: this.events[0].date,
        end: this.events[this.events.length - 1].date,
      },
      segmentCount: this.segments.length,
      cacheableEvents,
    };
  }
}
