import dayjs from 'dayjs';
import crypto from 'crypto';
import { AccountsAndTransfers } from '../../data/account/types';
import {
  ActivityEvent,
  ActivityTransferEvent,
  BillEvent,
  BillTransferEvent,
  EventType,
  InterestEvent,
  Segment,
  TimelineEvent,
  TransferEvent,
} from './types';
import { Account } from '../../data/account/account';
import { Bill } from '../../data/bill/bill';
import { Interest } from '../../data/interest/interest';
import { nextDate } from '../calculate/helpers';
import { isAfterOrSame, isBeforeOrSame, isSame } from '../date/date';
import { warn } from '../calculate-v2/logger';

export class Timeline {
  private events: TimelineEvent[];
  private segments: Segment[];
  private eventIndex: Map<string, TimelineEvent>;
  private dateIndex: Map<string, TimelineEvent[]>;
  private accountNameMap: Map<string, Account>;
  private accountIdMap: Map<string, Account>;

  constructor() {
    this.events = [];
    this.segments = [];
    this.eventIndex = new Map();
    this.dateIndex = new Map();
    this.accountNameMap = new Map();
    this.accountIdMap = new Map();
  }

  static fromAccountsAndTransfers(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
  ): Timeline {
    const timeline = new Timeline();

    // Create account map
    timeline.accountNameMap = new Map(accountsAndTransfers.accounts.map((account) => [account.name, account]));
    timeline.accountIdMap = new Map(accountsAndTransfers.accounts.map((account) => [account.id, account]));

    // Add activity events
    timeline.addActivityEvents(accountsAndTransfers, endDate);

    // Add bill events
    timeline.addBillEvents(accountsAndTransfers, endDate);

    // Add interest events
    timeline.addInterestEvents(accountsAndTransfers, endDate);

    // Add transfer events
    timeline.addTransferActivityEvents(accountsAndTransfers, endDate);
    timeline.addTransferBillEvents(accountsAndTransfers, endDate);

    // Sort and optimize timeline
    timeline.sortEvents();
    timeline.createSegments(startDate, endDate);

    return timeline;
  }

  /**************************************************
   * ADD EVENTS
   **************************************************/

