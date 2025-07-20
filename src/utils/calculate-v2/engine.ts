/**
 * Main calculation engine orchestrator for the optimized financial system
 * 
 * This module coordinates the entire calculation process using the event-based
 * timeline, caching system, and dependency tracking to achieve 10-100x performance
 * improvements over the original daily iteration approach.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  CalculationOptions,
  CalculationResult,
  CalculationConfig,
  ProcessingState,
  PerformanceMetrics,
  TimelineEvent,
  EventType
} from './types';
import { AccountsAndTransfers } from '../../data/account/types';
import { Timeline } from './timeline';
import { CacheManager, initializeCache, createCalculationKey } from './cache';
import { DependencyGraph, buildDependencyGraph, optimizeDependencyGraph } from './dependency';
import { BalanceTracker } from './balance-tracker';
import { SegmentProcessor } from './segments';
import { Calculator } from './calculator';
import { SmartPushPullProcessor } from './pushpull';
import { startTiming, endTiming } from '../log';
import crypto from 'crypto';

dayjs.extend(utc);

/**
 * Main calculation engine that orchestrates the optimized calculation process
 */
export class CalculationEngine {
  private config: CalculationConfig;
  private cache: CacheManager;
  private timeline: Timeline | null = null;
  private dependencyGraph: DependencyGraph | null = null;
  private balanceTracker: BalanceTracker | null = null;
  private segmentProcessor: SegmentProcessor | null = null;
  private calculator: Calculator | null = null;
  private pushPullProcessor: SmartPushPullProcessor | null = null;
  private processingState: ProcessingState | null = null;

  constructor(config: Partial<CalculationConfig> = {}) {
    this.config = this.mergeConfig(config);
    this.cache = initializeCache(this.config);
  }

  /**
   * Main entry point for performing calculations
   */
  async calculate(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions
  ): Promise<CalculationResult> {
    const startTime = new Date();

    try {
      // Initialize performance metrics
      const metrics: PerformanceMetrics = {
        startTime,
        endTime: null,
        eventsProcessed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        memoryUsageMB: 0,
        operationTimes: {},
        deepCopyCount: 0,
        lookaheadCount: 0
      };

      // Initialize processing state
      this.processingState = {
        currentDate: options.startDate || new Date(),
        balances: {},
        activityIndices: {},
        interestStates: {},
        processedEvents: new Set(),
        processedSegments: new Set(),
        error: null,
        metrics
      };

      // Check cache first (unless forced recalculation)
      if (!options.forceRecalculation) {
        const cached = await this.tryGetCachedResult(accountsAndTransfers, options);
        if (cached) {
          metrics.cacheHits++;
          return cached;
        }
        metrics.cacheMisses++;
      }

      // Initialize calculation components
      await this.initializeCalculation(accountsAndTransfers, options);

      // Perform the calculation
      console.log('[Engine] About to call performCalculation...');
      const result = await this.performCalculation(accountsAndTransfers, options);
      console.log('[Engine] performCalculation returned, success:', result.success);

      // Cache the result (re-enabled after fixing serialization)
      if (result.success) {
        console.log('[Engine] About to cache result...');
        try {
          await this.cacheResult(accountsAndTransfers, options, result);
          console.log('[Engine] Result cached successfully');
        } catch (cacheError) {
          console.warn('[Engine] Failed to cache result:', cacheError instanceof Error ? cacheError.message : String(cacheError));
          // Don't fail the entire calculation if caching fails
        }
      } else {
        console.log('[Engine] Not caching failed result');
      }

      console.log('[Engine] About to return final result...');
      return result;

    } catch (error) {
      return this.createErrorResult(error as Error, startTime, options);
    }
  }

