import { AccountsAndTransfers } from '../../data/account/types';
import {
  CalculationConfig,
  CalculationOptions,
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
  Segment,
} from './types';
import { CacheManager, initializeCache, createCalculationKey } from './cache';
import { warn, err } from '../calculate-v2/logger';
import { Timeline } from './timeline';
import { BalanceTracker } from './balance-tracker';
import { SegmentProcessor } from './segment-processor';
import { Calculator } from './calculator';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import dayjs from 'dayjs';
import { minDate } from '../io/minDate';
import { Account } from '../../data/account/account';
import { formatDate, isAfterOrSame, isBeforeOrSame } from '../date/date';

class Engine {
  private config: CalculationConfig;
  private cache: CacheManager;
  private timeline: Timeline;
  private balanceTracker: BalanceTracker;
  private segmentProcessor: SegmentProcessor;
  private calculator: Calculator;

  constructor(config: Partial<CalculationConfig> = {}) {
    this.config = this.mergeConfig(config);
    this.cache = initializeCache(this.config);
  }

  async calculate(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
  ): Promise<AccountsAndTransfers> {
    // Try to retrieve from cache
    if (!options.forceRecalculation) {
      const cachedResult = await this.getCachedResult(options);
      if (cachedResult) {
        return cachedResult;
      }
    }

    // Initialize all components
    this.initializeCalculation(accountsAndTransfers, options);

    // Perform the calculation
    const results = await this.performCalculations(accountsAndTransfers, options);

    // Format the results
    const formattedResults = this.formatResults(results);

    // Store the results in cache
    await this.cacheResult(formattedResults, options);

    return formattedResults;
  }

  private mergeConfig(config: Partial<CalculationConfig>): CalculationConfig {
    const defaultConfig: CalculationConfig = {
      snapshotInterval: 'monthly',
      useDiskCache: true,
      diskCacheDir: './cache/calculate-v2',
    };
    return {
      ...defaultConfig,
      ...config,
    };
  }

  private async getCachedResult(options: CalculationOptions): Promise<AccountsAndTransfers | null> {
    const cacheKey = createCalculationKey(options.startDate, options.endDate, options.simulation, options.monteCarlo);

    return await this.cache.get<AccountsAndTransfers>(cacheKey);
  }

  private async cacheResult(result: AccountsAndTransfers, options: CalculationOptions): Promise<void> {
    const cacheKey = createCalculationKey(options.startDate, options.endDate, options.simulation, options.monteCarlo);

    await this.cache.set(cacheKey, result);
  }

  private initializeCalculation(accountsAndTransfers: AccountsAndTransfers, options: CalculationOptions): void {
    // Create timeline - always start from earliest data to get correct balances
    // but we'll filter the final output by date range
    const actualStartDate = minDate(accountsAndTransfers);
    this.timeline = Timeline.fromAccountsAndTransfers(accountsAndTransfers, actualStartDate, options.endDate);

    // Initialize balance tracker - use actual start date for processing all historical data
    this.balanceTracker = new BalanceTracker(accountsAndTransfers.accounts, this.cache, actualStartDate);

    // Initialize segment processor
    this.segmentProcessor = new SegmentProcessor(this.timeline.getSegments(), this.cache);

    // Initialize calculator
    this.calculator = new Calculator(this.balanceTracker, options.simulation);
  }

  private async performCalculations(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
  ): Promise<AccountsAndTransfers> {
    if (!this.timeline || !this.balanceTracker || !this.segmentProcessor || !this.calculator) {
      throw new Error('Calculation components not initialized');
    }

    const segments = this.timeline.getSegments();

    // Initialize accounts with starting balances
    this.balanceTracker.initializeBalances(accountsAndTransfers, options.forceRecalculation);

    // Process segments in order
    for (const segment of segments) {
      await this.processSegment(segment, options);
    }

    // Clamp activities to the specified date range
    const updatedAccounts = this.balanceTracker.getAccountsWithFilteredDates(options.startDate, options.endDate);

    return {
      accounts: updatedAccounts,
      transfers: accountsAndTransfers.transfers,
    };
  }

