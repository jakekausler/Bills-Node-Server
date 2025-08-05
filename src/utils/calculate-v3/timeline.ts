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
  PensionEvent,
  RMDEvent,
  Segment,
  SocialSecurityEvent,
  TaxEvent,
  TimelineEvent,
  TransferEvent,
} from './types';
import { Account } from '../../data/account/account';
import { Bill } from '../../data/bill/bill';
import { Interest } from '../../data/interest/interest';
import { nextDate } from '../calculate/helpers';
import { isAfterOrSame, isBeforeOrSame, isSame } from '../date/date';
import { warn } from '../calculate-v2/logger';
import { AccountManager } from './account-manager';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';

export class Timeline {
  private accountManager: AccountManager;
  private events: TimelineEvent[];
  private segments: Segment[];
  private eventIndex: Map<string, TimelineEvent>;
  private dateIndex: Map<string, TimelineEvent[]>;
  private calculationBegin: number;
  private enableLogging: boolean;

  constructor(accountManager: AccountManager, calculationBegin: number, enableLogging: boolean) {
    this.accountManager = accountManager;
    this.events = [];
    this.segments = [];
    this.eventIndex = new Map();
    this.dateIndex = new Map();
    this.calculationBegin = calculationBegin;
    this.enableLogging = enableLogging;
  }