  /**
   * Initializes all calculation components
   */
  private initializeCalculation(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions
  ): void {
    startTiming('initializeCalculation');

    // Create timeline - always start from earliest data to get correct balances
    // but we'll filter the final output by date range
    const actualStartDate = this.getMinDate(accountsAndTransfers);
    this.timeline = Timeline.fromAccountsAndTransfers(
      accountsAndTransfers,
      actualStartDate,
      options.endDate,
      options.simulation
    );

    // Build dependency graph
    this.dependencyGraph = buildDependencyGraph(
      this.timeline.getEvents(),
      accountsAndTransfers.accounts
    );

    // Optimize dependency graph
    optimizeDependencyGraph(this.dependencyGraph);

    // Initialize balance tracker - use actual start date for processing all historical data
    this.balanceTracker = new BalanceTracker(
      accountsAndTransfers.accounts,
      this.cache,
      actualStartDate
    );

    // Initialize segment processor
    this.segmentProcessor = new SegmentProcessor(
      this.timeline.getSegments(),
      this.cache,
      this.config
    );

    // Initialize calculator
    this.calculator = new Calculator(
      this.config,
      this.cache,
      this.dependencyGraph,
      this.balanceTracker
    );

    // Initialize push/pull processor
    this.pushPullProcessor = new SmartPushPullProcessor(this.cache);

    endTiming('initializeCalculation');
  }

  /**
   * Performs the main calculation logic
   */
  private async performCalculation(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions
  ): Promise<CalculationResult> {
    if (!this.timeline || !this.balanceTracker || !this.segmentProcessor || !this.calculator) {
      throw new Error('Calculation components not initialized');
    }

    startTiming('performCalculation');

    const segments = this.timeline.getSegments();
    const totalEvents = this.timeline.getEventCount();

    // Initialize accounts with starting balances
    await this.balanceTracker.initializeBalances();

    // Process segments in order
    for (const segment of segments) {
      if (this.processingState!.error) break;

      await this.processSegment(segment, accountsAndTransfers, options);
      this.processingState!.processedSegments.add(segment.id);
    }

    // Finalize calculation
    console.log('[Engine] Getting final balances...');
    const finalBalances = this.balanceTracker.getCurrentBalances();
    console.log('[Engine] Final balances:', finalBalances);
    
    console.log('[Engine] Getting updated accounts...');
    const updatedAccounts = this.balanceTracker.getUpdatedAccounts(options.startDate, options.endDate);
    console.log(`[Engine] Got ${updatedAccounts.length} updated accounts`);
    
    // Debug the first account
    if (updatedAccounts.length > 0) {
      const firstAccount = updatedAccounts[0];
      console.log(`[Engine] First account: ${firstAccount.name} (${firstAccount.id})`);
      console.log(`[Engine] First account balance: ${firstAccount.balance} (type: ${typeof firstAccount.balance})`);
      console.log(`[Engine] First account consolidated activities: ${firstAccount.consolidatedActivity?.length || 'undefined'}`);
      console.log(`[Engine] First account keys:`, Object.keys(firstAccount));
    }

    endTiming('performCalculation');

    // Create result
    try {
      console.log('[Engine] Creating result...');
      console.log('[Engine] Processing state error:', this.processingState!.error);
      
      const metrics = this.processingState!.metrics;
      console.log('[Engine] Got metrics');
      
      metrics.endTime = new Date();
      console.log('[Engine] Set end time');
      
      metrics.memoryUsageMB = process.memoryUsage().heapUsed / (1024 * 1024);
      console.log('[Engine] Set memory usage');
      
      console.log('[Engine] Building metadata...');
      const metadata = {
        startDate: options.startDate || this.getMinDate(accountsAndTransfers),
        endDate: options.endDate,
        simulation: options.simulation,
        totalEvents,
        cacheUtilization: this.calculateCacheUtilization()
      };
      console.log('[Engine] Built metadata');

      const result = {
        success: !this.processingState!.error,
        error: this.processingState!.error?.message || null,
        accounts: updatedAccounts,
        finalBalances,
        metrics,
        metadata
      };
      
      console.log('[Engine] Built final result:', { 
        success: result.success, 
        error: result.error, 
        accountCount: result.accounts.length 
      });
      
      // Test each property of the result to see which one causes issues
      console.log('[Engine] Testing result properties...');
      console.log('[Engine] result.success:', result.success);
      console.log('[Engine] result.error:', result.error);
      console.log('[Engine] result.accounts type:', typeof result.accounts);
      console.log('[Engine] result.accounts length:', result.accounts?.length);
      
      // Test accessing the first account
      if (result.accounts && result.accounts.length > 0) {
        try {
          console.log('[Engine] Accessing first account...');
          const firstAccount = result.accounts[0];
          console.log('[Engine] First account id:', firstAccount?.id);
          console.log('[Engine] First account type:', typeof firstAccount);
        } catch (accountError) {
          console.error('[Engine] Error accessing first account:', accountError);
        }
      }
      
      console.log('[Engine] About to return result...');
      return result;
    } catch (error) {
      console.error('[Engine] Error creating result:', error);
      throw error;
    }
  }