  /**
   * Adds manual activity events to the timeline
   * Excludes transfer activities since they're handled separately in addTransferEvents method
   */
  private addActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const account of accountsAndTransfers.accounts) {
      for (const activity of account.activity) {
        if (activity.isTransfer) {
          continue;
        }

        if (activity.date <= endDate) {
          const event: ActivityEvent = {
            id: `activity_${account.id}_${activity.id}`,
            type: EventType.activity,
            date: activity.date,
            accountId: account.id,
            priority: 1,
            originalActivity: activity,
          };

          this.addEvent(event);
        }
      }
    }
  }

  private addBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const account of accountsAndTransfers.accounts) {
      for (const bill of account.bills) {
        this.generateBillEvents(account, bill, endDate);
      }
    }
  }

  private addInterestEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const account of accountsAndTransfers.accounts) {
      this.generateInterestEvents(account, account.interests, endDate);
    }
  }

  private addTransferActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const activity of accountsAndTransfers.transfers.activity) {
      if (activity.date <= endDate && activity.isTransfer) {
        if (!activity.fro || !activity.to) {
          warn('Transfer activity has no from or to account on the activity', activity);
          continue;
        }
        const fromAccount = this.accountNameMap.get(activity.fro);
        const toAccount = this.accountNameMap.get(activity.to);
        if (!fromAccount && !toAccount) {
          warn('Transfer activity has no from or to account on the account map', activity);
          continue;
        }

        // Handle cases where only one account is present (partial transfer processing)
        let shouldProcessTransfer = false;
        let accountsToProcess: { account: Account; isSource: boolean }[] = [];

        if (fromAccount) {
          accountsToProcess.push({ account: fromAccount, isSource: true });
          shouldProcessTransfer = true;
        }

        if (toAccount) {
          accountsToProcess.push({ account: toAccount, isSource: false });
          shouldProcessTransfer = true;
        }

        if (!shouldProcessTransfer) {
          warn('Transfer activity should not be processed', activity);
          continue;
        }

        const event: ActivityTransferEvent = {
          id: `transfer_${activity.id}_from_${fromAccount?.id}_to_${toAccount?.id}`,
          type: EventType.activityTransfer,
          fromAccountId: this.accountNameMap.get(activity.fro)?.id || '',
          toAccountId: this.accountNameMap.get(activity.to)?.id || '',
          date: activity.date,
          accountId: fromAccount?.id || toAccount?.id || '',
          originalActivity: activity,
          priority: 1,
        };

        this.addEvent(event);
      }
    }
  }

  private addTransferBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): void {
    for (const bill of accountsAndTransfers.transfers.bills) {
      this.generateTransferBillEvents(bill, endDate);
    }
  }

  /**************************************************
   * GENERATE EVENTS
   **************************************************/

  private generateBillEvents(account: Account, bill: Bill, endDate: Date): void {
    // Don't generate events for bills that start after the end date
    if (!bill.startDate || bill.startDate > endDate) return;

    let currentDate = bill.startDate;
    let eventCount = 0;

    // Calculate bill occurrences up to end date
    while (currentDate <= endDate && (!bill.endDate || currentDate <= bill.endDate)) {
      const event: BillEvent = {
        id: `bill_${account.id}_${bill.id}_${eventCount}`,
        type: EventType.bill,
        date: new Date(currentDate),
        accountId: account.id,
        priority: 2,
        originalBill: bill,
        amount: this.calculateBillAmount(bill, currentDate),
        firstBill: eventCount === 0,
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

  private generateInterestEvents(account: Account, interests: Interest[], endDate: Date): void {
    let nextApplicableDate = endDate;
    for (let i = 0; i < account.interests.length; i++) {
      if (interests[i + 1]) {
        nextApplicableDate = interests[i + 1].applicableDate;
      } else {
        nextApplicableDate = endDate;
      }
      const interest = interests[i];
      let currentDate = interest.applicableDate;
      let eventCount = 0;
      while (currentDate <= nextApplicableDate) {
        const event: InterestEvent = {
          id: `interest_${account.id}_${interest.id}_${eventCount}`,
          type: EventType.interest,
          date: new Date(currentDate),
          accountId: account.id,
          priority: 0,
          originalInterest: interest,
          rate: interest.apr,
          firstInterest: eventCount === 0,
        };

        this.addEvent(event);

        // Calculate next interest application date
        currentDate = nextDate(currentDate, interest.compounded, 1);
        eventCount++;

        // Safety check to prevent infinite loops
        if (eventCount > 10000) {
          throw new Error(`Too many interest events generated for interest ${interest.id}`);
        }
      }
    }
  }

  private generateTransferBillEvents(bill: Bill, endDate: Date): void {
    // Don't generate events for bills that start after the end date
    if (!bill.startDate || bill.startDate > endDate) return;

    let currentDate = bill.startDate;
    let eventCount = 0;

    if (!bill.fro || !bill.to) {
      return;
    }

    const fromAccount = this.accountNameMap.get(bill.fro);
    const toAccount = this.accountNameMap.get(bill.to);

    if (!fromAccount && !toAccount) {
      return;
    }

    // Handle cases where only one account is present (partial transfer processing)
    let shouldProcessTransfer = false;
    let accountsToProcess: { account: Account; isSource: boolean }[] = [];

    if (fromAccount) {
      accountsToProcess.push({ account: fromAccount, isSource: true });
      shouldProcessTransfer = true;
    }

    if (toAccount) {
      accountsToProcess.push({ account: toAccount, isSource: false });
      shouldProcessTransfer = true;
    }

    if (!shouldProcessTransfer) {
      return;
    }

    // Calculate bill occurrences up to end date
    while (currentDate <= endDate && (!bill.endDate || currentDate <= bill.endDate)) {
      const event: BillTransferEvent = {
        id: `bill_from_${fromAccount?.id}_to_${toAccount?.id}_${bill.id}_${eventCount}`,
        type: EventType.billTransfer,
        date: new Date(currentDate),
        accountId: fromAccount?.id || toAccount?.id || '',
        priority: 2,
        originalBill: bill,
        amount: this.calculateBillAmount(bill, currentDate),
        fromAccountId: this.accountNameMap.get(bill.fro)?.id || '',
        toAccountId: this.accountNameMap.get(bill.to)?.id || '',
        firstBill: isSame(currentDate, bill.startDate),
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

  /**************************************************
   * HELPERS
   **************************************************/

  private yearIncreases(startDate: Date, endDate: Date, increaseDate: { day: number; month: number }): number {
    let count = 0;

    // Start from the first possible increase date after startDate
    const startYear = startDate.getUTCFullYear();

    // End at the last possible increase date before endDate
    const endYear = endDate.getUTCFullYear();

    // Count the number of years between startDate and endDate that have the increase date
    for (let year = startYear; year <= endYear; year++) {
      const milestone = new Date(year, increaseDate.month, increaseDate.day);
      if (isAfterOrSame(milestone, startDate) && isBeforeOrSame(milestone, endDate)) {
        count++;
      }
    }
    return count;
  }

  private calculateBillAmount(bill: Bill, currentDate: Date): number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}' {
    // If the amount is a special value, return it
    if (
      bill.amount === '{HALF}' ||
      bill.amount === '-{HALF}' ||
      bill.amount === '{FULL}' ||
      bill.amount === '-{FULL}'
    ) {
      return bill.amount;
    }

    let amount = bill.amount;

    // Apply ceilingMultiple if configured
    if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
      amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
    }

    // Apply inflation if configured
    if (bill.increaseBy && bill.increaseBy > 0) {
      const yearsDiff = this.yearIncreases(bill.startDate, currentDate, bill.increaseByDate);
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

  private addEvent(event: TimelineEvent): void {
    this.events.push(event);
    this.eventIndex.set(event.id, event);

    const dateKey = dayjs.utc(event.date).format('YYYY-MM-DD');
    if (!this.dateIndex.has(dateKey)) {
      this.dateIndex.set(dateKey, []);
    }
  }

  private sortEvents(): void {
    this.events.sort((a, b) => {
      const dateDiff = dayjs(a.date).diff(b.date, 'day');
      if (dateDiff !== 0) return dateDiff;

      // Same date - sort by priority
      return a.priority - b.priority;
    });

    // Re-index after sorting
    this.rebuildIndices();
  }

  private rebuildIndices(): void {
    this.eventIndex.clear();
    this.dateIndex.clear();

    for (const event of this.events) {
      this.eventIndex.set(event.id, event);

      const dateKey = dayjs.utc(event.date).format('YYYY-MM-DD');
      if (!this.dateIndex.has(dateKey)) {
        this.dateIndex.set(dateKey, []);
      }
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
      const affectedAccountIds = new Set<string>();
      for (const event of segmentEvents) {
        if (event.accountId) {
          affectedAccountIds.add(event.accountId);
        }
        // Add transfer-specific account IDs
        if (event.type === EventType.activityTransfer || event.type === EventType.billTransfer) {
          const transferEvent = event as unknown as TransferEvent;
          if (transferEvent.fromAccountId) affectedAccountIds.add(transferEvent.fromAccountId);
          if (transferEvent.toAccountId) affectedAccountIds.add(transferEvent.toAccountId);
        }
      }

      const segment: Segment = {
        id: `segment_${segmentCount}`,
        startDate: new Date(currentStart),
        endDate: new Date(actualEnd),
        events: segmentEvents,
        affectedAccountIds,
        cached: false,
        cacheKey: this.generateSegmentCacheKey(segmentEvents),
      };

      this.segments.push(segment);
      currentStart = dayjs.utc(currentStart).add(1, segmentSize).toDate();
      segmentCount++;
    }
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

  getEventsInRange(startDate: Date, endDate: Date): TimelineEvent[] {
    return this.events.filter((event) => event.date >= startDate && event.date <= endDate);
  }

  getSegments(): Segment[] {
    return [...this.segments];
  }

  getAccountByName(name: string): Account | undefined {
    return this.accountNameMap.get(name);
  }

  getAccountById(id: string): Account | undefined {
    return this.accountIdMap.get(id);
  }
}