  static async fromAccountsAndTransfers(
    accountManager: AccountManager,
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
    calculationBegin: number,
    enableLogging: boolean,
  ): Promise<Timeline> {
    const timeline = new Timeline(accountManager, calculationBegin, enableLogging);

    // Parallelize all independent add* method calls
    await Promise.all([
      timeline.addActivityEvents(accountsAndTransfers, endDate),
      timeline.addBillEvents(accountsAndTransfers, endDate),
      timeline.addInterestEvents(accountsAndTransfers, endDate),
      timeline.addTransferActivityEvents(accountsAndTransfers, endDate),
      timeline.addTransferBillEvents(accountsAndTransfers, endDate),
      timeline.addSocialSecurityEvents(endDate),
      timeline.addPensionEvents(endDate),
      timeline.addRmdEvents(accountsAndTransfers, startDate, endDate),
      timeline.addTaxEvents(accountsAndTransfers, startDate, endDate),
    ]);

    // Sort and optimize timeline
    if (enableLogging) {
      console.log('  Sorting events', Date.now() - timeline.calculationBegin, 'ms');
    }
    timeline.sortEvents();
    if (enableLogging) {
      console.log('  Creating segments', Date.now() - timeline.calculationBegin, 'ms');
    }
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
  private async addActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
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
    if (this.enableLogging) {
      console.log('  Finished adding activity events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    for (const account of accountsAndTransfers.accounts) {
      for (const bill of account.bills) {
        this.generateBillEvents(account, bill, endDate);
      }
    }
    if (this.enableLogging) {
      console.log('  Finished adding bill events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addInterestEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    for (const account of accountsAndTransfers.accounts) {
      this.generateInterestEvents(account, account.interests, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding interest events');
    }
  }

  private async addTransferActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    for (const activity of accountsAndTransfers.transfers.activity) {
      if (activity.date <= endDate && activity.isTransfer) {
        if (!activity.fro || !activity.to) {
          warn('Transfer activity has no from or to account on the activity', activity);
          continue;
        }
        const fromAccount = this.accountManager.getAccountByName(activity.fro);
        const toAccount = this.accountManager.getAccountByName(activity.to);
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
          fromAccountId: fromAccount?.id || '',
          toAccountId: toAccount?.id || '',
          date: activity.date,
          accountId: fromAccount?.id || toAccount?.id || '',
          originalActivity: activity,
          priority: 1,
        };

        this.addEvent(event);
      }
    }
    if (this.enableLogging) {
      console.log('  Finished adding transfer activity events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addTransferBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    for (const bill of accountsAndTransfers.transfers.bills) {
      this.generateTransferBillEvents(bill, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding transfer bill events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addSocialSecurityEvents(endDate: Date): Promise<void> {
    for (const socialSecurity of this.accountManager.getSocialSecurities()) {
      this.generateSocialSecurityEvents(socialSecurity, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding social security events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addPensionEvents(endDate: Date): Promise<void> {
    for (const pension of this.accountManager.getPensions()) {
      this.generatePensionEvents(pension, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding pension events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addRmdEvents(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    for (const account of accountsAndTransfers.accounts) {
      this.generateRmdEvents(account, startDate, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding RMD events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addTaxEvents(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    for (const account of accountsAndTransfers.accounts) {
      this.generateTaxEvents(account, startDate, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding tax events', Date.now() - this.calculationBegin, 'ms');
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

    const fromAccount = this.accountManager.getAccountByName(bill.fro);
    const toAccount = this.accountManager.getAccountByName(bill.to);

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
        fromAccountId: fromAccount?.id || '',
        toAccountId: toAccount?.id || '',
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

  private generateSocialSecurityEvents(socialSecurity: SocialSecurity, endDate: Date): void {
    if (!socialSecurity.startDate || socialSecurity.startDate > endDate) {
      return;
    }

    // Find the account to pay to
    const payToAccount = this.accountManager.getAccountByName(socialSecurity.payToAcccount);
    if (!payToAccount) {
      warn(`Social Security pay to account ${socialSecurity.payToAcccount} not found`);
      return;
    }

    // Add events monthly starting from the start date
    let currentDate = socialSecurity.startDate;
    let eventCount = 0;
    while (currentDate <= endDate) {
      // Calculate the age at the current date
      const ownerAge = dayjs.utc(currentDate).diff(socialSecurity.birthDate, 'year');

      // Create the Social Security event
      const event: SocialSecurityEvent = {
        id: `social_security_${socialSecurity.name}_${eventCount}`,
        type: EventType.socialSecurity,
        date: new Date(currentDate),
        accountId: payToAccount.id,
        socialSecurity,
        ownerAge: ownerAge,
        priority: 2,
        firstPayment: eventCount === 0, // Mark the first payment
      };

      this.addEvent(event);

      // Move to the next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many Social Security events generated for ${socialSecurity.name}`);
      }
    }
  }

  private generatePensionEvents(pension: Pension, endDate: Date): void {
    if (!pension.startDate || pension.startDate > endDate) {
      return;
    }

    // Find the account to pay to
    const payToAccount = this.accountManager.getAccountByName(pension.payToAcccount);
    if (!payToAccount) {
      warn(`Pension pay to account ${pension.payToAcccount} not found`);
      return;
    }

    // Add events monthly starting from the start date
    let currentDate = pension.startDate;
    let eventCount = 0;
    while (currentDate <= endDate) {
      // Calculate the age at the current date
      const ownerAge = dayjs.utc(currentDate).diff(pension.birthDate, 'year');

      // Create the Pension event
      const event: PensionEvent = {
        id: `pension_${pension.name}_${eventCount}`,
        type: EventType.pension,
        date: new Date(currentDate),
        accountId: payToAccount.id,
        pension,
        ownerAge: ownerAge,
        priority: 2,
        firstPayment: eventCount === 0, // Mark the first payment
      };

      this.addEvent(event);

      // Move to the next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many Social Security events generated for ${pension.name}`);
      }
    }
  }

  private generateRmdEvents(account: Account, startDate: Date, endDate: Date): void {
    // Transfer RMDs on December 31st
    const RMD_MONTH = 12;
    const RMD_DAY = 31;

    // Check if the account has RMD enabled
    if (!account.usesRMD || !account.rmdAccount || !account.accountOwnerDOB) {
      return;
    }

    // Add RMD event for each year in the range
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();
    for (let year = startYear; year <= endYear; year++) {
      const rmdDate = new Date(Date.UTC(year, RMD_MONTH - 1, RMD_DAY));
      if (isAfterOrSame(rmdDate, startDate) && isBeforeOrSame(rmdDate, endDate)) {
        const event: RMDEvent = {
          id: `rmd_${account.id}_${year}`,
          type: EventType.rmd,
          date: rmdDate,
          accountId: account.id,
          ownerAge: dayjs.utc(rmdDate).diff(account.accountOwnerDOB, 'year'),
          fromAccountId: account.id,
          toAccountId: this.accountManager.getAccountByName(account.rmdAccount)?.id || '',
          priority: 3,
        };
        this.addEvent(event);
      }
    }
  }

  private generateTaxEvents(account: Account, startDate: Date, endDate: Date): void {
    // Pay taxes on March 1st
    const TAX_MONTH = 3;
    const TAX_DAY = 1;

    // Might pay taxes if the account performs pulls or is an interest-paying account
    const paysTaxes = account.performsPulls || this.accountManager.getInterestPayAccountNames().has(account.name);
    if (!paysTaxes) {
      return;
    }

    // Add tax event for each year in the range
    const startYear = Math.max(new Date().getUTCFullYear(), startDate.getUTCFullYear());
    const endYear = endDate.getUTCFullYear();

    for (let year = startYear; year <= endYear; year++) {
      const taxDate = new Date(Date.UTC(year, TAX_MONTH - 1, TAX_DAY));
      if (isAfterOrSame(taxDate, startDate) && isBeforeOrSame(taxDate, endDate)) {
        const event: TaxEvent = {
          id: `tax_${account.id}_${year}`,
          type: EventType.tax,
          date: taxDate,
          accountId: account.id,
          priority: 3,
        };
        this.addEvent(event);
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
   * Takes advantage of the fact that events are already sorted by date
   */
  private createSegments(startDate: Date, endDate: Date): void {
    const segmentSize = 'month'; // Create monthly segments
    let currentStart = dayjs.utc(startDate).startOf(segmentSize).toDate();
    let segmentCount = 0;
    let eventIndex = 0; // Track our position in the sorted events array

    while (currentStart <= endDate) {
      const currentEnd = dayjs.utc(currentStart).endOf(segmentSize).toDate();
      const actualEnd = currentEnd > endDate ? endDate : currentEnd;

      const segmentEvents: TimelineEvent[] = [];
      const affectedAccountIds = new Set<string>();

      // Since events are sorted, we can iterate from where we left off
      while (eventIndex < this.events.length) {
        const event = this.events[eventIndex];

        // If event is past the current segment, stop looking
        if (event.date > actualEnd) {
          break;
        }

        // If event is within the current segment, add it
        if (event.date >= currentStart && event.date <= actualEnd) {
          segmentEvents.push(event);

          // Track affected accounts
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

        // Move to next event only if it's within or before the current segment
        if (event.date <= actualEnd) {
          eventIndex++;
        } else {
          break;
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
}
