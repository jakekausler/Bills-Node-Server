import { AccountsAndTransfers } from '../../data/account/types';
import { Activity } from '../../data/activity/activity';
import { ConsolidatedActivityData } from '../../data/activity/types';
import { Bill } from '../../data/bill/bill';
import { Interest } from '../../data/interest/interest';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { DateString } from '../date/types';
import { FilingStatus } from './bracket-calculator';
import type { DebugLogger } from './debug-logger';
import type { TaxScenario } from './tax-profile-types';

export type IncomeType = 'ordinary' | 'retirement' | 'socialSecurity' | 'interest' | 'penalty' | 'shortTermCapitalGain' | 'longTermCapitalGain' | 'qualifiedDividend' | 'ordinaryDividend';

// Re-export FilingStatus for convenience
export type { FilingStatus };

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
  seed?: number; // Optional seed for reproducible Monte Carlo
  debugLogger?: DebugLogger | null; // Optional debug logger for detailed calculation tracing
  filingStatus?: FilingStatus;
  bracketInflationRate?: number;
  withdrawalStrategy?: 'manual' | 'taxOptimized'; // Account withdrawal strategy
  taxAccountName?: string; // Explicit account name for tax events (from taxConfig)
  taxScenario?: TaxScenario; // Tax scenario for bracket evolution
  /**
   * Optional callback fired after each segment is processed (hit or miss path).
   * Production code should leave this undefined.
   */
  onSegmentComplete?: (segmentId: string, segmentEndDate: Date, snapshot: ManagerStatesSnapshot) => void;
};

/**
 * Snapshot of all manager states at a point in time.
 * Used by onSegmentComplete callback and test harness.
 */
export interface ManagerStatesSnapshot {
  tax: {
    years: Array<{
      year: number;
      occurrencesByAccount: Record<string, Array<{ amount: number; incomeType: string; date?: string }>>;
      withholding: Array<{ source: string; federal: number; state: number }>;
      fica: Array<{ source: string; ssTax: number; medicareTax: number }>;
    }>;
    capitalLossCarryforward: number;
  } | null;
  healthcare: {
    trackers: Array<{
      key: string;
      planYear: number;
      lastResetCheck: string;
      individualDeductible: Record<string, number>;
      individualOOP: Record<string, number>;
      familyDeductible: number;
      familyOOP: number;
    }>;
  } | null;
  spendingTracker: {
    categories: Array<{
      id: string;
      carryBalance: number;
      periodSpending: number;
      lastProcessedPeriodEnd: string | null;
      hasHadActivity: boolean;
    }>;
  } | null;
  retirement: {
    socialSecurity: Array<{ name: string; monthlyPay: number; firstPaymentYear: number | null }>;
    pensions: Array<{ name: string; monthlyPay: number; firstPaymentYear: number | null }>;
  } | null;
  medicare: ReturnType<import('./medicare-manager').MedicareManager['snapshot']> | null;
  aca: ReturnType<import('./aca-manager').AcaManager['snapshot']> | null;
}

export type TaxableOccurrence = {
  /** Date of the taxable event */
  date: Date;
  /** Year of the taxable event */
  year: number;
  /** Amount of the taxable event */
  amount: number;
  /** Type of income for this taxable event */
  incomeType: IncomeType;
};

export type TaxableOccurrenceData = {
  date: DateString;
  year: number;
  amount: number;
  incomeType: IncomeType;
};

export type WithholdingOccurrence = {
  date: Date;
  year: number;
  federalAmount: number;
  stateAmount: number;
  source: string;
};

export type WithholdingOccurrenceData = {
  date: string;
  year: number;
  federalAmount: number;
  stateAmount: number;
  source: string;
};

/**
 * Records a spending tracker period completion for cache replay.
 */
export interface SpendingTrackerUpdate {
  categoryId: string;
  totalSpent: number;
  date: Date;
  periodEnd: Date;
  carryAfter: number;
}

export type SpendingTrackerUpdateData = {
  categoryId: string;
  totalSpent: number;
  date: DateString;
  periodEnd: DateString;
  carryAfter: number;
};

/**
 * Records a single healthcare expense update captured during cold compute,
 * for direct replay into recordHealthcareExpense on cache hit.
 */
export interface HealthcareExpenseUpdate {
  personName: string;
  date: Date;
  amountTowardDeductible: number;
  amountTowardOOP: number;
  configId: string; // HealthcareConfig.id — used to look up config on replay
}

export type HealthcareExpenseUpdateData = {
  personName: string;
  date: DateString;
  amountTowardDeductible: number;
  amountTowardOOP: number;
  configId: string;
};

export type RetirementStateUpdate =
  | { type: 'socialSecurityMonthlyPay'; name: string; value: number }
  | { type: 'socialSecurityFirstPaymentYear'; name: string; year: number }
  | { type: 'pensionMonthlyPay'; name: string; value: number }
  | { type: 'pensionFirstPaymentYear'; name: string; year: number }
  | { type: 'annualIncomeSS'; name: string; year: number; value: number }
  | { type: 'annualIncomePension'; name: string; year: number; value: number };

