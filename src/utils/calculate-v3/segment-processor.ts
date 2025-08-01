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
        this.balanceTracker.applySegmentResult(cachedResult);
        return;
      }
    }

    // Process events in the segment
    let segmentResult = this.processSegmentEvents(segment.events, options);

    // Deal with pushes and pulls
    const pushPullEventsAdded = this.pushPullHandler.handleAccountPushPulls(segmentResult, segment);

    // If a push or pull was added, reprocess the segment events
    if (pushPullEventsAdded) {
      segmentResult = this.processSegmentEvents(segment.events, options);
    }

    // Cache the segment result
    await this.cacheSegmentResult(segment, segmentResult);

    // Apply the result to balance tracker
    this.balanceTracker.applySegmentResult(segmentResult);
  }

  private processSegmentEvents(events: TimelineEvent[], options: CalculationOptions): SegmentResult {
    const segmentResult: SegmentResult = {
      balanceChanges: new Map<string, number>(),
      activitiesAdded: new Map<string, ConsolidatedActivity[]>(),
      processedEventIds: new Set<string>(),
    };

    // Group events by date for efficient processing
    const eventsByDate = this.groupEventsByDate(events);

    for (const [_, dayEvents] of eventsByDate) {
      // Process events for this date
      this.processDayEvents(dayEvents, options, segmentResult);
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

  private processDayEvents(events: TimelineEvent[], options: CalculationOptions, segmentResult: SegmentResult): void {
    // Sort events by priority
    const sortedEvents = [...events].sort((a, b) => a.priority - b.priority);
    for (const event of sortedEvents) {
      this.processEvent(event, options, segmentResult);
      segmentResult.processedEventIds.add(event.id);
    }
  }

  /**
   * Processes a single event
   */
  private processEvent(event: TimelineEvent, options: CalculationOptions, segmentResult: SegmentResult): void {
    if (!this.calculator) {
      throw new Error('Calculator not initialized');
    }
    switch (event.type) {
      case EventType.activity:
        this.calculator.processActivityEvent(event as ActivityEvent, segmentResult);
        break;
      case EventType.bill:
        this.calculator.processBillEvent(event as BillEvent, segmentResult, options.simulation);
        break;
      case EventType.interest:
        this.calculator.processInterestEvent(event as InterestEvent, segmentResult);
        break;
      case EventType.activityTransfer:
        this.calculator.processActivityTransferEvent(event as ActivityTransferEvent, segmentResult);
        break;
      case EventType.billTransfer:
        this.calculator.processBillTransferEvent(event as BillTransferEvent, segmentResult);
        break;
      case EventType.pension:
        this.calculator.processPensionEvent(event as PensionEvent, segmentResult);
        break;
      case EventType.socialSecurity:
        this.calculator.processSocialSecurityEvent(event as SocialSecurityEvent, segmentResult);
        break;
      case EventType.tax:
        this.calculator.processTaxEvent(event as TaxEvent, segmentResult);
        break;
      case EventType.rmd:
        this.calculator.processRMDEvent(event as RMDEvent, segmentResult);
        break;
      default:
        warn(`Unknown event type: ${event.type}`);
    }
  }
}
