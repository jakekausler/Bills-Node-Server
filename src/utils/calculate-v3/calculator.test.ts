// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.fn() for dependency managers; real data classes for Activity/Bill/Account/Interest
// - Async: async/await
// - Structure: describe/it blocks with beforeEach

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock filesystem-accessing modules BEFORE any imports that use them
// ---------------------------------------------------------------------------

vi.mock('../simulation/loadVariableValue', () => ({
  loadNumberOrVariable: vi.fn(
    (amount: any, isVariable: boolean, variable: string | null) => ({
      amount: typeof amount === 'number' ? amount : 0,
      amountIsVariable: isVariable,
      amountVariable: variable,
    }),
  ),
  loadDateOrVariable: vi.fn(
    (date: string, isVariable: boolean, variable: string | null) => ({
      date: new Date(date),
      dateIsVariable: isVariable,
      dateVariable: variable,
    }),
  ),
}));

vi.mock('../simulation/variable', () => ({
  loadVariable: vi.fn(() => 0.025), // default 2.5% COLA
}));

vi.mock('../io/io', () => ({
  load: vi.fn(() => ({ accounts: [], transfers: [] })),
  save: vi.fn(),
}));

vi.mock('../io/retirement', () => ({
  loadPensionsAndSocialSecurity: vi.fn(() => ({ pensions: [], socialSecurities: [] })),
}));

vi.mock('../io/averageWageIndex', () => ({
  loadAverageWageIndex: vi.fn(() => []),
}));

vi.mock('../io/bendPoints', () => ({
  loadBendPoints: vi.fn(() => []),
}));

vi.mock('../io/minDate', () => ({
  minDate: vi.fn(() => new Date('2024-01-01')),
}));

// ---------------------------------------------------------------------------
// Now import real modules
// ---------------------------------------------------------------------------

import { Calculator } from './calculator';
import { SegmentResult, EventType } from './types';
import type {
  ActivityEvent,
  BillEvent,
  InterestEvent,
  ActivityTransferEvent,
  BillTransferEvent,
  PensionEvent,
  SocialSecurityEvent,
  TaxEvent,
  RMDEvent,
  SpendingTrackerEvent,
} from './types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { Account } from '../../data/account/account';
import { Interest } from '../../data/interest/interest';
import { loadVariable } from '../simulation/variable';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeSegmentResult(): SegmentResult {
  return {
    balanceChanges: new Map<string, number>(),
    activitiesAdded: new Map<string, ConsolidatedActivity[]>(),
    processedEventIds: new Set<string>(),
    balanceMinimums: new Map<string, number>(),
    balanceMaximums: new Map<string, number>(),
    taxableOccurrences: new Map<string, any[]>(),
    spendingTrackerUpdates: [],
  };
}

function makeAccount(overrides: Partial<{
  id: string;
  name: string;
  type: string;
  interestTaxRate: number;
  withdrawalTaxRate: number;
  earlyWithdrawalPenalty: number;
  earlyWithdrawalDate: Date | null;
  interestPayAccount: string | null;
  interestAppliesToPositiveBalance: boolean;
  expenseRatio: number;
  usesRMD: boolean;
  rmdAccount: string | null;
  pullPriority: number;
}> = {}): Account {
  // Use a plain object mock that satisfies Account shape without invoking the
  // real constructor (which would try to parse bills/activities).
  return {
    id: overrides.id ?? 'account-1',
    name: overrides.name ?? 'Test Account',
    type: overrides.type ?? 'Checking',
    interestTaxRate: overrides.interestTaxRate ?? 0,
    withdrawalTaxRate: overrides.withdrawalTaxRate ?? 0,
    earlyWithdrawalPenalty: overrides.earlyWithdrawalPenalty ?? 0,
    earlyWithdrawalDate: overrides.earlyWithdrawalDate ?? null,
    interestPayAccount: overrides.interestPayAccount ?? null,
    interestAppliesToPositiveBalance: overrides.interestAppliesToPositiveBalance !== undefined
      ? overrides.interestAppliesToPositiveBalance
      : true,
    expenseRatio: overrides.expenseRatio ?? 0,
    usesRMD: overrides.usesRMD ?? false,
    rmdAccount: overrides.rmdAccount ?? null,
    pullPriority: overrides.pullPriority ?? -1,
    activity: [],
    bills: [],
    interests: [],
    consolidatedActivity: [],
    todayBalance: 0,
    hidden: false,
    serialize: vi.fn(() => ({})),
  } as unknown as Account;
}

function makeActivityData(overrides: Partial<{
  id: string;
  name: string;
  amount: number;
  date: string;
  isTransfer: boolean;
  isHealthcare: boolean;
  healthcarePerson: string | null;
  category: string;
  flag: boolean;
  flagColor: string | null;
  amountIsVariable: boolean;
  amountVariable: string | null;
  from: string | null;
  to: string | null;
  spendingCategory: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'act-1',
    name: overrides.name ?? 'Test Activity',
    amount: overrides.amount ?? 100,
    date: overrides.date ?? '2024-01-15',
    isTransfer: overrides.isTransfer ?? false,
    isHealthcare: overrides.isHealthcare ?? false,
    healthcarePerson: overrides.healthcarePerson ?? null,
    category: overrides.category ?? 'Test',
    flag: overrides.flag ?? false,
    flagColor: overrides.flagColor ?? null,
    amountIsVariable: overrides.amountIsVariable ?? false,
    amountVariable: overrides.amountVariable ?? null,
    from: overrides.from ?? null,
    to: overrides.to ?? null,
    spendingCategory: overrides.spendingCategory ?? null,
    dateIsVariable: false,
    dateVariable: null,
  };
}

function makeActivity(overrides: Parameters<typeof makeActivityData>[0] = {}): Activity {
  return new Activity(makeActivityData(overrides) as any);
}

function makeBillData(overrides: Partial<{
  id: string;
  name: string;
  amount: number | string;
  startDate: string;
  endDate: string | null;
  isTransfer: boolean;
  isHealthcare: boolean;
  healthcarePerson: string | null;
  category: string;
  everyN: number;
  periods: string;
  increaseBy: number;
  from: string | null;
  to: string | null;
  spendingCategory: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'bill-1',
    name: overrides.name ?? 'Test Bill',
    amount: overrides.amount ?? -500,
    startDate: overrides.startDate ?? '2024-01-01',
    endDate: overrides.endDate ?? null,
    isTransfer: overrides.isTransfer ?? false,
    isHealthcare: overrides.isHealthcare ?? false,
    healthcarePerson: overrides.healthcarePerson ?? null,
    category: overrides.category ?? 'Test',
    everyN: overrides.everyN ?? 1,
    periods: overrides.periods ?? 'month',
    increaseBy: overrides.increaseBy ?? 0,
    increaseByIsVariable: false,
    increaseByVariable: null,
    increaseByDate: '01/01',
    ceilingMultiple: 0,
    monteCarloSampleType: null,
    annualStartDate: null,
    annualEndDate: null,
    isAutomatic: false,
    startDateIsVariable: false,
    startDateVariable: null,
    endDateIsVariable: false,
    endDateVariable: null,
    amountIsVariable: false,
    amountVariable: null,
    flag: false,
    flagColor: null,
    copayAmount: null,
    coinsurancePercent: null,
    countsTowardDeductible: true,
    countsTowardOutOfPocket: true,
    from: overrides.from ?? null,
    to: overrides.to ?? null,
    spendingCategory: overrides.spendingCategory ?? null,
  };
}

function makeBill(overrides: Parameters<typeof makeBillData>[0] = {}): Bill {
  return new Bill(makeBillData(overrides) as any);
}

function makeInterestData(overrides: Partial<{
  id: string;
  rate: number;
  compounded: string;
  applicableDate: string;
}> = {}) {
  return {
    id: overrides.id ?? 'int-1',
    rate: overrides.rate ?? 0.05,
    compounded: overrides.compounded ?? 'monthly',
    applicableDate: overrides.applicableDate ?? '2024-01-01',
    accountName: 'Test Account',
  };
}

function makeInterest(overrides: Parameters<typeof makeInterestData>[0] = {}): Interest {
  return new Interest(makeInterestData(overrides) as any);
}

// ---------------------------------------------------------------------------
// Manager mocks
// ---------------------------------------------------------------------------

function makeBalanceTracker(overrides: Partial<{
  getAccountBalance: (id: string) => number;
  findAccountById: (id: string) => Account | undefined;
}> = {}) {
  return {
    getAccountBalance: overrides.getAccountBalance ?? vi.fn(() => 1000),
    findAccountById: overrides.findAccountById ?? vi.fn(() => undefined),
    applySegmentResult: vi.fn(),
    updateBalance: vi.fn(),
  };
}