  private async processSegment(segment: Segment, options: CalculationOptions): Promise<void> {
    if (!this.segmentProcessor || !this.balanceTracker) {
      throw new Error('Segment processor or balance tracker not initialized');
    }

    // Check if segment result is cached
    if (!options.forceRecalculation) {
      const cachedResult = await this.segmentProcessor.getCachedSegmentResult(segment);
      if (cachedResult) {
        this.balanceTracker.applySegmentResult(cachedResult);
        return;
      }
    }

    // Process events in the segment
    let segmentResult = await this.processSegmentEvents(segment.events, options);

    // Deal with pushes and pulls
    segmentResult = await this.handleAccountPushPulls(segmentResult, segment, options);

    // Cache the segment result
    await this.segmentProcessor.cacheSegmentResult(segment, segmentResult);

    // Apply the result to balance tracker
    this.balanceTracker.applySegmentResult(segmentResult);
  }

  private async processSegmentEvents(events: TimelineEvent[], options: CalculationOptions): Promise<SegmentResult> {
    const segmentResult: SegmentResult = {
      balanceChanges: new Map<string, number>(),
      activitiesAdded: new Map<string, ConsolidatedActivity[]>(),
      processedEventIds: new Set<string>(),
    };

    // Group events by date for efficient processing
    const eventsByDate = this.groupEventsByDate(events);

    for (const [_, dayEvents] of eventsByDate) {
      // Process events for this date
      await this.processDayEvents(dayEvents, options, segmentResult);
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

  private async processDayEvents(
    events: TimelineEvent[],
    options: CalculationOptions,
    segmentResult: SegmentResult,
  ): Promise<void> {
    // Sort events by priority
    const sortedEvents = [...events].sort((a, b) => a.priority - b.priority);
    for (const event of sortedEvents) {
      await this.processEvent(event, options, segmentResult);
      segmentResult.processedEventIds.add(event.id);
    }
  }

  /**
   * Processes a single event
   */
  private async processEvent(
    event: TimelineEvent,
    options: CalculationOptions,
    segmentResult: SegmentResult,
  ): Promise<void> {
    if (!this.calculator) {
      throw new Error('Calculator not initialized');
    }
    switch (event.type) {
      case EventType.activity:
        await this.calculator.processActivityEvent(event as ActivityEvent, segmentResult);
        break;
      case EventType.bill:
        await this.calculator.processBillEvent(event as BillEvent, segmentResult, options.simulation);
        break;
      case EventType.interest:
        await this.calculator.processInterestEvent(event as InterestEvent, segmentResult);
        break;
      case EventType.activityTransfer:
        await this.calculator.processActivityTransferEvent(event as ActivityTransferEvent, segmentResult);
        break;
      case EventType.billTransfer:
        await this.calculator.processBillTransferEvent(event as BillTransferEvent, segmentResult);
        break;
      case EventType.pension:
        await this.calculator.processPensionEvent(event as PensionEvent, segmentResult);
        break;
      case EventType.socialSecurity:
        await this.calculator.processSocialSecurityEvent(event as SocialSecurityEvent, segmentResult);
        break;
      case EventType.tax:
        await this.calculator.processTaxEvent(event as TaxEvent, segmentResult);
        break;
      case EventType.rmd:
        await this.calculator.processRMDEvent(event as RMDEvent, segmentResult);
        break;
      default:
        warn(`Unknown event type: ${event.type}`);
    }
  }

  /**
   * Handles account push/pull events
   */
  private async handleAccountPushPulls(
    segmentResult: SegmentResult,
    segment: Segment,
    options: CalculationOptions,
  ): Promise<SegmentResult> {
    let pushPullEventAdded = false;
    for (const accountId of segment.affectedAccountIds) {
      const account = this.timeline.getAccountById(accountId);
      if (!account) {
        warn(`Account with ID ${accountId} not found in segment ${segment.id}`);
        continue;
      }

      // Skip accounts that do not perform pushes or pulls
      const performsPushes = this.accountPerformsPushes(account, segment.startDate);
      const performsPulls = this.accountPerformsPulls(account, segment.startDate);
      if (!performsPushes && !performsPulls) {
        continue;
      }

      // Check if the account needs a push or pull based on its balance
      const { min, max } = this.balanceTracker.getAccountBalanceRange(accountId, segmentResult);
      const { pushNeeded, pullNeeded } = this.checkPushPullRequirements(
        account,
        min,
        max,
        performsPushes,
        performsPulls,
      );

      // If push or pull is needed, add the corresponding event
      if (pushNeeded && performsPushes) {
        if (this.addPushEvents(segment, account, max)) {
          pushPullEventAdded = true;
        }
      } else if (pullNeeded && performsPulls) {
        if (this.addPullEvents(segment, account, min)) {
          pushPullEventAdded = true;
        }
      }
    }
    // If a push or pull was added, update the segment result
    if (pushPullEventAdded) {
      return await this.processSegmentEvents(segment.events, options);
    } else {
      return segmentResult;
    }
  }

  /**
   * Adds push events to the segment
   */
  private addPushEvents(segment: Segment, account: Account, maxBalance: number): boolean {
    console.log(
      `Adding push events for account ${account.name} with max balance ${maxBalance} on segment starting ${formatDate(segment.startDate)}`,
    );
    let pushAmount = 0;
    // TODO: Implement logic to add push events

    return pushAmount > 0; // Return true if a push event was added
  }

  /**
   * Adds pull events to the segment
   */
  private addPullEvents(segment: Segment, account: Account, minBalance: number): boolean {
    console.log(
      `Adding pull events for account ${account.name} with min balance ${minBalance} on segment starting ${formatDate(segment.startDate)}`,
    );
    let pullAmount = 0;
    // TODO: Implement logic to add pull events

    return pullAmount > 0; // Return true if a pull event was added
  }

  /**
   * Checks if the account needs a push or pull based on its balance
   */
  private checkPushPullRequirements(
    account: Account,
    minBalance: number,
    maxBalance: number,
    performsPushes: boolean,
    performsPulls: boolean,
  ): { pushNeeded: boolean; pullNeeded: boolean } {
    let pushNeeded = performsPushes && account.minimumBalance && maxBalance > account.minimumBalance * 4;
    let pullNeeded = performsPulls && account.minimumBalance && minBalance < account.minimumBalance;

    return {
      pushNeeded: !!pushNeeded,
      pullNeeded: !!pullNeeded,
    };
  }

  /**
   * Checks if the account performs pushes based on its configuration
   */
  private accountPerformsPushes(account: Account, segmentStartDate: Date): boolean {
    return (
      account.performsPushes &&
      isAfterOrSame(segmentStartDate, new Date()) &&
      (!account.pushStart || isBeforeOrSame(account.pushStart, segmentStartDate))
    );
  }

  /**
   * Checks if the account performs pulls based on its configuration
   */
  private accountPerformsPulls(account: Account, segmentStartDate: Date): boolean {
    return (
      account.performsPulls &&
      isAfterOrSame(segmentStartDate, new Date()) &&
      (!account.pushStart || isBeforeOrSame(account.pushStart, segmentStartDate))
    );
  }

  private formatResults(results: AccountsAndTransfers): AccountsAndTransfers {
    // Round amounts and balances to 2 decimal places
    // We only round amounts and balances in the consolidatedActivity
    results.accounts.forEach((account) => {
      // The accounts from getUpdatedAccounts have consolidatedActivity, not activity
      if (account.consolidatedActivity) {
        account.consolidatedActivity.forEach((activity) => {
          try {
            activity.amount = Math.round(Number(activity.amount) * 100) / 100; // Round to 2 decimal places
          } catch {
            err('Error rounding activity amount:', activity.amount);
          }
          activity.balance = Math.round(activity.balance * 100) / 100; // Round to 2 decimal places
        });
      }
    });
    return results;
  }
}

/**
 * Convenience function for performing calculations
 */
export async function calculateAllActivity(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date | null,
  endDate: Date,
  simulation: string = 'Default',
  monteCarlo: boolean = false,
  simulationNumber: number = 1,
  totalSimulations: number = 1,
  forceRecalculation: boolean = false,
  enableLogging: boolean = false,
  config: Partial<CalculationConfig> = {},
): Promise<AccountsAndTransfers> {
  const engine = new Engine(config);

  const options: CalculationOptions = {
    startDate,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    totalSimulations,
    forceRecalculation,
    enableLogging,
    config,
  };

  const result = await engine.calculate(accountsAndTransfers, options);
  return result;
}
