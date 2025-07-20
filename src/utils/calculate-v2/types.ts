/**
 * Core type definitions for the new event-based calculation engine
 * 
 * This module defines the fundamental data structures used throughout the 
 * optimized calculation system, including events, snapshots, and processing state.
 */

import { Account } from '../../data/account/account';
import { Interest } from '../../data/interest/interest';
import { Bill } from '../../data/bill/bill';

/**
 * Extended Account interface for calculate-v2 system with additional balance property
 */
export interface CalculationAccount extends Account {
  balance: number; // Current calculated balance
}
// Transfer data is handled through AccountsAndTransfers.transfers
// Transfer interface represents both transfer activities and transfer bills
export interface Transfer {
  id: string;
  name: string;
  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  amountIsVariable?: boolean;
  amountVariable?: string | null;
  from: string | null;
  to: string | null;
  date?: Date;
  isTransfer: boolean;
  category?: string;
  flag?: boolean;
  flagColor?: string | null;
  // Bill-specific properties (for recurring transfers)
  startDate?: Date;
  endDate?: Date | null;
  periods?: 'day' | 'week' | 'month' | 'year';
  everyN?: number;
  // Inflation properties (for recurring transfers)
  increaseBy?: number;
  increaseByIsVariable?: boolean;
  increaseByVariable?: string | null;
  increaseByDate?: { day: number; month: number };
  ceilingMultiple?: number;
  // Activity-specific properties (for one-time transfers)
  dateIsVariable?: boolean;
  dateVariable?: string | null;
}
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';

/**
 * Event types that can occur in the timeline
 */
export enum EventType {
  activity = 'activity',
  bill = 'bill',
  interest = 'interest',
  transfer = 'transfer',
  pension = 'pension',
  socialSecurity = 'social_security',
  tax = 'tax',
  rmd = 'rmd',
  pushPullCheck = 'push_pull_check'
}

/**
 * Base interface for all timeline events
 */
export interface TimelineEvent {
  /** Unique identifier for the event */
  id: string;
  /** Type of event */
  type: EventType;
  /** Date when the event occurs */
  date: Date;
  /** ID of the account this event affects */
  accountId: string;
  /** Priority for processing order when events occur on same date */
  priority: number;
  /** Whether this event can be cached/memoized */
  cacheable: boolean;
  /** Dependencies on other events or accounts */
  dependencies: string[];
}

/**
 * Activity event (manual transactions)
 */
export interface ActivityEvent extends TimelineEvent {
  type: EventType.activity;
  /** The consolidated activity this event represents */
  activity: ConsolidatedActivity;
}

/**
 * Bill event (recurring payments/income)
 */
export interface BillEvent extends TimelineEvent {
  type: EventType.bill;
  /** The bill configuration */
  bill: Bill;
  /** Calculated amount for this occurrence (with inflation) */
  amount: number;
  /** Whether this is a variable amount */
  isVariable: boolean;
}

/**
 * Interest event (compound interest application)
 */
export interface InterestEvent extends TimelineEvent {
  type: EventType.interest;
  /** The interest configuration */
  interest: Interest;
  /** Interest rate for this period */
  rate: number;
  /** Whether this is tax-deferred interest */
  taxDeferred: boolean;
}

/**
 * Transfer event (money movement between accounts)
 */
export interface TransferEvent extends TimelineEvent {
  type: EventType.transfer;
  /** The transfer configuration */
  transfer: Transfer;
  /** Source account ID */
  fromAccountId: string;
  /** Destination account ID */
  toAccountId: string;
  /** Transfer amount */
  amount: number;
}

/**
 * Push/Pull check event (monthly balance optimization)
 */
export interface PushPullEvent extends TimelineEvent {
  type: EventType.pushPullCheck;
  /** Type of check (monthly lookahead) */
  checkType: 'monthly';
}

/**
 * Balance snapshot at a specific point in time
 */
export interface BalanceSnapshot {
  /** Date of the snapshot */
  date: Date;
  /** Account balances at this point */
  balances: Record<string, number>;
  /** Activity indices for each account */
  activityIndices: Record<string, number>;
  /** Interest states for each account */
  interestStates: Record<string, InterestState>;
  /** Hash of the data that created this snapshot for invalidation */
  dataHash: string;
  /** Events that have been processed up to this point */
  processedEventIds: Set<string>;
}

/**
 * Interest state for an account
 */