function makeTaxManager(overrides: Partial<{
  calculateTotalTaxOwed: (id: string, year: number) => number;
}> = {}) {
  return {
    calculateTotalTaxOwed: overrides.calculateTotalTaxOwed ?? vi.fn(() => 0),
    addTaxableOccurrences: vi.fn(),
  };
}

function makeRetirementManager(overrides: Partial<{
  calculatePensionMonthlyPay: (pension: any) => void;
  getPensionMonthlyPay: (name: string) => number;
  getPensionFirstPaymentYear: (name: string) => number | null;
  calculateSocialSecurityMonthlyPay: (ss: any) => void;
  getSocialSecurityMonthlyPay: (name: string) => number;
  getSocialSecurityFirstPaymentYear: (name: string) => number | null;
  setSocialSecurityFirstPaymentYear: (name: string, year: number) => void;
  rmd: (balance: number, age: number) => number;
}> = {}) {
  return {
    calculatePensionMonthlyPay: overrides.calculatePensionMonthlyPay ?? vi.fn(),
    getPensionMonthlyPay: overrides.getPensionMonthlyPay ?? vi.fn(() => 1500),
    getPensionFirstPaymentYear: overrides.getPensionFirstPaymentYear ?? vi.fn(() => null),
    calculateSocialSecurityMonthlyPay: overrides.calculateSocialSecurityMonthlyPay ?? vi.fn(),
    getSocialSecurityMonthlyPay: overrides.getSocialSecurityMonthlyPay ?? vi.fn(() => 2000),
    getSocialSecurityFirstPaymentYear: overrides.getSocialSecurityFirstPaymentYear ?? vi.fn(() => null),
    setSocialSecurityFirstPaymentYear: overrides.setSocialSecurityFirstPaymentYear ?? vi.fn(),
    rmd: overrides.rmd ?? vi.fn(() => 5000),
    tryAddToAnnualIncomes: vi.fn(),
  };
}

function makeHealthcareManager(overrides: Partial<{
  getActiveConfig: (person: string, date: Date) => any;
  calculatePatientCost: (activity: any, config: any, date: Date) => number;
}> = {}) {
  return {
    getActiveConfig: overrides.getActiveConfig ?? vi.fn(() => null),
    calculatePatientCost: overrides.calculatePatientCost ?? vi.fn(() => 100),
    recordHealthcareExpense: vi.fn(),
  };
}

function makeAccountManager(overrides: Partial<{
  getAccountByName: (name: string) => Account | undefined;
}> = {}) {
  return {
    getAccountByName: overrides.getAccountByName ?? vi.fn(() => undefined),
    getAccountById: vi.fn(() => undefined),
  };
}

