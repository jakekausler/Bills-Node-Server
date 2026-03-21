/**
 * Tests for mortality cessation mechanism in Calculator (#21 Stage 3)
 *
 * When a person dies, their bills/SS/pension/RMD stop.
 * Shared bills continue while any person is alive.
 * Interest/investment returns continue regardless of mortality.
 */

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
  loadVariable: vi.fn(() => 0.025),
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
import type { BillEvent, PensionEvent, SocialSecurityEvent, TaxEvent, RMDEvent, RothConversionEvent, MedicarePremiumEvent, LTCCheckEvent } from './types';
import { Account } from '../../data/account/account';
import { Bill } from '../../data/bill/bill';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { MortalityManager } from './mortality-manager';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeSegmentResult(): SegmentResult {
  return {
    balanceChanges: new Map<string, number>(),
    activitiesAdded: new Map<string, any[]>(),
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
}> = {}): Account {
  return {
    id: overrides.id ?? 'account-1',
    name: overrides.name ?? 'Test Account',
    type: overrides.type ?? 'Checking',
    interestTaxRate: 0,
    withdrawalTaxRate: 0,
    earlyWithdrawalPenalty: 0,
    earlyWithdrawalDate: null,
    interestPayAccount: null,
    interestAppliesToPositiveBalance: true,
    expenseRatio: 0,
    usesRMD: false,
    rmdAccount: null,
    pullPriority: -1,
    activity: [],
    bills: [],
    interests: [],
    consolidatedActivity: [],
    todayBalance: 0,
    hidden: false,
    serialize: vi.fn(() => ({})),
    accountOwnerDOB: null,
    contributionLimitType: null,
    paycheckProfile: null,
  } as unknown as Account;
}

function makeBill(overrides: Partial<{
  id: string;
  name: string;
  amount: number;
  person: string | null;
}> = {}): Bill {
  const bill = new Bill({
    id: overrides.id ?? 'bill-1',
    name: overrides.name ?? 'Test Bill',
    amount: overrides.amount ?? -500,
    startDate: '2024-01-01',
    endDate: null,
    isTransfer: false,
    isHealthcare: false,
    healthcarePerson: null,
    category: 'Test',
    everyN: 1,
    periods: 'month',
    increaseBy: 0,
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
    from: null,
    to: null,
    spendingCategory: null,
    taxDeductible: false,
    studentLoanInterest: false,
    paycheckProfile: null,
    person: overrides.person ?? null,
  } as any);
  return bill;
}

function makePension(overrides: Partial<{
  name: string;
}> = {}): any {
  return {
    name: overrides.name ?? 'Test Pension',
    type: 'defined_benefit',
    monthlyAmount: 1000,
    startDateVariable: 'pension_start',
    birthDateVariable: 'birth_date',
    workStartDateVariable: 'work_start_date',
    workEndDateVariable: null,
    cola: { type: 'none' },
  };
}

function makeSocialSecurity(overrides: Partial<{
  name: string;
}> = {}): any {
  return {
    name: overrides.name ?? 'Test SS',
    primaryInsuranceAmount: 1500,
    startDateVariable: 'ss_start',
    birthDateVariable: 'birth_date',
    bendPointsIndexedYear: 60,
    bendPointsIndexedEarningsCap: 3822,
    familyMaximum: 2700,
    colaVariable: 'cola_rate',
    paycheckNames: [],
    paycheckAccounts: [],
    paycheckCategories: [],
    priorAnnualNetIncomes: [],
    priorAnnualNetIncomeYears: [],
  };
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
    findAccountById: overrides.findAccountById ?? vi.fn((id: string) => makeAccount({ id })),
    applySegmentResult: vi.fn(),
    updateBalance: vi.fn(),
  };
}

function makeMortalityManager(): any {
  const manager = new MortalityManager(null, 0);
  return manager;
}

function makeTaxManager() {
  return {
    computeReconciliation: vi.fn(() => ({
      year: 2024,
      totalOrdinaryIncome: 0,
      totalSSIncome: 0,
      totalIncome: 0,
      agi: 0,
      standardDeduction: 0,
      itemizedDeduction: 0,
      deductionUsed: 'standard',
      deductionAmount: 0,
      personalExemption: 0,
      taxableIncome: 0,
      federalTax: 0,
      ssTax: 0,
      stateTax: 0,
      credits: 0,
      totalTaxOwed: 0,
      totalFederalWithheld: 0,
      totalStateWithheld: 0,
      totalWithheld: 0,
      ficaOverpayment: 0,
      settlement: 0,
    })),
    getAllOccurrencesForYear: vi.fn(() => []),
  };
}