export interface InterestState {
  /** Current interest configuration */
  currentInterest: Interest | null;
  /** Index in the interest array */
  interestIndex: number;
  /** Next date when interest will be applied */
  nextInterestDate: Date | null;
  /** Accumulated interest for tax calculations */
  accumulatedTaxableInterest: number;
}

/**
 * Calculation segment representing a time period
 */
export interface CalculationSegment {
  /** Unique identifier */
  id: string;
  /** Start date of the segment */
  startDate: Date;
  /** End date of the segment */
  endDate: Date;
  /** Events contained in this segment */
  events: TimelineEvent[];
  /** Accounts affected by this segment */
  affectedAccounts: Set<string>;
  /** Dependencies on other segments */
  dependencies: string[];
  /** Whether this segment's results are cached */
  cached: boolean;
  /** Hash for cache invalidation */
  cacheKey: string;
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
  /** Node identifier (account ID or event ID) */
  id: string;
  /** Type of dependency */
  type: 'account' | 'event' | 'segment';
  /** Dependencies this node has */
  dependencies: Set<string>;
  /** Nodes that depend on this one */
  dependents: Set<string>;
  /** Processing priority */
  priority: number;
  /** Whether this node has been processed */
  processed: boolean;
}

/**
 * Cache entry for segments or calculations
 */
export interface CacheEntry<T> {
  /** The cached data */
  data: T;
  /** When this entry was created */
  timestamp: Date;
  /** Hash of input data for invalidation */
  inputHash: string;
  /** Expiration time (null = never expires) */
  expiresAt: Date | null;
  /** Size in bytes (for memory management) */
  size: number;
}

/**
 * Configuration for the calculation engine
 */
export interface CalculationConfig {
  /** How often to create balance snapshots */
  snapshotInterval: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  /** Maximum memory cache size in MB */
  maxMemoryCacheMB: number;
  /** Whether to use disk caching */
  useDiskCache: boolean;
  /** Directory for disk cache */
  diskCacheDir: string;
  /** Enable parallel processing where possible */
  enableParallelProcessing: boolean;
  /** Maximum number of worker threads */
  maxWorkerThreads: number;
  /** Enable detailed performance metrics */
  enablePerfMetrics: boolean;
}

/**
 * Processing state for the calculation engine
 */
export interface ProcessingState {
  /** Current date being processed */
  currentDate: Date;
  /** Current balances for all accounts */
  balances: Record<string, number>;
  /** Current activity indices for all accounts */
  activityIndices: Record<string, number>;
  /** Current interest states for all accounts */
  interestStates: Record<string, InterestState>;
  /** Events that have been processed */
  processedEvents: Set<string>;
  /** Segments that have been processed */
  processedSegments: Set<string>;
  /** Error state */
  error: Error | null;
  /** Performance metrics */
  metrics: PerformanceMetrics;
}

/**
 * Performance metrics for the calculation
 */
export interface PerformanceMetrics {
  /** Start time of calculation */
  startTime: Date;
  /** End time of calculation */
  endTime: Date | null;
  /** Total events processed */
  eventsProcessed: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses */
  cacheMisses: number;
  /** Memory usage in MB */
  memoryUsageMB: number;
  /** Time spent in different operations */
  operationTimes: Record<string, number>;
  /** Deep copy operations performed */
  deepCopyCount: number;
  /** Lookahead calculations performed */
  lookaheadCount: number;
}

/**
 * Result of a calculation operation
 */
export interface CalculationResult {
  /** Whether the calculation succeeded */
  success: boolean;
  /** Error message if calculation failed */
  error: string | null;
  /** Updated accounts with calculated activities */
  accounts: Account[];
  /** Final balances */
  finalBalances: Record<string, number>;
  /** Performance metrics */
  metrics: PerformanceMetrics;
  /** Calculation metadata */
  metadata: {
    startDate: Date;
    endDate: Date;
    simulation: string;
    totalEvents: number;
    cacheUtilization: number;
  };
}

/**
 * Options for calculation operations
 */
export interface CalculationOptions {
  /** Start date for calculation (null = from beginning) */
  startDate: Date | null;
  /** End date for calculation */
  endDate: Date;
  /** Simulation name */
  simulation: string;
  /** Whether this is a monte carlo simulation */
  monteCarlo: boolean;
  /** Simulation number (for monte carlo) */
  simulationNumber: number;
  /** Total number of simulations */
  totalSimulations: number;
  /** Force recalculation even if cached */
  forceRecalculation: boolean;
  /** Enable detailed logging */
  enableLogging: boolean;
  /** Custom configuration overrides */
  config: Partial<CalculationConfig>;
}