// Serialized form is identical — all fields are JSON-safe primitives.
export type RetirementStateUpdateData = RetirementStateUpdate;

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
  /** Taxable occurrences indexed by account name */
  taxableOccurrences: Map<string, TaxableOccurrence[]>;
  /** Withholding occurrences indexed by account name */
  withholdingOccurrences: Map<string, WithholdingOccurrence[]>;
  /** FICA occurrences keyed by year (source + ssTax + medicareTax per paycheck) */
  ficaOccurrences: Map<number, Array<{ source: string; ssTax: number; medicareTax: number }>>;
  /** Spending tracker period completions for cache replay */
  spendingTrackerUpdates: SpendingTrackerUpdate[];
  /** Healthcare expense updates captured during cold compute for cache replay */
  healthcareExpenseUpdates: HealthcareExpenseUpdate[];
  /** Retirement state mutations captured during cold compute for cache replay */
  retirementStateUpdates: RetirementStateUpdate[];
  /** Accounts and Transfers */
  accountsAndTransfers?: AccountsAndTransfers;
}

export type SegmentResultData = {
  balanceChanges: Record<string, number>;
  activitiesAdded: Record<string, ConsolidatedActivityData[]>;
  processedEventIds: string[];
  balanceMinimums: Record<string, number>;
  balanceMaximums: Record<string, number>;
  taxableOccurrences: Record<string, TaxableOccurrenceData[]>;
  withholdingOccurrences: Record<string, WithholdingOccurrenceData[]>;
  ficaOccurrences: Record<number, Array<{ source: string; ssTax: number; medicareTax: number }>>;
  spendingTrackerUpdates: SpendingTrackerUpdateData[];
  healthcareExpenseUpdates: HealthcareExpenseUpdateData[];
  retirementStateUpdates: RetirementStateUpdateData[];
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
  spendingTracker = 'spendingTracker',
  rothConversion = 'rothConversion',
  medicarePremium = 'medicarePremium',
  medicareHospital = 'medicareHospital',
  acaPremium = 'acaPremium',
  ltcCheck = 'ltcCheck',
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

export type SpendingTrackerEvent = TimelineEvent & {
  type: EventType.spendingTracker;
  categoryId: string;
  categoryName: string;
  periodStart: Date;
  periodEnd: Date;
  firstSpendingTracker: boolean;
  /** Virtual events process carry but don't create remainder activities.
   *  These are periods before the category's startDate. */
  virtual: boolean;
};

export type RothConversionEvent = TimelineEvent & {
  type: EventType.rothConversion;
  year: number;
};

export type MedicarePremiumEvent = TimelineEvent & {
  type: EventType.medicarePremium;
  personName: string;
  ownerAge: number;
  year: number;
};

export type MedicareHospitalEvent = TimelineEvent & {
  type: EventType.medicareHospital;
  personName: string;
  ownerAge: number;
  year: number;
};

export type AcaPremiumEvent = TimelineEvent & {
  type: EventType.acaPremium;
  personName: string;
  ownerAge: number;
  year: number;
  retirementDate: Date;
  isCobraPeriod: boolean;
  birthDate1: Date;
  birthDate2: Date;
};

export type LTCCheckEvent = TimelineEvent & {
  type: EventType.ltcCheck;
  personName: string;
  gender: string;
  ownerAge: number;
  year: number;
  birthDate: Date;
  monthIndex: number;
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
  expiresAt: Date | null; // Absolute expiration date
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
  HEALTHCARE_INFLATION = 'HealthcareInflation',
  RAISE = 'Raise',
  LIMIT_INCREASE_401K = '401k_limit_increase_rate',
  SS_COLA = 'SS_COLA',
  SS_WAGE_BASE_CHANGE = 'SS_WAGE_BASE_CHANGE',
  K401_LIMIT_CHANGE = 'K401_LIMIT_CHANGE',
  IRA_LIMIT_CHANGE = 'IRA_LIMIT_CHANGE',
  HSA_LIMIT_CHANGE = 'HSA_LIMIT_CHANGE',
  AWI_GROWTH = 'AWI_GROWTH',
  UNEMPLOYMENT_RATE = 'UnemploymentRate',
  UNEMPLOYMENT_DURATION = 'UnemploymentDuration',
  STOCK_RETURN = 'StockReturn',
  BOND_RETURN = 'BondReturn',
  CASH_RETURN = 'CashReturn',
  PREFERRED_RETURN = 'PreferredReturn',
  CONVERTIBLE_RETURN = 'ConvertibleReturn',
  OTHER_RETURN = 'OtherReturn',
  HOME_APPRECIATION = 'homeAppreciation',
  TERM_LIFE_PPI = 'TermLifePPI',
  WHOLE_LIFE_PPI = 'WholeLifePPI',
  WHOLE_LIFE_DIVIDEND = 'WholeLifeDividend',
}

/**
 * Function type for retrieving MC-sampled rates.
 * Returns the MC rate for a given sample type and year, or null in deterministic mode.
 */
export type MCRateGetter = (type: MonteCarloSampleType, year: number) => number | null;

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
  healthcareCpi?: number[];
  raise: number[];
  limitIncrease401k: number[];
  ssCola?: number[];
  ssWageBase?: Record<string, number>;
  homeAppreciation: number[];
  unemploymentRate?: number[];
  unemploymentDuration?: number[];
  termLifePPI?: Record<string, number>;
  wholeLifePPI?: Record<string, number>;
  wholeLifeDividendScale?: Record<string, number>;
  contributionLimits?: {
    '401k'?: Record<string, number>;
    'ira'?: Record<string, number>;
    'hsa'?: Record<string, number>;
  };
  medicare?: {
    partBPremium?: Record<string, number>;
    partBDeductible?: Record<string, number>;
    partADeductible?: Record<string, number>;
    partDBasePremium?: Record<string, number>;
    medigapPlanG?: Record<string, number>;
  };
  totalAdditionLimit415c?: Record<string, number>;
  catchUpLimits?: {
    '401k'?: Record<string, number>;
    'ira'?: Record<string, number>;
    'hsa'?: Record<string, number>;
  };
  hsaFamilyLimits?: Record<string, number>;
  changeRatios?: {
    ssWageBase?: Record<string, number>;
    '401k'?: Record<string, number>;
    'ira'?: Record<string, number>;
    'hsa'?: Record<string, number>;
    partBPremium?: Record<string, number>;
    partBDeductible?: Record<string, number>;
    partADeductible?: Record<string, number>;
    partDBasePremium?: Record<string, number>;
    medigapPlanG?: Record<string, number>;
  };
  yearKeyed?: Record<string, Partial<{
    stock: number;
    bond: number;
    cash: number;
    highYield: number;
    lowYield: number;
    inflation: number;
    healthcareCpi: number;
    raise: number;
    limitIncrease401k: number;
    ssCola: number;
    ssWageBase: number;
    ssWageBaseRatio: number;
    k401Ratio: number;
    iraRatio: number;
    hsaRatio: number;
    awiGrowthRatio: number;
    unemploymentRate: number;
    unemploymentDuration: number;
    homeAppreciation: number;
    termLifePPI: number;
    wholeLifePPI: number;
    wholeLifeDividendScale: number;
  }>>;
  awi?: Record<string, number>;
  awiGrowthRatio?: Record<string, number>;
  employerPremium?: Record<string, number>;
  acaBenchmarkPremium?: Record<string, number>;
  acaAgeCurve?: Record<string, number>;
  acaOutOfPocketMax?: Record<string, number>;
  fpl?: Record<string, { firstPerson: number; additionalPerson: number }>;
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
  variableMappings: Record<string, string>;
}