  /**
   * Processes a single calculation segment
   */
  private async processSegment(
    segment: any, // CalculationSegment from types
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions
  ): Promise<void> {
    startTiming(`processSegment_${segment.id}`);

    try {
      // Check if segment result is cached
      const cachedResult = await this.segmentProcessor!.getCachedSegmentResult(segment);
      if (cachedResult && !options.forceRecalculation) {
        this.balanceTracker!.applySegmentResult(cachedResult);
        this.processingState!.metrics.cacheHits++;
        return;
      }

      this.processingState!.metrics.cacheMisses++;

      // Process events in the segment
      const segmentResult = await this.processSegmentEvents(
        segment.events,
        accountsAndTransfers,
        options
      );

      // Cache the segment result
      await this.segmentProcessor!.cacheSegmentResult(segment, segmentResult);

      // Apply the result to balance tracker
      this.balanceTracker!.applySegmentResult(segmentResult);

    } catch (error) {
      this.processingState!.error = error as Error;
      throw error;
    } finally {
      endTiming(`processSegment_${segment.id}`);
    }
  }

  /**
   * Processes events within a segment
   */
  private async processSegmentEvents(
    events: TimelineEvent[],
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions
  ): Promise<any> {
    try {
      console.log(`[Engine] Processing segment with ${events.length} events`);
      
      const segmentResult = {
        balanceChanges: new Map<string, number>(),
        activitiesAdded: new Map<string, any[]>(),
        interestStateChanges: new Map<string, any>(),
        processedEventIds: new Set<string>()
      };

      // Group events by date for efficient processing
      const eventsByDate = this.groupEventsByDate(events);
      console.log(`[Engine] Grouped events into ${eventsByDate.size} dates`);

      for (const [dateString, dayEvents] of eventsByDate) {
        const date = new Date(dateString);
        this.processingState!.currentDate = date;
        
        console.log(`[Engine] Processing ${dayEvents.length} events for date ${dateString}`);

        // Process events for this date
        await this.processDayEvents(dayEvents, accountsAndTransfers, options, segmentResult);
      }

      console.log(`[Engine] Segment processing complete. Balance changes: ${segmentResult.balanceChanges.size}, Activities added: ${segmentResult.activitiesAdded.size}`);
      return segmentResult;
      
    } catch (error) {
      console.error(`[Engine] Error processing segment events:`, error);
      throw error;
    }
  }

