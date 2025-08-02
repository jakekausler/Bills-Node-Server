import {
  CalculationOptions,
  Segment,
  SegmentResult,
  EventType,
  ActivityEvent,
  BillEvent,
  InterestEvent,
  ActivityTransferEvent,
  BillTransferEvent,
  PensionEvent,
  SocialSecurityEvent,
  TaxEvent,
  RMDEvent,
  TimelineEvent,
} from './types';
import { CacheManager } from './cache';
import { BalanceTracker } from './balance-tracker';
import { Calculator } from './calculator';
import { PushPullHandler } from './push-pull-handler';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import dayjs from 'dayjs';
import { warn } from '../calculate-v2/logger';

export class SegmentProcessor {
  private cache: CacheManager;
  private balanceTracker: BalanceTracker;
  private calculator: Calculator;
  private pushPullHandler: PushPullHandler;

  constructor(
    cache: CacheManager,
    balanceTracker: BalanceTracker,
    calculator: Calculator,
    pushPullHandler: PushPullHandler,
  ) {
    this.cache = cache;
    this.balanceTracker = balanceTracker;
    this.calculator = calculator;
    this.pushPullHandler = pushPullHandler;
  }

  async getCachedSegmentResult(segment: Segment): Promise<SegmentResult | null> {
    if (!segment.cached) return null;
    const cacheKey = this.generateSegmentCacheKey(segment);
    return await this.cache.get(cacheKey);
  }

  async cacheSegmentResult(segment: Segment, segmentResult: SegmentResult): Promise<void> {
    const cacheKey = this.generateSegmentCacheKey(segment);
    await this.cache.set(cacheKey, segmentResult);
  }

  private generateSegmentCacheKey(segment: Segment): string {
    return `segment_${segment.id}_${segment.cacheKey}`;
  }

  async processSegment(segment: Segment, options: CalculationOptions): Promise<void> {
    if (!this.balanceTracker) {
      throw new Error('Balance tracker not initialized');
    }

    // Check if segment result is cached
    if (!options.forceRecalculation) {
      const cachedResult = await this.getCachedSegmentResult(segment);
      if (cachedResult) {
        this.balanceTracker.applySegmentResult(cachedResult, segment.startDate);
        return;
      }
    }

    // Process events in the segment
    let segmentResult = this.processSegmentEvents(segment, options);

    // Deal with pushes and pulls
    const pushPullEventsAdded = this.pushPullHandler.handleAccountPushPulls(segmentResult, segment);

    // If a push or pull was added, reprocess the segment events
    if (pushPullEventsAdded) {
      segmentResult = this.processSegmentEvents(segment, options);
    }

    // Cache the segment result
    await this.cacheSegmentResult(segment, segmentResult);

    // Apply the result to balance tracker
    this.balanceTracker.applySegmentResult(segmentResult, segment.startDate);
  }

  private processSegmentEvents(segment: Segment, options: CalculationOptions): SegmentResult {
    const segmentResult: SegmentResult = {
      balanceChanges: new Map<string, number>(),
      activitiesAdded: new Map<string, ConsolidatedActivity[]>(),
      processedEventIds: new Set<string>(),
      balanceMinimums: new Map<string, number>(),
      balanceMaximums: new Map<string, number>(),
    };

    // Group events by date for efficient processing
    const eventsByDate = this.groupEventsByDate(segment.events);

    // Get the initial balance for each affected account (before this segment)
    const currentBalances = new Map<string, number>();
    for (const accountId of segment.affectedAccountIds) {
      currentBalances.set(accountId, this.balanceTracker.getAccountBalance(accountId));
    }

    for (const [_, dayEvents] of [...eventsByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      // Process events for this date
      const dayBalanceChanges = this.processDayEvents(dayEvents, options, segmentResult);

      // Update current and minimum/maximum balances
      for (const [accountId, change] of dayBalanceChanges) {
        const currentBalance = currentBalances.get(accountId) || 0;
        const newBalance = currentBalance + change;

        // Track minimum and maximum balances
        const minBalance = segmentResult.balanceMinimums.get(accountId) || newBalance;
        const maxBalance = segmentResult.balanceMaximums.get(accountId) || newBalance;

        segmentResult.balanceMinimums.set(accountId, Math.min(minBalance, newBalance));
        segmentResult.balanceMaximums.set(accountId, Math.max(maxBalance, newBalance));

        // Update current balance for next iteration
        currentBalances.set(accountId, newBalance);
      }
    }

    return segmentResult;
  }

  private groupEventsByDate(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
    const eventsByDate = new Map<string, TimelineEvent[]>();

    for (const event of events) {
      const dateKey = dayjs.utc(event.date).format('YYYY-MM-DD');

      if (!eventsByDate.has(dateKey)) {
        eventsByDate.set(dateKey, []);
      }

      eventsByDate.get(dateKey)!.push(event);
    }

    return eventsByDate;
  }

  /**
   * Processes events for a single day
   * @param events - Events for the day
   * @param options - Calculation options
   * @param segmentResult - Result object to store changes
   * @returns Map of accountId to total balance change for the day
   */
  private processDayEvents(
    events: TimelineEvent[],
    options: CalculationOptions,
    segmentResult: SegmentResult,
  ): Map<string, number> {
    // Sort events by priority
    const sortedEvents = [...events].sort((a, b) => a.priority - b.priority);
    const dayBalanceChanges = new Map<string, number>();
    for (const event of sortedEvents) {
      const balanceChanges = this.processEvent(event, options, segmentResult);
      // Merge balance changes into the day's total
      for (const [accountId, change] of balanceChanges.entries()) {
        const currentChange = dayBalanceChanges.get(accountId) || 0;
        dayBalanceChanges.set(accountId, currentChange + change);
      }
      segmentResult.processedEventIds.add(event.id);
    }
    return dayBalanceChanges;
  }

  /**
   * Processes a single event
   * @param event - The event to process
   * @param options - Calculation options
   * @param segmentResult - Result object to store changes
   * @return Map of accountId to balance change for the event
   */
  private processEvent(
    event: TimelineEvent,
    options: CalculationOptions,
    segmentResult: SegmentResult,
  ): Map<string, number> {
    if (!this.calculator) {
      throw new Error('Calculator not initialized');
    }
    switch (event.type) {
      case EventType.activity:
        return this.calculator.processActivityEvent(event as ActivityEvent, segmentResult);
      case EventType.bill:
        return this.calculator.processBillEvent(event as BillEvent, segmentResult, options.simulation);
      case EventType.interest:
        return this.calculator.processInterestEvent(event as InterestEvent, segmentResult);
      case EventType.activityTransfer:
        return this.calculator.processActivityTransferEvent(event as ActivityTransferEvent, segmentResult);
      case EventType.billTransfer:
        return this.calculator.processBillTransferEvent(event as BillTransferEvent, segmentResult);
      case EventType.pension:
        return this.calculator.processPensionEvent(event as PensionEvent, segmentResult);
      case EventType.socialSecurity:
        return this.calculator.processSocialSecurityEvent(event as SocialSecurityEvent, segmentResult);
      case EventType.tax:
        return this.calculator.processTaxEvent(event as TaxEvent, segmentResult);
      case EventType.rmd:
        return this.calculator.processRMDEvent(event as RMDEvent, segmentResult);
      default:
        warn(`Unknown event type: ${event.type}`);
        return new Map<string, number>();
    }
  }
}