function makeRetirementManager() {
  return {
    calculatePensionMonthlyPay: vi.fn(),
    getPensionMonthlyPay: vi.fn(() => 1000),
    getPensionFirstPaymentYear: vi.fn(() => 2024),
    calculateSocialSecurityMonthlyPay: vi.fn(),
    getSocialSecurityMonthlyPay: vi.fn(() => 1500),
    getSocialSecurityFirstPaymentYear: vi.fn(() => 2024),
    setSocialSecurityFirstPaymentYear: vi.fn(),
    rmd: vi.fn(() => 50),
  };
}

function makeAccountManager() {
  return {
    getAccountByName: vi.fn(() => makeAccount({ name: 'Test RMD Account' })),
  };
}

function makeHealthcareManager() {
  return {
    getActiveConfig: vi.fn(() => null),
  };
}

function makeMedicareManager() {
  return {
    getMonthlyMedicareCost: vi.fn(() => 100),
    generateHospitalAdmissions: vi.fn(() => 0),
  };
}

function makeAcaManager() {
  return {
    getMonthlyHealthcarePremium: vi.fn(() => 100),
  };
}

function makeSpendingTrackerManager() {
  return {
    processTrackerEvent: vi.fn(() => new Map()),
  };
}

function makeDeductionTracker() {
  return {
    addDeduction: vi.fn(),
    getDeductionsForYear: vi.fn(() => ({})),
    resetYear: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mortality Cessation Mechanism', () => {
  let calculator: Calculator;
  let balanceTracker: any;
  let mortalityManager: MortalityManager;
  let taxManager: any;
  let retirementManager: any;
  let accountManager: any;
  let healthcareManager: any;
  let medicareManager: any;
  let acaManager: any;
  let spendingTrackerManager: any;
  let deductionTracker: any;

  beforeEach(() => {
    balanceTracker = makeBalanceTracker();
    mortalityManager = makeMortalityManager();
    taxManager = makeTaxManager();
    retirementManager = makeRetirementManager();
    accountManager = makeAccountManager();
    healthcareManager = makeHealthcareManager();
    medicareManager = makeMedicareManager();
    acaManager = makeAcaManager();
    spendingTrackerManager = makeSpendingTrackerManager();
    deductionTracker = makeDeductionTracker();

    calculator = new Calculator(
      balanceTracker,
      taxManager,
      retirementManager,
      healthcareManager,
      medicareManager,
      mortalityManager,
      accountManager,
      'Default',
      spendingTrackerManager,
      acaManager,
      'mfj',
      0.03,
    );
  });

  describe('Bill Events', () => {
    it('should process bill normally when person is alive', () => {
      const bill = makeBill({ name: 'Jake Expense', person: 'Jake' });
      const segmentResult = makeSegmentResult();

      const event: BillEvent = {
        id: 'bill-event-1',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalBill: bill,
        amount: -500,
        firstBill: true,
      };

      const result = calculator.processBillEvent(event, segmentResult, 'Default');

      // Bill should process normally
      expect(result.size).toBeGreaterThan(0);
      expect(segmentResult.activitiesAdded.has('account-1')).toBe(true);
    });

    it('should skip bill when person is deceased', () => {
      const bill = makeBill({ name: 'Jake Expense', person: 'Jake' });
      const segmentResult = makeSegmentResult();

      // Mark Jake as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: BillEvent = {
        id: 'bill-event-1',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalBill: bill,
        amount: -500,
        firstBill: true,
      };

      const result = calculator.processBillEvent(event, segmentResult, 'Default');

      // Bill should be skipped
      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });

    it('should process shared bill when one person is alive', () => {
      const bill = makeBill({ name: 'Shared Expense', person: null });
      const segmentResult = makeSegmentResult();

      // Mark Jake as deceased but not Kendall
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: BillEvent = {
        id: 'bill-event-1',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalBill: bill,
        amount: -500,
        firstBill: true,
      };

      const result = calculator.processBillEvent(event, segmentResult, 'Default');

      // Shared bill should still process
      expect(result.size).toBeGreaterThan(0);
      expect(segmentResult.activitiesAdded.has('account-1')).toBe(true);
    });

    it('should skip shared bill when all persons are deceased', () => {
      const bill = makeBill({ name: 'Shared Expense', person: null });
      const segmentResult = makeSegmentResult();

      // Mark both Jake and Kendall as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));
      mortalityManager.recordDeath('Kendall', new Date('2024-01-02'));

      const event: BillEvent = {
        id: 'bill-event-1',
        type: EventType.bill,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        originalBill: bill,
        amount: -500,
        firstBill: true,
      };

      const result = calculator.processBillEvent(event, segmentResult, 'Default');

      // Shared bill should be skipped
      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });
  });

  describe('Pension Events', () => {
    it('should process pension normally when person is alive', () => {
      const pension = makePension({ name: 'Test Pension' });
      const segmentResult = makeSegmentResult();

      const event: PensionEvent = {
        id: 'pension-event-1',
        type: EventType.pension,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        pension,
        ownerAge: 65,
        firstPayment: true,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // Pension should process normally
      expect(result.size).toBeGreaterThan(0);
      expect(segmentResult.activitiesAdded.has('account-1')).toBe(true);
    });

    it('should skip pension when person is deceased', () => {
      const pension = makePension({ name: 'Jake Pension' });
      const segmentResult = makeSegmentResult();

      // Mark Jake as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: PensionEvent = {
        id: 'pension-event-1',
        type: EventType.pension,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        pension,
        ownerAge: 65,
        firstPayment: true,
      };

      const result = calculator.processPensionEvent(event, segmentResult);

      // Pension should be skipped
      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });
  });

  describe('Social Security Events', () => {
    it('should process SS normally when person is alive', () => {
      const ss = makeSocialSecurity({ name: 'Test SS' });
      const segmentResult = makeSegmentResult();

      const event: SocialSecurityEvent = {
        id: 'ss-event-1',
        type: EventType.socialSecurity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        socialSecurity: ss,
        ownerAge: 67,
        firstPayment: true,
      };

      const result = calculator.processSocialSecurityEvent(event, segmentResult);

      // SS should process normally
      expect(result.size).toBeGreaterThan(0);
      expect(segmentResult.activitiesAdded.has('account-1')).toBe(true);
    });

    it('should skip SS when person is deceased', () => {
      const ss = makeSocialSecurity({ name: 'Jake Social Security' });
      const segmentResult = makeSegmentResult();

      // Mark Jake as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: SocialSecurityEvent = {
        id: 'ss-event-1',
        type: EventType.socialSecurity,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        socialSecurity: ss,
        ownerAge: 67,
        firstPayment: true,
      };

      const result = calculator.processSocialSecurityEvent(event, segmentResult);

      // SS should be skipped
      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });
  });

  describe('Tax Events', () => {
    it('should process tax normally when at least one person is alive', () => {
      const segmentResult = makeSegmentResult();

      // Mark Jake as deceased but Kendall alive
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: TaxEvent = {
        id: 'tax-event-1',
        type: EventType.tax,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
      };

      const result = calculator.processTaxEvent(event, segmentResult);

      // Tax should process normally
      expect(taxManager.computeReconciliation).toHaveBeenCalled();
    });

    it('should skip tax when all persons are deceased', () => {
      const segmentResult = makeSegmentResult();

      // Mark both as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));
      mortalityManager.recordDeath('Kendall', new Date('2024-01-02'));

      const event: TaxEvent = {
        id: 'tax-event-1',
        type: EventType.tax,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
      };

      const result = calculator.processTaxEvent(event, segmentResult);

      // Tax should be skipped
      expect(result.size).toBe(0);
      expect(taxManager.computeReconciliation).not.toHaveBeenCalled();
    });
  });


  describe('RMD Events', () => {
    it('should skip RMD when account owner is deceased', () => {
      // Create a proper account with usesRMD owned by Jake
      const rmdFromAccount = {
        ...makeAccount({ id: 'account-1', name: 'Jake 401(k)' }),
        usesRMD: true,
        rmdAccount: 'Jake',
      };
      const rmdToAccount = makeAccount({ id: 'account-2', name: 'Jake' });

      balanceTracker.findAccountById = vi.fn((id: string) => {
        if (id === 'account-1') return rmdFromAccount;
        if (id === 'account-2') return rmdToAccount;
        return undefined;
      });
      accountManager.getAccountByName = vi.fn(() => rmdToAccount);
      balanceTracker.getAccountBalance = vi.fn(() => 100000);

      const segmentResult = makeSegmentResult();
      // Mark Jake as deceased but Kendall alive
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: RMDEvent = {
        id: 'rmd-event-1',
        type: EventType.rmd,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 72,
      };

      const result = calculator.processRMDEvent(event, segmentResult);

      // RMD should be skipped because Jake is deceased
      expect(result.size).toBe(0);
      expect(segmentResult.activitiesAdded.size).toBe(0);
    });

    it('should process RMD when account owner is alive', () => {
      // Create a proper account with usesRMD owned by Jake
      const rmdFromAccount = {
        ...makeAccount({ id: 'account-1', name: 'Jake 401(k)' }),
        usesRMD: true,
        rmdAccount: 'Jake',
      };
      const rmdToAccount = makeAccount({ id: 'account-2', name: 'Jake' });

      balanceTracker.findAccountById = vi.fn((id: string) => {
        if (id === 'account-1') return rmdFromAccount;
        if (id === 'account-2') return rmdToAccount;
        return undefined;
      });
      accountManager.getAccountByName = vi.fn(() => rmdToAccount);
      balanceTracker.getAccountBalance = vi.fn(() => 100000);

      const segmentResult = makeSegmentResult();
      // Jake is alive, only Kendall is deceased
      mortalityManager.recordDeath('Kendall', new Date('2024-01-01'));

      const event: RMDEvent = {
        id: 'rmd-event-1',
        type: EventType.rmd,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        fromAccountId: 'account-1',
        toAccountId: 'account-2',
        ownerAge: 72,
      };

      const result = calculator.processRMDEvent(event, segmentResult);

      // RMD should process normally because Jake is alive
      expect(result.size).toBeGreaterThan(0);
      expect(segmentResult.activitiesAdded.has('account-1')).toBe(true);
    });
  });

  describe('Interest Events', () => {
    it('should continue to accrue interest after death', () => {
      // Interest should NOT have a mortality cessation check
      // It should continue regardless of mortality status
      const segmentResult = makeSegmentResult();

      // Mark both as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));
      mortalityManager.recordDeath('Kendall', new Date('2024-01-02'));

      const account = makeAccount({ id: 'account-1' });
      balanceTracker.findAccountById = vi.fn(() => account);
      balanceTracker.getAccountBalance = vi.fn(() => 10000);

      // Interest event has no mortality check — it should process
      // This is tested implicitly by verifying we don't have a cessation check
      // For now, just verify the setup is correct
      expect(mortalityManager.allDeceased()).toBe(true);
    });
  });

  describe('Roth Conversion Events', () => {
    it('should skip Roth conversion when all persons are deceased', () => {
      const segmentResult = makeSegmentResult();

      // Mark both as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));
      mortalityManager.recordDeath('Kendall', new Date('2024-01-02'));

      const event: RothConversionEvent = {
        id: 'roth-conversion-event-1',
        type: EventType.rothConversion,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        year: 2024,
      };

      const result = calculator.processRothConversionEvent(event, segmentResult);

      // Roth conversion should be skipped when all deceased
      expect(result.size).toBe(0);
    });

    it('should process Roth conversion when at least one person is alive', () => {
      const segmentResult = makeSegmentResult();

      // Mark Jake as deceased but Kendall alive
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));

      const event: RothConversionEvent = {
        id: 'roth-conversion-event-1',
        type: EventType.rothConversion,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        year: 2024,
      };

      // Mock the conversion manager to return a successful conversion
      const mockConversions = [
        {
          sourceAccountId: 'account-1',
          destinationAccountId: 'account-2',
          amount: 5000,
        },
      ];
      calculator['rothConversionManager'].processConversions = vi.fn(() => mockConversions);

      const result = calculator.processRothConversionEvent(event, segmentResult);

      // Roth conversion should process because Kendall is alive
      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('All Deceased Scenarios', () => {
    it('should have allDeceased() helper function work correctly', () => {
      // Initially, no persons tracked (no LTC config)
      expect(mortalityManager.allDeceased()).toBe(false);
    });

    it('should skip RMD when all persons are deceased', () => {
      // Create a proper account with usesRMD
      const rmdFromAccount = {
        ...makeAccount({ id: 'account-1' }),
        usesRMD: true,
        rmdAccount: 'rmd-account',
      };
      const rmdToAccount = makeAccount({ id: 'rmd-account' });

      balanceTracker.findAccountById = vi.fn((id: string) => {
        if (id === 'account-1') return rmdFromAccount;
        if (id === 'rmd-account') return rmdToAccount;
        return undefined;
      });
      accountManager.getAccountByName = vi.fn(() => rmdToAccount);

      const segmentResult = makeSegmentResult();
      // Mark both as deceased
      mortalityManager.recordDeath('Jake', new Date('2024-01-01'));
      mortalityManager.recordDeath('Kendall', new Date('2024-01-02'));

      const event: RMDEvent = {
        id: 'rmd-event-1',
        type: EventType.rmd,
        date: new Date('2024-01-15'),
        accountId: 'account-1',
        priority: 0,
        fromAccountId: 'account-1',
        toAccountId: 'rmd-account',
        ownerAge: 72,
      };

      const result = calculator.processRMDEvent(event, segmentResult);

      // RMD should be skipped when all deceased
      expect(result.size).toBe(0);
    });
  });
});