  /**
   * Processes all events for a single day
   */
  private async processDayEvents(
    events: TimelineEvent[],
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    segmentResult: any
  ): Promise<void> {
    // Sort events by priority
    const sortedEvents = [...events].sort((a, b) => a.priority - b.priority);
    console.log(`[Engine] Processing ${sortedEvents.length} events for day`);

    for (const event of sortedEvents) {
      try {
        console.log(`[Engine] Processing event: ${event.type} - ${event.id} - Account: ${event.accountId}`);
        await this.processEvent(event, accountsAndTransfers, options, segmentResult);
        this.processingState!.processedEvents.add(event.id);
        this.processingState!.metrics.eventsProcessed++;
        segmentResult.processedEventIds.add(event.id);
        console.log(`[Engine] Successfully processed event: ${event.id}`);
      } catch (error) {
        console.error(`[Engine] Error processing event ${event.id}:`, error);
        this.processingState!.error = error as Error;
        throw error;
      }
    }
  }

  /**
   * Processes a single event
   */
  private async processEvent(
    event: TimelineEvent,
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    segmentResult: any
  ): Promise<void> {
    if (!this.calculator) {
      throw new Error('Calculator not initialized');
    }

    const eventTiming = `process_${event.type}_${event.id}`;
    startTiming(eventTiming);

    try {
      switch (event.type) {
        case EventType.activity:
          await this.calculator.processActivityEvent(event as any, segmentResult);
          break;
        case EventType.bill:
          await this.calculator.processBillEvent(event as any, segmentResult);
          break;
        case EventType.interest:
          await this.calculator.processInterestEvent(event as any, segmentResult);
          break;
        case EventType.transfer:
          await this.calculator.processTransferEvent(event as any, segmentResult);
          break;
        case EventType.pension:
          await this.calculator.processPensionEvent(event as any, segmentResult);
          break;
        case EventType.socialSecurity:
          await this.calculator.processSocialSecurityEvent(event as any, segmentResult);
          break;
        case EventType.tax:
          await this.calculator.processTaxEvent(event as any, segmentResult);
          break;
        case EventType.rmd:
          await this.calculator.processRMDEvent(event as any, segmentResult);
          break;
        case EventType.pushPullCheck:
          await this.calculator.processPushPullEvent(
            event as any,
            accountsAndTransfers,
            {
              ...options,
              pushPullProcessor: this.pushPullProcessor,
              balanceTracker: this.balanceTracker,
              simulation: options.simulation || 'Default',
              monteCarlo: options.monteCarlo || false
            },
            segmentResult
          );
          break;
        default:
          console.warn(`Unknown event type: ${event.type}`);
      }
    } finally {
      endTiming(eventTiming);

      // Track timing in metrics
      if (!this.processingState!.metrics.operationTimes[event.type]) {
        this.processingState!.metrics.operationTimes[event.type] = 0;
      }
      // Note: Actual timing would need to be retrieved from the timing system
    }
  }

  /**
   * Groups events by date for efficient processing
   */
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
   * Tries to get a cached calculation result
   */
  private async tryGetCachedResult(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions
  ): Promise<CalculationResult | null> {
    const dataHash = this.hashAccountsAndTransfers(accountsAndTransfers);
    const cacheKey = createCalculationKey(
      options.startDate,
      options.endDate,
      options.simulation,
      options.monteCarlo,
      dataHash
    );

    return await this.cache.get<CalculationResult>(cacheKey);
  }

  /**
   * Caches the calculation result
   */
  private async cacheResult(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    result: CalculationResult
  ): Promise<void> {
    const dataHash = this.hashAccountsAndTransfers(accountsAndTransfers);
    const cacheKey = createCalculationKey(
      options.startDate,
      options.endDate,
      options.simulation,
      options.monteCarlo,
      dataHash
    );

    await this.cache.set(cacheKey, result, {
      size: this.estimateResultSize(result)
    });
  }

  /**
   * Creates an error result
   */
  private createErrorResult(
    error: Error,
    startTime: Date,
    options: CalculationOptions
  ): CalculationResult {
    return {
      success: false,
      error: error.message,
      accounts: [],
      finalBalances: {},
      metrics: {
        startTime,
        endTime: new Date(),
        eventsProcessed: 0,
        cacheHits: 0,
        cacheMisses: 1,
        memoryUsageMB: process.memoryUsage().heapUsed / (1024 * 1024),
        operationTimes: {},
        deepCopyCount: 0,
        lookaheadCount: 0
      },
      metadata: {
        startDate: options.startDate || new Date(),
        endDate: options.endDate,
        simulation: options.simulation,
        totalEvents: 0,
        cacheUtilization: 0
      }
    };
  }

