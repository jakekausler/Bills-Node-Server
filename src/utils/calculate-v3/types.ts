import { AccountsAndTransfers } from '../../data/account/types';
import { Activity } from '../../data/activity/activity';
import { ConsolidatedActivityData } from '../../data/activity/types';
import { Bill } from '../../data/bill/bill';
import { Interest } from '../../data/interest/interest';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { DateString } from '../date/types';

export type CalculationConfig = {
  snapshotInterval: 'monthly' | 'quarterly' | 'yearly';
  useDiskCache: boolean;
  diskCacheDir: string;
};
export type CalculationOptions = {
  startDate: Date | null;
  endDate: Date;
  simulation: string;
  monteCarlo: boolean;
  simulationNumber: number;
  totalSimulations: number;
  forceRecalculation: boolean;
  enableLogging: boolean;
  config: Partial<CalculationConfig>;
};

export type TaxableOccurence = {
  /** Date of the taxable event */
  date: Date;
  /** Year of the taxable event */
  year: number;
  /** Amount of the taxable event */
  amount: number;
  /** Tax rate applied to this event */
  taxRate: number;
};

export type TaxableOccurenceData = {
  date: DateString;
  year: number;
  amount: number;
  taxRate: number;
};

/**
 * Results of a calculation segment
 */
export interface SegmentResult {
  /** Balance changes for each account */
  balanceChanges: Map<string, number>;
  /** Activities added to the segment */
  activitiesAdded: Map<string, any[]>;
  /** Processed event IDs */
  processedEventIds: Set<string>;
  /** Minimum day end balance for each account */
  balanceMinimums: Map<string, number>;
  /** Maximum day end balance for each account */
  balanceMaximums: Map<string, number>;
  /** Taxable occurences indexed by account name */
  taxableOccurences: Map<string, TaxableOccurence[]>;
  /** Accounts and Transfers */
  accountsAndTransfers?: AccountsAndTransfers;
}

export type SegmentResultData = {
  balanceChanges: Record<string, number>;
  activitiesAdded: Record<string, ConsolidatedActivityData[]>;
  processedEventIds: string[];
  balanceMinimums: Record<string, number>;
  balanceMaximums: Record<string, number>;
  taxableOccurences: Record<string, TaxableOccurenceData[]>;
};

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

export enum EventType {
  activity = 'activity',
  bill = 'bill',
  interest = 'interest',
  activityTransfer = 'activityTransfer',
  billTransfer = 'billTransfer',
  pension = 'pension',
  socialSecurity = 'socialSecurity',
  tax = 'tax',
  rmd = 'rmd',
}

export type TimelineEvent = {
  id: string;
  type: EventType;
  date: Date;
  accountId: string;
  priority: number;
};

export type ActivityEvent = TimelineEvent & {
  type: EventType.activity;
  originalActivity: Activity;
};

export type BillEvent = TimelineEvent & {
  type: EventType.bill;
  originalBill: Bill;
  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  firstBill: boolean;
};

export type InterestEvent = TimelineEvent & {
  type: EventType.interest;
  originalInterest: Interest;
  rate: number;
  firstInterest: boolean;
};

export type TransferEvent = {
  fromAccountId: string;
  toAccountId: string;
};

export type ActivityTransferEvent = Omit<ActivityEvent, 'type'> &
  TransferEvent & {
    type: EventType.activityTransfer;
  };

export type BillTransferEvent = Omit<BillEvent, 'type'> &
  TransferEvent & {
    type: EventType.billTransfer;
  };

export type PensionEvent = TimelineEvent & {
  type: EventType.pension;
  pension: Pension;
  ownerAge: number;
  firstPayment: boolean;
};

export type SocialSecurityEvent = TimelineEvent & {
  type: EventType.socialSecurity;
  socialSecurity: SocialSecurity;
  ownerAge: number;
  firstPayment: boolean;
};

export type TaxEvent = TimelineEvent & {
  type: EventType.tax;
};

export type RMDEvent = TimelineEvent &
  TransferEvent & {
    type: EventType.rmd;
    ownerAge: number;
  };

export type Segment = {
  /** Unique identifier */
  id: string;
  /** Start date of the segment */
  startDate: Date;
  /** End date of the segment */
  endDate: Date;
  /** Events contained in this segment */
  events: TimelineEvent[];
  /** Accounts affected by this segment */
  affectedAccountIds: Set<string>;
  /** Whether this segment's results are cached */
  cached: boolean;
  /** Hash for cache invalidation */
  cacheKey: string;
};

/**
 * Cache entry for segments or calculations
 */
export interface CacheEntry<T> {
  /** The cached data */
  data: T;
  /** When this entry was created */
  timestamp: Date;
  /** Expiration time (null = never expires) */
  expiresAt: Date | null;
}

export type CacheOptions = {
  expiresAt: Date | null; // Expiration time in milliseconds
};

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
  /** Events that have been processed up to this point */
  processedEventIds: Set<string>;
}

export type BalanceSnapshotData = {
  date: DateString;
  balances: Record<string, number>;
  activityIndices: Record<string, number>;
  processedEventIds: string[];
};

export enum MonteCarloSampleType {
  HYSA = 'HYSA',
  LYSA = 'LYSA',
  PORTFOLIO = 'Portfolio',
  INFLATION = 'Inflation',
  RAISE = 'Raise',
  LIMIT_INCREASE_401K = '401k_limit_increase_rate',
}

export interface HistoricRates {
  investment: {
    stock?: number[];
    bond?: number[];
    cash?: number[];
    preferred?: ProxyDefinition;
    convertible?: ProxyDefinition;
    other?: ProxyDefinition;
  };
  savings: {
    highYield: number[];
    lowYield: number[];
  };
  inflation: number[];
  raise: number[];
  limitIncrease401k: number[];
}

export interface ProxyDefinition {
  proxy: Record<string, number>;
}

export interface PortfolioComposition {
  cash: number;
  stock: number;
  bond: number;
  preferred: number;
  convertible: number;
  other: number;
}

export interface PortfolioMakeupOverTime {
  [year: string]: PortfolioComposition;
}

export interface MonteCarloConfig {
  enabled: boolean;
  handler: any; // Using any to avoid circular dependency
  simulationNumber: number;
  totalSimulations: number;
}