export type PaycheckResult = {
  netPay: number;
  grossPay: number;
  traditional401k: number;
  roth401k: number;
  employerMatch: number;
  hsa: number;
  hsaEmployer: number;
  ssTax: number;
  medicareTax: number;
  federalWithholding: number;
  stateWithholding: number;
  preTaxDeductions: { label: string; amount: number }[];
  postTaxDeductions: { label: string; amount: number }[];
  depositActivities: { accountId: string; amount: number; label: string }[];
};

/**
 * Unified year-end tax reconciliation result
 */
export type TaxReconciliation = {
  year: number;
  // Income
  totalOrdinaryIncome: number;
  totalSSIncome: number;
  totalIncome: number;
  // AGI
  aboveTheLineDeductions: number;
  agi: number;
  // Deductions
  standardDeduction: number;
  itemizedDeduction: number;
  deductionUsed: 'standard' | 'itemized';
  deductionAmount: number;
  personalExemption: number;
  // Taxable income
  taxableIncome: number;
  // Tax
  federalTax: number;
  ssTax: number; // tax ON SS benefits (0/50/85% rule)
  stateTax: number;
  credits: number;
  totalTaxOwed: number;
  // Withholding
  totalFederalWithheld: number;
  totalStateWithheld: number;
  totalWithheld: number;
  // FICA reconciliation
  ficaOverpayment: number;
  // Capital gains
  shortTermCapitalGains: number;
  longTermCapitalGains: number;
  qualifiedDividends: number;
  ordinaryDividends: number;
  niitTax: number;
  capitalLossCarryforwardUsed: number;
  capitalLossCarryforwardRemaining: number;
  longTermCapitalGainsTax: number;
  // Early withdrawal penalty (10% penalty on early retirement account withdrawals)
  penaltyTotal: number;
  // Settlement
  settlement: number; // positive = owes, negative = refund
};