  // Helper methods

  private mergeConfig(overrides: Partial<CalculationConfig>): CalculationConfig {
    const defaults: CalculationConfig = {
      snapshotInterval: 'monthly',
      maxMemoryCacheMB: 100,
      useDiskCache: true,
      diskCacheDir: './cache/calculate-v2',
      enableParallelProcessing: false, // TODO: Enable after implementing
      maxWorkerThreads: 4,
      enablePerfMetrics: true
    };

    return { ...defaults, ...overrides };
  }

  private getMinDate(accountsAndTransfers: AccountsAndTransfers): Date {
    let minDate = new Date();

    for (const account of accountsAndTransfers.accounts) {
      for (const activity of account.activity) {
        if (activity.date < minDate) {
          minDate = activity.date;
        }
      }

      for (const bill of account.bills) {
        if (bill.startDate && bill.startDate < minDate) {
          minDate = bill.startDate;
        }
      }

      for (const interest of account.interests) {
        if (interest.applicableDate && interest.applicableDate < minDate) {
          minDate = interest.applicableDate;
        }
      }
    }

    for (const transfer of accountsAndTransfers.transfers.bills) {
      if (transfer.startDate && transfer.startDate < minDate) {
        minDate = transfer.startDate;
      }
    }

    return minDate;
  }

  private hashAccountsAndTransfers(accountsAndTransfers: AccountsAndTransfers): string {
    // Create a simplified hash of the data structure
    const hashData = {
      accounts: accountsAndTransfers.accounts.map(acc => ({
        id: acc.id,
        name: acc.name,
        type: acc.type,
        balance: (acc as any).balance || acc.todayBalance || 0,
        activityCount: acc.activity.length,
        billCount: acc.bills.length,
        interestCount: acc.interests.length
      })),
      transferCount: accountsAndTransfers.transfers.activity.length +
        accountsAndTransfers.transfers.bills.length
    };

    return crypto.createHash('sha256')
      .update(JSON.stringify(hashData))
      .digest('hex');
  }

  private calculateCacheUtilization(): number {
    const stats = this.cache.getCacheStats();
    return stats.memoryUtilization;
  }

  private estimateResultSize(result: CalculationResult): number {
    // Rough estimate based on number of accounts and activities
    const baseSize = 1024; // Base result overhead
    const accountSize = result.accounts.length * 1024; // ~1KB per account
    const balanceSize = Object.keys(result.finalBalances).length * 16; // 8 bytes per balance
    const metricsSize = 512; // Metrics overhead

    return baseSize + accountSize + balanceSize + metricsSize;
  }

  /**
   * Gets performance statistics
   */
  getPerformanceStats(): any {
    if (!this.processingState) {
      return null;
    }

    return {
      processing: this.processingState.metrics,
      cache: this.cache.getCacheStats(),
      timeline: this.timeline?.getStats() || null,
      dependency: this.dependencyGraph?.getStats() || null
    };
  }

  /**
   * Clears all caches
   */
  async clearCaches(): Promise<void> {
    await this.cache.clear();
  }

  /**
   * Performs cache cleanup
   */
  async cleanup(): Promise<void> {
    await this.cache.cleanup();
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
  config: Partial<CalculationConfig> = {}
): Promise<CalculationResult> {
  const engine = new CalculationEngine(config);

  const options: CalculationOptions = {
    startDate,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    totalSimulations,
    forceRecalculation: false,
    enableLogging: false,
    config
  };

  return await engine.calculate(accountsAndTransfers, options);
}