function makeSpendingTrackerManager(overrides: Partial<{
  getPeriodSpending: (id: string) => number;
  computeRemainder: (id: string, spent: number, date: Date) => number;
  getCarryBalance: (id: string) => number;
  getEffectiveThreshold: (id: string, date: Date) => { baseThreshold: number; effectiveThreshold: number };
  isBeforeInitializeDate: (id: string, date: Date) => boolean;
}> = {}) {
  return {
    getPeriodSpending: overrides.getPeriodSpending ?? vi.fn(() => 0),
    computeRemainder: overrides.computeRemainder ?? vi.fn(() => 50),
    getCarryBalance: overrides.getCarryBalance ?? vi.fn(() => 0),
    getEffectiveThreshold:
      overrides.getEffectiveThreshold ?? vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
    isBeforeInitializeDate: overrides.isBeforeInitializeDate ?? vi.fn(() => false),
    updateCarry: vi.fn(),
    resetPeriodSpending: vi.fn(),
    markPeriodProcessed: vi.fn(),
    setCarryBalance: vi.fn(),
    recordSegmentActivities: vi.fn(),
    checkpoint: vi.fn(),
    restore: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Calculator factory
// ---------------------------------------------------------------------------

function makeCalculator(opts: {
  balanceTracker?: ReturnType<typeof makeBalanceTracker>;
  taxManager?: ReturnType<typeof makeTaxManager>;
  retirementManager?: ReturnType<typeof makeRetirementManager>;
  healthcareManager?: ReturnType<typeof makeHealthcareManager>;
  accountManager?: ReturnType<typeof makeAccountManager>;
  spendingTrackerManager?: ReturnType<typeof makeSpendingTrackerManager>;
  simulation?: string;
} = {}): Calculator {
  return new Calculator(
    (opts.balanceTracker ?? makeBalanceTracker()) as any,
    (opts.taxManager ?? makeTaxManager()) as any,
    (opts.retirementManager ?? makeRetirementManager()) as any,
    (opts.healthcareManager ?? makeHealthcareManager()) as any,
    (opts.accountManager ?? makeAccountManager()) as any,
    opts.simulation ?? 'Default',
    (opts.spendingTrackerManager ?? makeSpendingTrackerManager()) as any,
    opts.filingStatus ?? 'mfj',
    opts.bracketInflationRate ?? 0.03,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Calculator', () => {

  // ─── processActivityEvent ────────────────────────────────────────────────

  describe('processActivityEvent', () => {
    it('adds the activity to activitiesAdded and returns balance change', () => {
      const calculator = makeCalculator();
      const segmentResult = makeSegmentResult();
      const activity = makeActivity({ id: 'act-1', amount: 250 });

      const event: ActivityEvent = {
        id: 'evt-1',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: activity,
      };

      const result = calculator.processActivityEvent(event, segmentResult);

      expect(result.get('account-1')).toBe(250);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(250);
      expect(segmentResult.activitiesAdded.get('account-1')).toHaveLength(1);
    });

    it('accumulates balance changes when the same account has multiple events', () => {
      const calculator = makeCalculator();
      const segmentResult = makeSegmentResult();

      const event1: ActivityEvent = {
        id: 'evt-1',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: makeActivity({ id: 'act-1', amount: 100 }),
      };
      const event2: ActivityEvent = {
        id: 'evt-2',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: makeActivity({ id: 'act-2', amount: 200 }),
      };

      calculator.processActivityEvent(event1, segmentResult);
      calculator.processActivityEvent(event2, segmentResult);

      expect(segmentResult.balanceChanges.get('account-1')).toBe(300);
      expect(segmentResult.activitiesAdded.get('account-1')).toHaveLength(2);
    });

    it('routes healthcare activities to healthcare processor when isHealthcare is true', () => {
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => null), // No config → falls through as regular activity
      });
      const calculator = makeCalculator({ healthcareManager });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'hc-1', amount: -200, isHealthcare: true, healthcarePerson: 'John' });
      const event: ActivityEvent = {
        id: 'evt-hc',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: activity,
      };

      const result = calculator.processActivityEvent(event, segmentResult);

      expect(healthcareManager.getActiveConfig).toHaveBeenCalledWith('John', event.date);
      // With no config, processed as regular activity
      expect(result.get('account-1')).toBe(-200);
    });

    it('calculates patient cost when healthcare activity has a config', () => {
      const mockConfig = { hsaReimbursementEnabled: false, hsaAccountId: null };
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => mockConfig),
        calculatePatientCost: vi.fn(() => 75),
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 0),
        findAccountById: vi.fn(() => undefined),
      });
      const calculator = makeCalculator({ healthcareManager, balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'hc-2', amount: -200, isHealthcare: true, healthcarePerson: 'Jane' });
      const event: ActivityEvent = {
        id: 'evt-hc2',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: activity,
      };

      const result = calculator.processActivityEvent(event, segmentResult);

      expect(healthcareManager.calculatePatientCost).toHaveBeenCalledWith(activity, mockConfig, event.date);
      // Patient cost 75 → balance change -75
      expect(result.get('account-1')).toBe(-75);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(-75);
    });

    it('generates HSA reimbursement when config has it enabled', () => {
      const mockConfig = {
        hsaReimbursementEnabled: true,
        hsaAccountId: 'hsa-account',
      };
      const hsaAccount = makeAccount({ id: 'hsa-account', name: 'HSA Account' });
      const paymentAccount = makeAccount({ id: 'account-1', name: 'Checking' });
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => mockConfig),
        calculatePatientCost: vi.fn(() => 100),
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'hsa-account' ? 500 : 1000)),
        findAccountById: vi.fn((id: string) => (id === 'hsa-account' ? hsaAccount : paymentAccount)),
      });
      const calculator = makeCalculator({ healthcareManager, balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'hc-3', amount: -200, isHealthcare: true, healthcarePerson: 'John' });
      const event: ActivityEvent = {
        id: 'evt-hsa',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: activity,
      };

      calculator.processActivityEvent(event, segmentResult);

      // HSA account should have a withdrawal activity
      expect(segmentResult.activitiesAdded.get('hsa-account')).toBeDefined();
      expect(segmentResult.activitiesAdded.get('hsa-account')!.length).toBeGreaterThanOrEqual(1);
      // The HSA withdrawal should be negative (money leaving HSA)
      expect(segmentResult.activitiesAdded.get('hsa-account')![0].amount).toBe(-100);
      // Payment account should have a positive deposit
      // (healthcare expense -100 AND reimbursement +100 → net 0 but 2 activities)
      const payActivities = segmentResult.activitiesAdded.get('account-1')!;
      expect(payActivities.length).toBeGreaterThanOrEqual(2);
    });

    it('caps HSA reimbursement at available HSA balance', () => {
      const mockConfig = {
        hsaReimbursementEnabled: true,
        hsaAccountId: 'hsa-account',
      };
      const hsaAccount = makeAccount({ id: 'hsa-account', name: 'HSA Account' });
      const paymentAccount = makeAccount({ id: 'account-1', name: 'Checking' });
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => mockConfig),
        calculatePatientCost: vi.fn(() => 500), // Patient cost is 500
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'hsa-account' ? 200 : 1000)), // Only $200 in HSA
        findAccountById: vi.fn((id: string) => (id === 'hsa-account' ? hsaAccount : paymentAccount)),
      });
      const calculator = makeCalculator({ healthcareManager, balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'hc-cap', amount: -500, isHealthcare: true, healthcarePerson: 'John' });
      const event: ActivityEvent = {
        id: 'evt-cap',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: activity,
      };

      calculator.processActivityEvent(event, segmentResult);

      // HSA withdrawal should be capped at $200
      const hsaActivities = segmentResult.activitiesAdded.get('hsa-account')!;
      expect(hsaActivities[0].amount).toBe(-200); // Capped at HSA balance
    });

    it('does not generate HSA reimbursement when HSA balance is zero', () => {
      const mockConfig = {
        hsaReimbursementEnabled: true,
        hsaAccountId: 'hsa-account',
      };
      const hsaAccount = makeAccount({ id: 'hsa-account', name: 'HSA Account' });
      const paymentAccount = makeAccount({ id: 'account-1', name: 'Checking' });
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => mockConfig),
        calculatePatientCost: vi.fn(() => 150),
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 0), // HSA is empty
        findAccountById: vi.fn((id: string) => (id === 'hsa-account' ? hsaAccount : paymentAccount)),
      });
      const calculator = makeCalculator({ healthcareManager, balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'hc-empty', amount: -150, isHealthcare: true, healthcarePerson: 'Bob' });
      const event: ActivityEvent = {
        id: 'evt-empty-hsa',
        type: EventType.activity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalActivity: activity,
      };

      calculator.processActivityEvent(event, segmentResult);

      // No HSA reimbursement when balance is 0
      expect(segmentResult.activitiesAdded.get('hsa-account')).toBeUndefined();
    });
  });

  // ─── processBillEvent ─────────────────────────────────────────────────────

  describe('processBillEvent', () => {
    it('adds bill activity to segment result and returns balance change', () => {
      const calculator = makeCalculator();
      const segmentResult = makeSegmentResult();
      const bill = makeBill({ id: 'bill-1', amount: -500 });

      const event: BillEvent = {
        id: 'evt-bill-1',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 1,
        originalBill: bill,
        amount: -500,
        firstBill: true,
      };

      const result = calculator.processBillEvent(event, segmentResult, 'Default');

      expect(result.get('account-1')).toBe(-500);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(-500);
      expect(segmentResult.activitiesAdded.get('account-1')).toHaveLength(1);
    });

    it('accumulates balance changes for repeated bills on same account', () => {
      const calculator = makeCalculator();
      const segmentResult = makeSegmentResult();

      const event1: BillEvent = {
        id: 'evt-bill-a',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 1,
        originalBill: makeBill({ id: 'bill-a', amount: -100 }),
        amount: -100,
        firstBill: false,
      };
      const event2: BillEvent = {
        id: 'evt-bill-b',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 1,
        originalBill: makeBill({ id: 'bill-b', amount: -200 }),
        amount: -200,
        firstBill: false,
      };

      calculator.processBillEvent(event1, segmentResult, 'Default');
      calculator.processBillEvent(event2, segmentResult, 'Default');

      expect(segmentResult.balanceChanges.get('account-1')).toBe(-300);
      expect(segmentResult.activitiesAdded.get('account-1')).toHaveLength(2);
    });

    it('routes healthcare bill to healthcare processor', () => {
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => null),
      });
      const calculator = makeCalculator({ healthcareManager });
      const segmentResult = makeSegmentResult();
      const bill = makeBill({ id: 'bill-hc', amount: -300, isHealthcare: true, healthcarePerson: 'Bob' });

      const event: BillEvent = {
        id: 'evt-bill-hc',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 1,
        originalBill: bill,
        amount: -300,
        firstBill: false,
      };

      calculator.processBillEvent(event, segmentResult, 'Default');

      expect(healthcareManager.getActiveConfig).toHaveBeenCalledWith('Bob', event.date);
    });

    it('uses healthcare patient cost when config is found for bill', () => {
      const mockConfig = { hsaReimbursementEnabled: false, hsaAccountId: null };
      const healthcareManager = makeHealthcareManager({
        getActiveConfig: vi.fn(() => mockConfig),
        calculatePatientCost: vi.fn(() => 150),
      });
      const calculator = makeCalculator({ healthcareManager });
      const segmentResult = makeSegmentResult();
      const bill = makeBill({ id: 'bill-hc2', amount: -300, isHealthcare: true, healthcarePerson: 'Alice' });

      const event: BillEvent = {
        id: 'evt-bill-hc2',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-2',
        priority: 1,
        originalBill: bill,
        amount: -300,
        firstBill: true,
      };

      const result = calculator.processBillEvent(event, segmentResult, 'Default');

      expect(result.get('account-2')).toBe(-150);
      expect(segmentResult.balanceChanges.get('account-2')).toBe(-150);
    });
  });

  // ─── processInterestEvent ─────────────────────────────────────────────────

  describe('processInterestEvent', () => {
    it('calculates monthly interest and updates balance', () => {
      const account = makeAccount({
        id: 'account-1',
        name: 'Savings',
        interestAppliesToPositiveBalance: true,
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 12000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.06, compounded: 'monthly' });

      const event: InterestEvent = {
        id: 'evt-int',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.06,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);

      // Monthly rate = Math.pow(1.06, 1/12) - 1 ≈ 0.004867551, balance = 12000, interest ≈ 58.41
      expect(result.get('account-1')).toBeCloseTo(12000 * (Math.pow(1 + 0.06, 1 / 12) - 1), 2);
      expect(segmentResult.balanceChanges.get('account-1')).toBeCloseTo(12000 * (Math.pow(1 + 0.06, 1 / 12) - 1), 2);
      expect(segmentResult.activitiesAdded.get('account-1')).toHaveLength(1);
    });

    it('throws error when account not found', () => {
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => undefined),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.05, compounded: 'monthly' });

      const event: InterestEvent = {
        id: 'evt-int-err',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'nonexistent',
        priority: 2,
        originalInterest: interest,
        rate: 0.05,
        firstInterest: false,
      };

      expect(() => calculator.processInterestEvent(event, segmentResult)).toThrow(
        'Account nonexistent not found',
      );
    });

    it('returns empty map when balance is zero', () => {
      const account = makeAccount({ id: 'account-1' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 0),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.05 });

      const event: InterestEvent = {
        id: 'evt-int-zero',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.05,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('returns empty map when interest rate is zero', () => {
      const account = makeAccount({ id: 'account-1' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 10000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0 });

      const event: InterestEvent = {
        id: 'evt-int-rate0',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('skips interest on positive balance when interestAppliesToPositiveBalance is false', () => {
      const account = makeAccount({
        id: 'account-1',
        interestAppliesToPositiveBalance: false,
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 5000), // positive balance
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.2, compounded: 'yearly' });

      const event: InterestEvent = {
        id: 'evt-int-skip',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.2,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('still applies interest on negative balance even when interestAppliesToPositiveBalance is false', () => {
      const account = makeAccount({
        id: 'account-1',
        interestAppliesToPositiveBalance: false,
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => -5000), // negative balance (debt)
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.12, compounded: 'monthly' });

      const event: InterestEvent = {
        id: 'evt-int-neg',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.12,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);
      // -5000 * (Math.pow(1.12, 1/12) - 1) ≈ -5000 * 0.009488793 ≈ -47.44
      expect(result.get('account-1')).toBeCloseTo(-5000 * (Math.pow(1 + 0.12, 1 / 12) - 1), 2);
    });

    it('adds taxable occurrence when interestPayAccount and interestTaxRate are set', () => {
      const account = makeAccount({
        id: 'account-1',
        interestPayAccount: 'Checking',
        interestTaxRate: 0.25,
        interestAppliesToPositiveBalance: true,
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 12000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.06, compounded: 'monthly' });

      const event: InterestEvent = {
        id: 'evt-int-tax',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.06,
        firstInterest: false,
      };

      calculator.processInterestEvent(event, segmentResult);

      const taxable = segmentResult.taxableOccurrences.get('Checking');
      expect(taxable).toBeDefined();
      expect(taxable!).toHaveLength(1);
      expect(taxable![0].incomeType).toBe('interest');
      expect(taxable![0].year).toBe(2024);
    });

    it('adds taxable occurrence for interest even when interestTaxRate is 0 (track all interest income)', () => {
      const account = makeAccount({
        id: 'account-1',
        interestPayAccount: 'Checking',
        interestTaxRate: 0,
        interestAppliesToPositiveBalance: true,
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 12000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.06, compounded: 'monthly' });

      const event: InterestEvent = {
        id: 'evt-int-notax',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.06,
        firstInterest: false,
      };

      calculator.processInterestEvent(event, segmentResult);

      // Now tracks interest income regardless of flat rate value (for bracket calculation in Task 5)
      expect(segmentResult.taxableOccurrences.size).toBe(1);
      const taxable = segmentResult.taxableOccurrences.get('Checking');
      expect(taxable).toBeDefined();
      expect(taxable![0].incomeType).toBe('interest');
    });

    it('applies expense ratio to reduce interest on positive balance', () => {
      const account = makeAccount({
        id: 'account-1',
        expenseRatio: 0.003, // 0.30% expense ratio
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 10000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.06, compounded: 'monthly' }); // 6% APR

      const event: InterestEvent = {
        id: 'evt-int-expense',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.06,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);

      // Effective APR = 6% - 0.3% = 5.7%
      const effectiveApr = 0.06 - 0.003;
      const expectedInterest = 10000 * (Math.pow(1 + effectiveApr, 1 / 12) - 1);
      expect(result.get('account-1')).toBeCloseTo(expectedInterest, 2);
    });

    it('does not apply expense ratio to negative balance (debt)', () => {
      const account = makeAccount({
        id: 'account-1',
        expenseRatio: 0.003, // 0.30% expense ratio
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => -5000), // negative balance (debt)
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.12, compounded: 'monthly' }); // 12% APR

      const event: InterestEvent = {
        id: 'evt-int-debt',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.12,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);

      // Expense ratio should NOT apply to debt, so full 12% rate is used
      const expectedInterest = -5000 * (Math.pow(1 + 0.12, 1 / 12) - 1);
      expect(result.get('account-1')).toBeCloseTo(expectedInterest, 2);
    });

    it('zero expense ratio has no effect on interest', () => {
      const account = makeAccount({
        id: 'account-1',
        expenseRatio: 0, // no expense ratio
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 10000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.06, compounded: 'monthly' });

      const event: InterestEvent = {
        id: 'evt-int-zero-ratio',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.06,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);

      // With zero expense ratio, should get full 6% interest
      const expectedInterest = 10000 * (Math.pow(1 + 0.06, 1 / 12) - 1);
      expect(result.get('account-1')).toBeCloseTo(expectedInterest, 2);
    });
  });

  // ─── processInterestAmount: compounding frequencies (private, tested indirectly) ──

  describe('interest compounding frequencies', () => {
    function runInterestTest(compounded: string, expectedRate: number) {
      const account = makeAccount({ id: 'account-1', interestAppliesToPositiveBalance: true });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 12000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.12, compounded });

      const event: InterestEvent = {
        id: `evt-int-${compounded}`,
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.12,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);
      expect(result.get('account-1')).toBeCloseTo(12000 * expectedRate, 4);
    }

    it('handles "week" compounding', () => runInterestTest('week', Math.pow(1 + 0.12, 1 / 52) - 1));
    it('handles "weekly" compounding', () => runInterestTest('weekly', Math.pow(1 + 0.12, 1 / 52) - 1));
    it('handles "day" compounding', () => runInterestTest('day', Math.pow(1 + 0.12, 1 / 365) - 1));
    it('handles "daily" compounding', () => runInterestTest('daily', Math.pow(1 + 0.12, 1 / 365) - 1));
    it('handles "month" compounding', () => runInterestTest('month', Math.pow(1 + 0.12, 1 / 12) - 1));
    it('handles "monthly" compounding', () => runInterestTest('monthly', Math.pow(1 + 0.12, 1 / 12) - 1));
    it('handles "quarter" compounding', () => runInterestTest('quarter', Math.pow(1 + 0.12, 1 / 4) - 1));
    it('handles "quarterly" compounding', () => runInterestTest('quarterly', Math.pow(1 + 0.12, 1 / 4) - 1));
    it('handles "year" compounding', () => runInterestTest('year', 0.12 / 1));
    it('handles "yearly" compounding', () => runInterestTest('yearly', 0.12 / 1));

    it('defaults to monthly when compounding is undefined', () => {
      const account = makeAccount({ id: 'account-1', interestAppliesToPositiveBalance: true });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 12000),
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const interest = makeInterest({ rate: 0.12, compounded: undefined as any });

      const event: InterestEvent = {
        id: 'evt-int-undef',
        type: EventType.interest,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 2,
        originalInterest: interest,
        rate: 0.12,
        firstInterest: false,
      };

      const result = calculator.processInterestEvent(event, segmentResult);
      // Default monthly: 12000 * (Math.pow(1.12, 1/12) - 1) ≈ 12000 * 0.009488793 ≈ 113.865516
      expect(result.get('account-1')).toBeCloseTo(12000 * (Math.pow(1 + 0.12, 1 / 12) - 1), 2);
    });
  });

  // ─── processActivityTransferEvent / processBillTransferEvent ─────────────

  describe('processActivityTransferEvent', () => {
    it('transfers amount from one account to another', () => {
      const fromAccount = makeAccount({ id: 'from-acct', name: 'Checking', type: 'Checking' });
      const toAccount = makeAccount({ id: 'to-acct', name: 'Savings', type: 'Savings' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'from-acct' ? 2000 : 500)),
        findAccountById: vi.fn((id: string) => (id === 'from-acct' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      // Positive amount on activity: internalAmount = 300
      const activity = makeActivity({ id: 'xfer-1', amount: 300, isTransfer: true, from: 'Checking', to: 'Savings' });

      const event: ActivityTransferEvent = {
        id: 'evt-xfer',
        type: EventType.activityTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-acct',
        priority: 1,
        originalActivity: activity,
        fromAccountId: 'from-acct',
        toAccountId: 'to-acct',
      };

      const result = calculator.processActivityTransferEvent(event, segmentResult);

      // internalAmount = 300; from gets -300, to gets +300
      expect(result.get('from-acct')).toBe(-300);
      expect(result.get('to-acct')).toBe(300);
      expect(segmentResult.balanceChanges.get('from-acct')).toBe(-300);
      expect(segmentResult.balanceChanges.get('to-acct')).toBe(300);
    });

    it('returns empty map when transfer amount is effectively zero', () => {
      const fromAccount = makeAccount({ id: 'from-acct', type: 'Checking' });
      const toAccount = makeAccount({ id: 'to-acct', type: 'Savings' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 0),
        findAccountById: vi.fn((id: string) => (id === 'from-acct' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const activity = makeActivity({ id: 'xfer-zero', amount: 0, isTransfer: true });

      const event: ActivityTransferEvent = {
        id: 'evt-xfer-zero',
        type: EventType.activityTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-acct',
        priority: 1,
        originalActivity: activity,
        fromAccountId: 'from-acct',
        toAccountId: 'to-acct',
      };

      const result = calculator.processActivityTransferEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('creates transfer activities in both from and to accounts', () => {
      const fromAccount = makeAccount({ id: 'from-acct', name: 'Checking', type: 'Checking' });
      const toAccount = makeAccount({ id: 'to-acct', name: 'Savings', type: 'Savings' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 5000),
        findAccountById: vi.fn((id: string) => (id === 'from-acct' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();
      const activity = makeActivity({ id: 'xfer-2', amount: 500, isTransfer: true });

      const event: ActivityTransferEvent = {
        id: 'evt-xfer2',
        type: EventType.activityTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-acct',
        priority: 1,
        originalActivity: activity,
        fromAccountId: 'from-acct',
        toAccountId: 'to-acct',
      };

      calculator.processActivityTransferEvent(event, segmentResult);

      expect(segmentResult.activitiesAdded.get('from-acct')).toHaveLength(1);
      expect(segmentResult.activitiesAdded.get('to-acct')).toHaveLength(1);
      // from gets negative amount, to gets positive amount
      expect(segmentResult.activitiesAdded.get('from-acct')![0].amount).toBe(-500);
      expect(segmentResult.activitiesAdded.get('to-acct')![0].amount).toBe(500);
    });
  });

  describe('processBillTransferEvent', () => {
    it('handles {FULL} variable amount by zeroing destination account (Loan type caps to abs balance)', () => {
      const fromAccount = makeAccount({ id: 'from-acct', name: 'Checking', type: 'Checking' });
      const toAccount = makeAccount({ id: 'to-acct', name: 'Loan', type: 'Loan' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'to-acct' ? -1500 : 5000)),
        findAccountById: vi.fn((id: string) => (id === 'from-acct' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      // Build a minimal plain-object Bill that has amount='{FULL}' as a string.
      // We bypass the real constructor because loadNumberOrVariable is mocked and
      // would convert the string to 0.
      const bill = {
        id: 'bill-full',
        name: 'Pay Loan',
        amount: '{FULL}',
        amountIsVariable: false,
        amountVariable: null,
        isTransfer: true,
        isHealthcare: false,
        healthcarePerson: null,
        fro: 'Checking',
        to: 'Loan',
        increaseBy: 0,
        toActivity: vi.fn((id: string, sim: string, amt: any, date: Date) => ({
          serialize: () => ({
            id, name: 'Pay Loan', amount: amt, date: '2024-01-15',
            isTransfer: true, category: 'Ignore.Transfer',
            flag: false, flagColor: null,
            amountIsVariable: false, amountVariable: null,
            from: 'Checking', to: 'Loan',
            dateIsVariable: false, dateVariable: null,
            spendingCategory: null, isHealthcare: false, healthcarePerson: null,
          }),
        })),
      } as unknown as Bill;

      const event: BillTransferEvent = {
        id: 'evt-full',
        type: EventType.billTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-acct',
        priority: 1,
        originalBill: bill,
        amount: '{FULL}',
        firstBill: true,
        fromAccountId: 'from-acct',
        toAccountId: 'to-acct',
      };

      calculator.processBillTransferEvent(event, segmentResult);

      // {FULL} = -toAccountBalance = -(-1500) = 1500; capped at abs(-1500)=1500 for Loan
      expect(segmentResult.balanceChanges.get('from-acct')).toBe(-1500);
      expect(segmentResult.balanceChanges.get('to-acct')).toBe(1500);
    });

    it('handles {HALF} variable amount by transferring half the destination balance', () => {
      const fromAccount = makeAccount({ id: 'from-acct', name: 'Checking', type: 'Checking' });
      const toAccount = makeAccount({ id: 'to-acct', name: 'Credit', type: 'Credit' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'to-acct' ? -2000 : 10000)),
        findAccountById: vi.fn((id: string) => (id === 'from-acct' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const bill = {
        id: 'bill-half',
        name: 'Pay Half',
        amount: '{HALF}',
        amountIsVariable: false,
        amountVariable: null,
        isTransfer: true,
        isHealthcare: false,
        healthcarePerson: null,
        fro: 'Checking',
        to: 'Credit',
        increaseBy: 0,
        toActivity: vi.fn((id: string, sim: string, amt: any, date: Date) => ({
          serialize: () => ({
            id, name: 'Pay Half', amount: amt, date: '2024-01-15',
            isTransfer: true, category: 'Ignore.Transfer',
            flag: false, flagColor: null,
            amountIsVariable: false, amountVariable: null,
            from: 'Checking', to: 'Credit',
            dateIsVariable: false, dateVariable: null,
            spendingCategory: null, isHealthcare: false, healthcarePerson: null,
          }),
        })),
      } as unknown as Bill;

      const event: BillTransferEvent = {
        id: 'evt-half',
        type: EventType.billTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-acct',
        priority: 1,
        originalBill: bill,
        amount: '{HALF}',
        firstBill: false,
        fromAccountId: 'from-acct',
        toAccountId: 'to-acct',
      };

      calculator.processBillTransferEvent(event, segmentResult);

      // {HALF} = -toAccountBalance * 0.5 = -(-2000)*0.5 = 1000; capped at abs(-2000)=2000 for Credit
      expect(segmentResult.balanceChanges.get('from-acct')).toBe(-1000);
      expect(segmentResult.balanceChanges.get('to-acct')).toBe(1000);
    });

    it('adds taxable occurrence for AUTO-PULL bill transfers with withdrawal tax rate', () => {
      const fromAccount = makeAccount({
        id: 'from-acct',
        name: 'IRA',
        type: 'Investment',
        withdrawalTaxRate: 0.22,
      });
      const toAccount = makeAccount({ id: 'to-acct', name: 'Checking', type: 'Checking' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'from-acct' ? 50000 : 5000)),
        findAccountById: vi.fn((id: string) => (id === 'from-acct' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const bill = makeBill({ id: 'AUTO-PULL-bill-1', amount: 2000, isTransfer: true });

      const event: BillTransferEvent = {
        id: 'evt-autopull-bill',
        type: EventType.billTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-acct',
        priority: 1,
        originalBill: bill,
        amount: 2000,
        firstBill: false,
        fromAccountId: 'from-acct',
        toAccountId: 'to-acct',
      };

      calculator.processBillTransferEvent(event, segmentResult);

      const taxable = segmentResult.taxableOccurrences.get('Checking');
      expect(taxable).toBeDefined();
      expect(taxable![0].incomeType).toBe('retirement');
    });

    it('applies withdrawal tax on manual transfer from pre-tax to non-retirement account', () => {
      const fromAccount = makeAccount({
        id: 'from-401k',
        name: 'Traditional 401k',
        type: 'Investment',
        withdrawalTaxRate: 0.22,
      });
      const toAccount = makeAccount({ id: 'to-checking', name: 'Checking', type: 'Checking', withdrawalTaxRate: 0 });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'from-401k' ? 100000 : 5000)),
        findAccountById: vi.fn((id: string) => (id === 'from-401k' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'manual-transfer-1', amount: 5000, isTransfer: true });

      const event: ActivityTransferEvent = {
        id: 'evt-manual-transfer',
        type: EventType.activityTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-401k',
        priority: 1,
        originalActivity: activity,
        fromAccountId: 'from-401k',
        toAccountId: 'to-checking',
      };

      calculator.processActivityTransferEvent(event, segmentResult);

      const taxable = segmentResult.taxableOccurrences.get('Checking');
      expect(taxable).toBeDefined();
      expect(taxable).toHaveLength(1);
      expect(taxable![0].incomeType).toBe('retirement');
      expect(taxable![0].amount).toBe(5000);
    });

    it('does NOT apply withdrawal tax on rollover from 401k to IRA (both pre-tax)', () => {
      const fromAccount = makeAccount({
        id: 'from-401k',
        name: 'Traditional 401k',
        type: 'Investment',
        withdrawalTaxRate: 0.22,
      });
      const toAccount = makeAccount({
        id: 'to-ira',
        name: 'Traditional IRA',
        type: 'Investment',
        withdrawalTaxRate: 0.22,
      });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'from-401k' ? 100000 : 5000)),
        findAccountById: vi.fn((id: string) => (id === 'from-401k' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'rollover-1', amount: 50000, isTransfer: true });

      const event: ActivityTransferEvent = {
        id: 'evt-rollover',
        type: EventType.activityTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-401k',
        priority: 1,
        originalActivity: activity,
        fromAccountId: 'from-401k',
        toAccountId: 'to-ira',
      };

      calculator.processActivityTransferEvent(event, segmentResult);

      const taxable = segmentResult.taxableOccurrences.get('Traditional IRA');
      expect(taxable).toBeUndefined();
    });

    it('does NOT apply withdrawal tax on Roth withdrawal to checking (Roth has 0 tax rate)', () => {
      const fromAccount = makeAccount({
        id: 'from-roth',
        name: 'Roth IRA',
        type: 'Investment',
        withdrawalTaxRate: 0,
      });
      const toAccount = makeAccount({ id: 'to-checking', name: 'Checking', type: 'Checking', withdrawalTaxRate: 0 });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'from-roth' ? 50000 : 5000)),
        findAccountById: vi.fn((id: string) => (id === 'from-roth' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const activity = makeActivity({ id: 'roth-withdraw-1', amount: 10000, isTransfer: true });

      const event: ActivityTransferEvent = {
        id: 'evt-roth-withdraw',
        type: EventType.activityTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-roth',
        priority: 1,
        originalActivity: activity,
        fromAccountId: 'from-roth',
        toAccountId: 'to-checking',
      };

      calculator.processActivityTransferEvent(event, segmentResult);

      const taxable = segmentResult.taxableOccurrences.get('Checking');
      expect(taxable).toBeUndefined();
    });

    it('still applies withdrawal tax on AUTO-PULL from pre-tax account (regression test)', () => {
      const fromAccount = makeAccount({
        id: 'from-401k',
        name: 'Traditional 401k',
        type: 'Investment',
        withdrawalTaxRate: 0.22,
      });
      const toAccount = makeAccount({ id: 'to-checking', name: 'Checking', type: 'Checking', withdrawalTaxRate: 0 });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn((id: string) => (id === 'from-401k' ? 100000 : 5000)),
        findAccountById: vi.fn((id: string) => (id === 'from-401k' ? fromAccount : toAccount)),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const bill = makeBill({ id: 'AUTO-PULL-bill-1', amount: 3000, isTransfer: true });

      const event: BillTransferEvent = {
        id: 'evt-autopull',
        type: EventType.billTransfer,
        date: new Date('2024-01-15'),
        accountId: 'from-401k',
        priority: 1,
        originalBill: bill,
        amount: 3000,
        firstBill: false,
        fromAccountId: 'from-401k',
        toAccountId: 'to-checking',
      };

      calculator.processBillTransferEvent(event, segmentResult);

      const taxable = segmentResult.taxableOccurrences.get('Checking');
      expect(taxable).toBeDefined();
      expect(taxable![0].incomeType).toBe('retirement');
      expect(taxable![0].amount).toBe(3000);
    });
  });

  // ─── processPensionEvent ──────────────────────────────────────────────────

  describe('processPensionEvent', () => {
    it('calls calculatePensionMonthlyPay on first payment', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 2500),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = { id: 'pen-1', name: 'PERS Pension' } as any;
      const event: PensionEvent = {
        id: 'evt-pen',
        type: EventType.pension,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 65,
        firstPayment: true,
      };

      calculator.processPensionEvent(event, segmentResult);

      expect(retirementManager.calculatePensionMonthlyPay).toHaveBeenCalledWith(pension, 2024);
    });

    it('does not call calculatePensionMonthlyPay on subsequent payments', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 2500),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = { id: 'pen-1', name: 'PERS Pension' } as any;
      const event: PensionEvent = {
        id: 'evt-pen2',
        type: EventType.pension,
        date: new Date('2024-02-15'),
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 65,
        firstPayment: false,
      };

      calculator.processPensionEvent(event, segmentResult);

      expect(retirementManager.calculatePensionMonthlyPay).not.toHaveBeenCalled();
    });

    it('adds pension amount to balance changes and creates activity with correct category', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 3000),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = { name: 'State Pension' } as any;
      const event: PensionEvent = {
        id: 'evt-pen3',
        type: EventType.pension,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 67,
        firstPayment: false,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      expect(result.get('account-1')).toBe(3000);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(3000);
      const activities = segmentResult.activitiesAdded.get('account-1');
      expect(activities).toHaveLength(1);
      // ConsolidatedActivity is a real class; check its serialized properties
      const serialized = activities![0].serialize();
      expect(serialized.category).toBe('Income.Retirement');
      expect(serialized.name).toBe('State Pension');
      expect(serialized.amount).toBe(3000);
    });

    it('applies no COLA adjustment when type is none', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 2000),
        getPensionFirstPaymentYear: vi.fn(() => 2020),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = {
        name: 'Basic Pension',
        cola: { type: 'none' },
      } as any;
      const event: PensionEvent = {
        id: 'evt-pen-nocola',
        type: EventType.pension,
        date: new Date('2025-06-15'), // 5 years after first payment
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 70,
        firstPayment: false,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // Should remain at base amount (no COLA adjustment)
      expect(result.get('account-1')).toBe(2000);
    });

    it('applies fixed COLA adjustment correctly', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 2000),
        getPensionFirstPaymentYear: vi.fn(() => 2020),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = {
        name: 'COLA Pension',
        cola: { type: 'fixed', fixedRate: 0.02 },
      } as any;
      const event: PensionEvent = {
        id: 'evt-pen-cola',
        type: EventType.pension,
        date: new Date('2025-06-15'), // 5 years after first payment
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 70,
        firstPayment: false,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // After 5 years at 2% COLA: 2000 * (1.02)^5 = 2208.16
      const expectedAmount = 2000 * Math.pow(1.02, 5);
      expect(result.get('account-1')).toBeCloseTo(expectedAmount, 2);
    });

    it('handles COLA in first payment year (no adjustment yet)', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 2500),
        getPensionFirstPaymentYear: vi.fn(() => 2024),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = {
        name: 'New Pension',
        cola: { type: 'fixed', fixedRate: 0.03 },
      } as any;
      const event: PensionEvent = {
        id: 'evt-pen-first',
        type: EventType.pension,
        date: new Date('2024-01-15'), // Same year as first payment
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 65,
        firstPayment: false,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // 0 years collecting, so no COLA adjustment
      expect(result.get('account-1')).toBe(2500);
    });

    it('applies COLA with higher rate over longer period', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 3000),
        getPensionFirstPaymentYear: vi.fn(() => 2015),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = {
        name: 'High COLA Pension',
        cola: { type: 'fixed', fixedRate: 0.05 },
      } as any;
      const event: PensionEvent = {
        id: 'evt-pen-highcola',
        type: EventType.pension,
        date: new Date('2025-03-15'), // 10 years after first payment
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 75,
        firstPayment: false,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // After 10 years at 5% COLA: 3000 * (1.05)^10 = 4886.68
      const expectedAmount = 3000 * Math.pow(1.05, 10);
      expect(result.get('account-1')).toBeCloseTo(expectedAmount, 2);
    });

    it('does not apply COLA when firstPaymentYear is null', () => {
      const retirementManager = makeRetirementManager({
        getPensionMonthlyPay: vi.fn(() => 1800),
        getPensionFirstPaymentYear: vi.fn(() => null),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const pension = {
        name: 'Unknown Start Pension',
        cola: { type: 'fixed', fixedRate: 0.02 },
      } as any;
      const event: PensionEvent = {
        id: 'evt-pen-nullyear',
        type: EventType.pension,
        date: new Date('2025-06-15'),
        accountId: 'account-1',
        priority: 3,
        pension,
        ownerAge: 70,
        firstPayment: false,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // No COLA adjustment because first payment year is unknown
      expect(result.get('account-1')).toBe(1800);
    });
  });

  // ─── processSocialSecurityEvent ───────────────────────────────────────────

  describe('processSocialSecurityEvent', () => {
    beforeEach(() => {
      vi.mocked(loadVariable).mockReset();
      vi.mocked(loadVariable).mockReturnValue(0.025); // default 2.5% COLA
    });

    it('calls calculateSocialSecurityMonthlyPay on first payment', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 1800),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const ss = { name: 'John SS' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss',
        type: EventType.socialSecurity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 67,
        firstPayment: true,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      expect(retirementManager.calculateSocialSecurityMonthlyPay).toHaveBeenCalledWith(ss);
    });

    it('does not call calculateSocialSecurityMonthlyPay on subsequent payments', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 1800),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Jane SS' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss2',
        type: EventType.socialSecurity,
        date: new Date('2024-02-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 67,
        firstPayment: false,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      expect(retirementManager.calculateSocialSecurityMonthlyPay).not.toHaveBeenCalled();
    });

    it('adds social security amount to segment result with correct activity', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 2200),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Jane SS' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss3',
        type: EventType.socialSecurity,
        date: new Date('2024-03-15'),
        accountId: 'account-2',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 62,
        firstPayment: false,
      };

      const result = calculator.processSocialSecurityEvent(event, segmentResult);

      expect(result.get('account-2')).toBe(2200);
      expect(segmentResult.balanceChanges.get('account-2')).toBe(2200);
      const activities = segmentResult.activitiesAdded.get('account-2');
      expect(activities).toHaveLength(1);
      const serialized = activities![0].serialize();
      expect(serialized.category).toBe('Income.Retirement');
      expect(serialized.amount).toBe(2200);
    });

    it('applies no COLA adjustment when colaVariable is not set', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 2000),
        getSocialSecurityFirstPaymentYear: vi.fn(() => 2024),
      });
      const calculator = makeCalculator({ retirementManager });
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Test SS', colaVariable: null } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss-no-cola',
        type: EventType.socialSecurity,
        date: new Date('2027-03-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 70,
        firstPayment: false,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      // No COLA adjustment, should remain at base amount
      expect(segmentResult.balanceChanges.get('account-1')).toBe(2000);
    });

    it('applies fixed COLA adjustment correctly', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 2000),
        getSocialSecurityFirstPaymentYear: vi.fn(() => 2024),
        setSocialSecurityFirstPaymentYear: vi.fn(),
      });
      const calculator = makeCalculator({ retirementManager });
      vi.mocked(loadVariable).mockReturnValue(0.025); // 2.5% COLA
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Test SS COLA', colaVariable: 'SS_COLA_RATE' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss-cola',
        type: EventType.socialSecurity,
        date: new Date('2029-03-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 72,
        firstPayment: false,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      // After 5 years at 2.5% COLA: 2000 * (1.025)^5 = 2262.82
      const expectedAmount = 2000 * Math.pow(1.025, 5);
      expect(segmentResult.balanceChanges.get('account-1')).toBeCloseTo(expectedAmount, 2);
    });

    it('handles COLA in first payment year (no adjustment yet)', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 2000),
        getSocialSecurityFirstPaymentYear: vi.fn(() => null),
        setSocialSecurityFirstPaymentYear: vi.fn(),
      });
      const calculator = makeCalculator({ retirementManager });
      vi.mocked(loadVariable).mockReturnValue(0.03); // 3% COLA
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Test SS First Year', colaVariable: 'SS_COLA_RATE' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss-first',
        type: EventType.socialSecurity,
        date: new Date('2024-03-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 67,
        firstPayment: true,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      // First payment should set year to 2024, then apply COLA for 0 years (no adjustment)
      expect(retirementManager.setSocialSecurityFirstPaymentYear).toHaveBeenCalledWith('Test SS First Year', 2024);
      // 0 years collecting, so no COLA adjustment
      expect(segmentResult.balanceChanges.get('account-1')).toBe(2000);
    });

    it('applies COLA with higher rate over longer period', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 2500),
        getSocialSecurityFirstPaymentYear: vi.fn(() => 2020),
        setSocialSecurityFirstPaymentYear: vi.fn(),
      });
      const calculator = makeCalculator({ retirementManager });
      vi.mocked(loadVariable).mockReturnValue(0.05); // 5% COLA
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Test SS High COLA', colaVariable: 'SS_COLA_RATE' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss-high-cola',
        type: EventType.socialSecurity,
        date: new Date('2030-03-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 75,
        firstPayment: false,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      // After 10 years at 5% COLA: 2500 * (1.05)^10 = 4072.23
      const expectedAmount = 2500 * Math.pow(1.05, 10);
      expect(segmentResult.balanceChanges.get('account-1')).toBeCloseTo(expectedAmount, 2);
    });

    it('does not apply COLA when firstPaymentYear is null and not first payment', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 1800),
        getSocialSecurityFirstPaymentYear: vi.fn(() => null),
      });
      const calculator = makeCalculator({ retirementManager });
      vi.mocked(loadVariable).mockReturnValueOnce(0.025);
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Test SS Unknown Year', colaVariable: 'SS_COLA_RATE' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss-unknown',
        type: EventType.socialSecurity,
        date: new Date('2025-03-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 68,
        firstPayment: false,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      // No COLA adjustment because first payment year is unknown
      expect(segmentResult.balanceChanges.get('account-1')).toBe(1800);
    });

    it('applies zero COLA rate means no increase', () => {
      const retirementManager = makeRetirementManager({
        getSocialSecurityMonthlyPay: vi.fn(() => 2000),
        getSocialSecurityFirstPaymentYear: vi.fn(() => 2024),
      });
      const calculator = makeCalculator({ retirementManager });
      vi.mocked(loadVariable).mockReturnValue(0.0); // 0% COLA
      const segmentResult = makeSegmentResult();

      const ss = { name: 'Test SS Zero COLA', colaVariable: 'SS_COLA_RATE' } as any;
      const event: SocialSecurityEvent = {
        id: 'evt-ss-zero-cola',
        type: EventType.socialSecurity,
        date: new Date('2027-03-15'),
        accountId: 'account-1',
        priority: 3,
        socialSecurity: ss,
        ownerAge: 70,
        firstPayment: false,
      };

      calculator.processSocialSecurityEvent(event, segmentResult);

      // After 3 years at 0% COLA: 2000 * (1.0)^3 = 2000
      expect(segmentResult.balanceChanges.get('account-1')).toBe(2000);
    });
  });

  // ─── processTaxEvent ──────────────────────────────────────────────────────

  describe('processTaxEvent', () => {
    it('throws error when account not found', () => {
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => undefined),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const event: TaxEvent = {
        id: 'evt-tax-err',
        type: EventType.tax,
        date: new Date('2024-04-15'),
        accountId: 'missing-acct',
        priority: 5,
      };

      expect(() => calculator.processTaxEvent(event, segmentResult)).toThrow(
        'Account missing-acct not found',
      );
    });

    it('returns empty map when tax owed is zero', () => {
      const account = makeAccount({ id: 'account-1' });
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => account),
      });
      const taxManager = makeTaxManager({
        calculateTotalTaxOwed: vi.fn(() => 0),
      });
      const calculator = makeCalculator({ balanceTracker, taxManager });
      const segmentResult = makeSegmentResult();

      const event: TaxEvent = {
        id: 'evt-tax-zero',
        type: EventType.tax,
        date: new Date('2024-04-15'),
        accountId: 'account-1',
        priority: 5,
      };

      const result = calculator.processTaxEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('deducts tax amount from account and adds tax activity', () => {
      const account = makeAccount({ id: 'account-1', name: 'Checking' });
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => account),
      });
      const taxManager = makeTaxManager({
        calculateTotalTaxOwed: vi.fn(() => 4500),
      });
      const calculator = makeCalculator({ balanceTracker, taxManager });
      const segmentResult = makeSegmentResult();

      const event: TaxEvent = {
        id: 'evt-tax-owed',
        type: EventType.tax,
        date: new Date('2024-04-15'),
        accountId: 'account-1',
        priority: 5,
      };

      const result = calculator.processTaxEvent(event, segmentResult);

      // Tax is -calculateTotalTaxOwed = -4500
      expect(result.get('account-1')).toBe(-4500);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(-4500);

      const activities = segmentResult.activitiesAdded.get('account-1')!;
      expect(activities).toHaveLength(1);
      const serialized = activities[0].serialize();
      expect(serialized.name).toBe('Auto Calculated Tax');
      expect(serialized.category).toBe('Taxes.Federal');
      expect(serialized.amount).toBe(-4500);
    });

    it('calculates tax for prior year (event year - 1)', () => {
      const account = makeAccount({ id: 'account-1' });
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => account),
      });
      const taxManager = makeTaxManager({
        calculateTotalTaxOwed: vi.fn(() => 1000),
      });
      const calculator = makeCalculator({ balanceTracker, taxManager });
      const segmentResult = makeSegmentResult();

      const event: TaxEvent = {
        id: 'evt-tax-year',
        type: EventType.tax,
        date: new Date('2025-04-15'),
        accountId: 'account-1',
        priority: 5,
      };

      calculator.processTaxEvent(event, segmentResult);

      expect(taxManager.calculateTotalTaxOwed).toHaveBeenCalledWith(2024, 'mfj', 0.03);
    });
  });

  // ─── processRMDEvent ──────────────────────────────────────────────────────

  describe('processRMDEvent', () => {
    it('returns empty map when account does not use RMD', () => {
      const account = makeAccount({ id: 'account-1', usesRMD: false });
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-skip',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'account-1',
        priority: 4,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 73,
      };

      const result = calculator.processRMDEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('throws when account not found', () => {
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => undefined),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-err',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'missing-acct',
        priority: 4,
        fromAccountId: 'missing-acct',
        toAccountId: 'account-2',
        ownerAge: 73,
      };

      expect(() => calculator.processRMDEvent(event, segmentResult)).toThrow(
        'Account missing-acct not found',
      );
    });

    it('throws when account has no rmdAccount configured', () => {
      const account = makeAccount({ id: 'account-1', usesRMD: true, rmdAccount: null });
      const balanceTracker = makeBalanceTracker({
        findAccountById: vi.fn(() => account),
      });
      const calculator = makeCalculator({ balanceTracker });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-normd',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'account-1',
        priority: 4,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 75,
      };

      expect(() => calculator.processRMDEvent(event, segmentResult)).toThrow('has no RMD account');
    });

    it('throws when rmdAccount name cannot be found in account manager', () => {
      const account = makeAccount({ id: 'account-1', usesRMD: true, rmdAccount: 'Ghost Account' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 100000),
        findAccountById: vi.fn(() => account),
      });
      const accountManager = makeAccountManager({
        getAccountByName: vi.fn(() => undefined),
      });
      const calculator = makeCalculator({ balanceTracker, accountManager });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-ghost',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'account-1',
        priority: 4,
        fromAccountId: 'account-1',
        toAccountId: 'ghost',
        ownerAge: 73,
      };

      expect(() => calculator.processRMDEvent(event, segmentResult)).toThrow(
        'Account Ghost Account not found',
      );
    });

    it('transfers RMD amount from source to RMD account', () => {
      const account = makeAccount({ id: 'account-1', name: '401k', usesRMD: true, rmdAccount: 'Checking' });
      const rmdAccount = makeAccount({ id: 'account-2', name: 'Checking' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 500000),
        findAccountById: vi.fn(() => account),
      });
      const accountManager = makeAccountManager({
        getAccountByName: vi.fn(() => rmdAccount),
      });
      const retirementManager = makeRetirementManager({
        rmd: vi.fn(() => 20000),
      });
      const calculator = makeCalculator({ balanceTracker, accountManager, retirementManager });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-full',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'account-1',
        priority: 4,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 73,
      };

      const result = calculator.processRMDEvent(event, segmentResult);

      expect(result.get('account-1')).toBe(-20000);
      expect(result.get('account-2')).toBe(20000);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(-20000);
      expect(segmentResult.balanceChanges.get('account-2')).toBe(20000);
      expect(segmentResult.activitiesAdded.get('account-1')).toHaveLength(1);
      expect(segmentResult.activitiesAdded.get('account-2')).toHaveLength(1);
    });

    it('returns empty map when RMD amount is zero or negative', () => {
      const account = makeAccount({ id: 'account-1', usesRMD: true, rmdAccount: 'Checking' });
      const rmdAccount = makeAccount({ id: 'account-2', name: 'Checking' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 100000),
        findAccountById: vi.fn(() => account),
      });
      const accountManager = makeAccountManager({
        getAccountByName: vi.fn(() => rmdAccount),
      });
      const retirementManager = makeRetirementManager({
        rmd: vi.fn(() => 0),
      });
      const calculator = makeCalculator({ balanceTracker, accountManager, retirementManager });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-zero',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'account-1',
        priority: 4,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 72,
      };

      const result = calculator.processRMDEvent(event, segmentResult);
      expect(result.size).toBe(0);
    });

    it('creates activities with isTransfer=true and category Ignore.Transfer', () => {
      const account = makeAccount({ id: 'account-1', name: '401k', usesRMD: true, rmdAccount: 'Checking' });
      const rmdAccount = makeAccount({ id: 'account-2', name: 'Checking' });
      const balanceTracker = makeBalanceTracker({
        getAccountBalance: vi.fn(() => 300000),
        findAccountById: vi.fn(() => account),
      });
      const accountManager = makeAccountManager({
        getAccountByName: vi.fn(() => rmdAccount),
      });
      const retirementManager = makeRetirementManager({
        rmd: vi.fn(() => 10000),
      });
      const calculator = makeCalculator({ balanceTracker, accountManager, retirementManager });
      const segmentResult = makeSegmentResult();

      const event: RMDEvent = {
        id: 'evt-rmd-activity',
        type: EventType.rmd,
        date: new Date('2024-12-31'),
        accountId: 'account-1',
        priority: 4,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 74,
      };

      calculator.processRMDEvent(event, segmentResult);

      const fromActivity = segmentResult.activitiesAdded.get('account-1')![0].serialize();
      expect(fromActivity.isTransfer).toBe(true);
      expect(fromActivity.category).toBe('Ignore.Transfer');
      expect(fromActivity.name).toBe('RMD');
      expect(fromActivity.amount).toBe(-10000);
    });
  });

  // ─── processSpendingTrackerEvent ──────────────────────────────────────────

  describe('processSpendingTrackerEvent', () => {
    function makeSpendingTrackerEvent(overrides: Partial<SpendingTrackerEvent> = {}): SpendingTrackerEvent {
      return {
        id: 'evt-st-1',
        type: EventType.spendingTracker,
        date: new Date('2024-01-27'),
        accountId: 'account-1',
        priority: 6,
        categoryId: 'cat-1',
        categoryName: 'Groceries',
        periodStart: new Date('2024-01-20'),
        periodEnd: new Date('2024-01-27'),
        firstSpendingTracker: false,
        virtual: false,
        ...overrides,
      };
    }

    it('creates remainder activity when remainder is positive', () => {
      const stManager = makeSpendingTrackerManager({
        getPeriodSpending: vi.fn(() => 50),
        computeRemainder: vi.fn(() => 100),
        isBeforeInitializeDate: vi.fn(() => false),
        getCarryBalance: vi.fn(() => 0),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      const result = calculator.processSpendingTrackerEvent(makeSpendingTrackerEvent(), segmentResult);

      expect(result.get('account-1')).toBe(-100);
      expect(segmentResult.balanceChanges.get('account-1')).toBe(-100);
      const activities = segmentResult.activitiesAdded.get('account-1')!;
      expect(activities).toHaveLength(1);
      const serialized = activities[0].serialize();
      expect(serialized.name).toBe('Groceries Budget Remainder');
      expect(serialized.category).toBe('Spending Tracker.Groceries');
      expect(serialized.amount).toBe(-100);
    });

    it('returns empty map when remainder is zero', () => {
      const stManager = makeSpendingTrackerManager({
        getPeriodSpending: vi.fn(() => 150),
        computeRemainder: vi.fn(() => 0),
        isBeforeInitializeDate: vi.fn(() => false),
        getCarryBalance: vi.fn(() => 0),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      const result = calculator.processSpendingTrackerEvent(makeSpendingTrackerEvent(), segmentResult);

      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });

    it('returns empty map and no activity for virtual events', () => {
      const stManager = makeSpendingTrackerManager({
        getPeriodSpending: vi.fn(() => 50),
        computeRemainder: vi.fn(() => 100),
        isBeforeInitializeDate: vi.fn(() => false),
        getCarryBalance: vi.fn(() => 0),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      const result = calculator.processSpendingTrackerEvent(
        makeSpendingTrackerEvent({ virtual: true }),
        segmentResult,
      );

      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });

    it('skips carry and activity generation for periods before initialize date', () => {
      const stManager = makeSpendingTrackerManager({
        isBeforeInitializeDate: vi.fn(() => true),
        getPeriodSpending: vi.fn(() => 30),
        getCarryBalance: vi.fn(() => 0),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
        computeRemainder: vi.fn(() => 120),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      const result = calculator.processSpendingTrackerEvent(makeSpendingTrackerEvent(), segmentResult);

      expect(result.size).toBe(0);
      expect(stManager.resetPeriodSpending).toHaveBeenCalledWith('cat-1');
      expect(stManager.markPeriodProcessed).toHaveBeenCalledWith('cat-1', expect.any(Date));
    });

    it('records spending tracker update for cache replay', () => {
      const stManager = makeSpendingTrackerManager({
        getPeriodSpending: vi.fn(() => 75),
        computeRemainder: vi.fn(() => 75),
        isBeforeInitializeDate: vi.fn(() => false),
        getCarryBalance: vi.fn(() => 10),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      calculator.processSpendingTrackerEvent(makeSpendingTrackerEvent(), segmentResult);

      expect(segmentResult.spendingTrackerUpdates).toHaveLength(1);
      const update = segmentResult.spendingTrackerUpdates[0];
      expect(update.categoryId).toBe('cat-1');
      expect(update.carryAfter).toBe(10);
    });

    it('includes current-segment activities in totalSpent calculation', () => {
      const stManager = makeSpendingTrackerManager({
        getPeriodSpending: vi.fn(() => 0),
        computeRemainder: vi.fn(() => 100),
        isBeforeInitializeDate: vi.fn(() => false),
        getCarryBalance: vi.fn(() => 0),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      // Pre-load a spending-category activity in the segment result
      // Activity date must be within the period [Jan 20 - Jan 27]
      const groceryActivity = new ConsolidatedActivity({
        id: 'grocery-1',
        name: 'Grocery Purchase',
        amount: -40,
        date: '2024-01-22',
        isTransfer: false,
        category: 'Groceries',
        spendingCategory: 'cat-1',
        flag: false,
        flagColor: null,
        amountIsVariable: false,
        amountVariable: null,
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        isHealthcare: false,
        healthcarePerson: null,
      });
      segmentResult.activitiesAdded.set('account-1', [groceryActivity]);

      const event = makeSpendingTrackerEvent({
        periodStart: new Date('2024-01-20'),
        periodEnd: new Date('2024-01-27'),
      });
      calculator.processSpendingTrackerEvent(event, segmentResult);

      // computeRemainder called with totalSpent = 0 - (-40) = 40
      expect(stManager.computeRemainder).toHaveBeenCalledWith('cat-1', 40, expect.any(Date));
    });

    it('calls updateCarry for past periods with spending', () => {
      const stManager = makeSpendingTrackerManager({
        getPeriodSpending: vi.fn(() => 100),
        computeRemainder: vi.fn(() => 50),
        isBeforeInitializeDate: vi.fn(() => false),
        getCarryBalance: vi.fn(() => 0),
        getEffectiveThreshold: vi.fn(() => ({ baseThreshold: 150, effectiveThreshold: 150 })),
      });
      const calculator = makeCalculator({ spendingTrackerManager: stManager });
      const segmentResult = makeSegmentResult();

      // Past period (before today 2026-03-10)
      calculator.processSpendingTrackerEvent(
        makeSpendingTrackerEvent({
          periodStart: new Date('2024-01-20'),
          periodEnd: new Date('2024-01-27'),
          date: new Date('2024-01-27'),
        }),
        segmentResult,
      );

      expect(stManager.updateCarry).toHaveBeenCalledWith('cat-1', 100, expect.any(Date));
      expect(stManager.resetPeriodSpending).toHaveBeenCalledWith('cat-1');
      expect(stManager.markPeriodProcessed).toHaveBeenCalledWith('cat-1', expect.any(Date));
    });
  });
});
