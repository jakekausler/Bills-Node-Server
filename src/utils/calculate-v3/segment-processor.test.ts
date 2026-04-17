// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.fn() for all dependency methods; vi.mock() for module imports
// - Async: async/await
// - Structure: describe/it blocks with beforeEach

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy dependencies
// ---------------------------------------------------------------------------

vi.mock('./cache', () => ({
  CacheManager: vi.fn(),
  initializeCache: vi.fn(),
}));

vi.mock('./balance-tracker', () => ({
  BalanceTracker: vi.fn(),
}));

vi.mock('./calculator', () => ({
  Calculator: vi.fn(),
}));

vi.mock('./push-pull-handler', () => ({
  PushPullHandler: vi.fn(),
}));

vi.mock('./retirement-manager', () => ({
  RetirementManager: vi.fn(),
}));

vi.mock('./tax-manager', () => ({
  TaxManager: vi.fn(),
}));

vi.mock('./account-manager', () => ({
  AccountManager: vi.fn(),
}));

vi.mock('./healthcare-manager', () => ({
  HealthcareManager: vi.fn(),
}));

vi.mock('./spending-tracker-manager', () => ({
  SpendingTrackerManager: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

// Set up dayjs UTC plugin before any module that uses dayjs.utc() is imported.
// segment-processor.ts calls dayjs.utc() which requires this plugin.
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { SegmentProcessor } from './segment-processor';
import { CalculationOptions, EventType, IncomeType, Segment, SegmentResult, TimelineEvent } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides: Partial<CalculationOptions> = {}): CalculationOptions {
  return {
    startDate: new Date(Date.UTC(2025, 0, 1)),
    endDate: new Date(Date.UTC(2025, 11, 31)),
    simulation: 'Default',
    monteCarlo: false,
    simulationNumber: 1,
    totalSimulations: 1,
    forceRecalculation: false,
    enableLogging: false,
    config: {},
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    type: EventType.activity,
    date: new Date(Date.UTC(2025, 0, 15)),
    accountId: 'acct-1',
    priority: 1,
    ...overrides,
  };
}

function makeSegment(events: TimelineEvent[] = []): Segment {
  return {
    id: 'seg-1',
    startDate: new Date(Date.UTC(2025, 0, 1)),
    endDate: new Date(Date.UTC(2025, 0, 31)),
    events,
    affectedAccountIds: new Set(['acct-1']),
    cached: false,
    cacheKey: 'test-key',
  };
}

function makeSegmentResult(overrides: Partial<SegmentResult> = {}): SegmentResult {
  return {
    balanceChanges: new Map(),
    activitiesAdded: new Map(),
    processedEventIds: new Set(),
    balanceMinimums: new Map(),
    balanceMaximums: new Map(),
    taxableOccurrences: new Map(),
    spendingTrackerUpdates: [],
    healthcareExpenseUpdates: [],
    retirementStateUpdates: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockCache(overrides: Partial<any> = {}) {
  return {
    getSegmentResult: vi.fn().mockResolvedValue(null),
    setSegmentResult: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockBalanceTracker(overrides: Partial<any> = {}) {
  return {
    applySegmentResult: vi.fn(),
    getAccountBalance: vi.fn().mockReturnValue(1000),
    ...overrides,
  };
}

function makeMockCalculator(overrides: Partial<any> = {}) {
  return {
    processActivityEvent: vi.fn().mockReturnValue(new Map([['acct-1', -100]])),
    processBillEvent: vi.fn().mockReturnValue(new Map([['acct-1', -200]])),
    processInterestEvent: vi.fn().mockReturnValue(new Map([['acct-1', 10]])),
    processActivityTransferEvent: vi.fn().mockReturnValue(new Map()),
    processBillTransferEvent: vi.fn().mockReturnValue(new Map()),
    processPensionEvent: vi.fn().mockReturnValue(new Map([['acct-1', 500]])),
    processSocialSecurityEvent: vi.fn().mockReturnValue(new Map([['acct-1', 600]])),
    processTaxEvent: vi.fn().mockReturnValue(new Map([['acct-1', -300]])),
    processRMDEvent: vi.fn().mockReturnValue(new Map()),
    processSpendingTrackerEvent: vi.fn().mockReturnValue(new Map()),
    setCurrentDate: vi.fn(),
    checkpoint: vi.fn(),
    restore: vi.fn(),
    injectPendingPayouts: vi.fn(),
    clearPendingPayouts: vi.fn(),
    ...overrides,
  };
}

function makeMockPushPullHandler(overrides: Partial<any> = {}) {
  return {
    handleAccountPushPulls: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function makeMockRetirementManager(overrides: Partial<any> = {}) {
  return {
    tryAddToAnnualIncomes: vi.fn(),
    drainRetirementUpdates: vi.fn().mockReturnValue([]),
    setReplaying: vi.fn(),
    setSocialSecurityMonthlyPayRaw: vi.fn(),
    setSocialSecurityFirstPaymentYear: vi.fn(),
    setPensionMonthlyPayRaw: vi.fn(),
    setPensionFirstPaymentYear: vi.fn(),
    setSocialSecurityAnnualIncomeRaw: vi.fn(),
    setPensionAnnualIncomeRaw: vi.fn(),
    ...overrides,
  };
}

function makeMockTaxManager(overrides: Partial<any> = {}) {
  return {
    addTaxableOccurrences: vi.fn(),
    addWithholdingOccurrence: vi.fn(),
    addFicaOccurrence: vi.fn(),
    checkpoint: vi.fn(),
    restore: vi.fn(),
    ...overrides,
  };
}

function makeMockAccountManager(overrides: Partial<any> = {}) {
  return {
    getAccountByName: vi.fn().mockReturnValue({ id: 'acct-1', name: 'Checking' }),
    ...overrides,
  };
}

function makeMockHealthcareManager(overrides: Partial<any> = {}) {
  return {
    getActiveConfig: vi.fn().mockReturnValue(null),
    calculatePatientCost: vi.fn(),
    checkpoint: vi.fn(),
    restore: vi.fn(),
    drainExpenseUpdates: vi.fn().mockReturnValue([]),
    resetExpenseUpdateBuffer: vi.fn(),
    setReplaying: vi.fn(),
    getConfigById: vi.fn().mockReturnValue(undefined),
    recordHealthcareExpense: vi.fn(),
    advanceToDate: vi.fn(),
    ...overrides,
  };
}

function makeMockSpendingTrackerManager(overrides: Partial<any> = {}) {
  return {
    checkpoint: vi.fn(),
    restore: vi.fn(),
    recordSegmentActivities: vi.fn(),
    setCarryBalance: vi.fn(),
    resetPeriodSpending: vi.fn(),
    markPeriodProcessed: vi.fn(),
    ...overrides,
  };
}

function makeProcessor(
  cacheOverrides: Partial<any> = {},
  balanceTrackerOverrides: Partial<any> = {},
  calculatorOverrides: Partial<any> = {},
  pushPullOverrides: Partial<any> = {},
  retirementOverrides: Partial<any> = {},
  taxOverrides: Partial<any> = {},
  accountOverrides: Partial<any> = {},
  healthcareOverrides: Partial<any> = {},
  spendingTrackerOverrides: Partial<any> = {},
): {
  processor: SegmentProcessor;
  cache: any;
  balanceTracker: any;
  calculator: any;
  pushPullHandler: any;
  retirementManager: any;
  taxManager: any;
  accountManager: any;
  healthcareManager: any;
  spendingTrackerManager: any;
} {
  const cache = makeMockCache(cacheOverrides);
  const balanceTracker = makeMockBalanceTracker(balanceTrackerOverrides);
  const calculator = makeMockCalculator(calculatorOverrides);
  const pushPullHandler = makeMockPushPullHandler(pushPullOverrides);
  const retirementManager = makeMockRetirementManager(retirementOverrides);
  const taxManager = makeMockTaxManager(taxOverrides);
  const accountManager = makeMockAccountManager(accountOverrides);
  const healthcareManager = makeMockHealthcareManager(healthcareOverrides);
  const spendingTrackerManager = makeMockSpendingTrackerManager(spendingTrackerOverrides);

  const processor = new SegmentProcessor(
    cache,
    balanceTracker,
    calculator,
    pushPullHandler,
    retirementManager,
    taxManager,
    accountManager,
    healthcareManager,
    spendingTrackerManager,
  );

  return {
    processor,
    cache,
    balanceTracker,
    calculator,
    pushPullHandler,
    retirementManager,
    taxManager,
    accountManager,
    healthcareManager,
    spendingTrackerManager,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SegmentProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // processSegment - cache hit
  // -------------------------------------------------------------------------
  describe('processSegment - cache hit', () => {
    it('applies cached result when segment is cached and not forceRecalculation', async () => {
      const cachedResult = makeSegmentResult({
        balanceChanges: new Map([['acct-1', 500]]),
        activitiesAdded: new Map(),
        spendingTrackerUpdates: [],
      });

      const { processor, cache, balanceTracker } = makeProcessor({ getSegmentResult: vi.fn().mockResolvedValue(cachedResult) });
      const segment = makeSegment();
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(cache.getSegmentResult).toHaveBeenCalledWith(segment);
      expect(balanceTracker.applySegmentResult).toHaveBeenCalledWith(cachedResult, segment.startDate);
    });

    it('replays spending tracker updates from cached result', async () => {
      const cachedResult = makeSegmentResult({
        spendingTrackerUpdates: [
          {
            categoryId: 'cat-1',
            totalSpent: 200,
            date: new Date(Date.UTC(2025, 0, 31)),
            periodEnd: new Date(Date.UTC(2025, 0, 31)),
            carryAfter: 50,
          },
        ],
        activitiesAdded: new Map(),
      });

      const { processor, spendingTrackerManager } = makeProcessor({ getSegmentResult: vi.fn().mockResolvedValue(cachedResult) });
      const segment = makeSegment();
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(spendingTrackerManager.setCarryBalance).toHaveBeenCalledWith('cat-1', 50);
      expect(spendingTrackerManager.resetPeriodSpending).toHaveBeenCalledWith('cat-1');
      expect(spendingTrackerManager.markPeriodProcessed).toHaveBeenCalledWith('cat-1', expect.any(Date));
    });

    it('does not check cache when forceRecalculation is true', async () => {
      const { processor, cache } = makeProcessor();
      const segment = makeSegment();
      const options = makeOptions({ forceRecalculation: true });

      await processor.processSegment(segment, options);

      expect(cache.getSegmentResult).not.toHaveBeenCalled();
    });

    it('does not check cache when monteCarlo is true', async () => {
      const { processor, cache } = makeProcessor();
      const segment = makeSegment();
      const options = makeOptions({ monteCarlo: true });

      await processor.processSegment(segment, options);

      expect(cache.getSegmentResult).not.toHaveBeenCalled();
    });

    it('replays healthcare expense updates from cached result using recordHealthcareExpense directly', async () => {
      const mockConfig = { id: 'hc-config-1', name: 'BCBS' };
      const expenseUpdate = {
        personName: 'John',
        date: new Date(Date.UTC(2025, 0, 15)),
        amountTowardDeductible: 200,
        amountTowardOOP: 200,
        configId: 'hc-config-1',
      };
      const cachedResult = makeSegmentResult({
        activitiesAdded: new Map(),
        spendingTrackerUpdates: [],
        healthcareExpenseUpdates: [expenseUpdate],
      });

      const { processor, healthcareManager } = makeProcessor(
        { getSegmentResult: vi.fn().mockResolvedValue(cachedResult) },
        {},
        {},
        {},
        {},
        {},
        {},
        {
          getConfigById: vi.fn().mockReturnValue(mockConfig),
          recordHealthcareExpense: vi.fn(),
          setReplaying: vi.fn(),
        },
      );
      const segment = makeSegment();
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(healthcareManager.setReplaying).toHaveBeenCalledWith(true);
      expect(healthcareManager.getConfigById).toHaveBeenCalledWith('hc-config-1');
      expect(healthcareManager.recordHealthcareExpense).toHaveBeenCalledWith(
        'John',
        expect.any(Date),
        200,
        200,
        mockConfig,
      );
      expect(healthcareManager.setReplaying).toHaveBeenCalledWith(false);
    });

    it('does not replay healthcare when healthcareExpenseUpdates is empty', async () => {
      const cachedResult = makeSegmentResult({
        activitiesAdded: new Map(),
        spendingTrackerUpdates: [],
        healthcareExpenseUpdates: [],
      });

      const { processor, healthcareManager } = makeProcessor(
        { getSegmentResult: vi.fn().mockResolvedValue(cachedResult) },
      );
      const segment = makeSegment();
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(healthcareManager.setReplaying).not.toHaveBeenCalled();
      expect(healthcareManager.recordHealthcareExpense).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // processSegment - full processing
  // -------------------------------------------------------------------------
  describe('processSegment - full processing', () => {
    it('processes events in segment and applies result to balance tracker', async () => {
      const event = makeEvent({ type: EventType.activity, id: 'act-1', date: new Date(Date.UTC(2025, 0, 15)) });
      const segment = makeSegment([event]);
      const options = makeOptions();

      const { processor, calculator, balanceTracker } = makeProcessor();
      await processor.processSegment(segment, options);

      expect(calculator.processActivityEvent).toHaveBeenCalledWith(event, expect.any(Object));
      expect(balanceTracker.applySegmentResult).toHaveBeenCalled();
    });

    it('calls spendingTrackerManager.checkpoint before processing', async () => {
      const { processor, spendingTrackerManager } = makeProcessor();
      const segment = makeSegment([makeEvent()]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(spendingTrackerManager.checkpoint).toHaveBeenCalled();
    });

    it('caches the segment result when not monteCarlo', async () => {
      const { processor, cache } = makeProcessor();
      const segment = makeSegment([makeEvent()]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(cache.setSegmentResult).toHaveBeenCalledWith(segment, expect.any(Object));
    });

    it('does not cache the segment result when monteCarlo', async () => {
      const { processor, cache } = makeProcessor();
      const segment = makeSegment([makeEvent()]);
      const options = makeOptions({ monteCarlo: true });

      await processor.processSegment(segment, options);

      expect(cache.setSegmentResult).not.toHaveBeenCalled();
    });

    it('reprocesses events when push-pull adds events', async () => {
      // First call returns true (pushPull added), second call returns false
      const pushPullHandler = makeMockPushPullHandler({
        handleAccountPushPulls: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      });
      const { processor, calculator, spendingTrackerManager } = makeProcessor(
        {},
        {},
        {},
        pushPullHandler,
      );
      const segment = makeSegment([makeEvent()]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      // processActivityEvent should be called twice (once per processSegmentEvents call)
      expect(calculator.processActivityEvent).toHaveBeenCalledTimes(2);
      // restore() should be called before reprocessing
      expect(spendingTrackerManager.restore).toHaveBeenCalled();
    });

    it('adds retirement incomes from segment activities', async () => {
      const event = makeEvent({ type: EventType.activity, id: 'act-1', date: new Date(Date.UTC(2025, 0, 15)) });
      const mockActivity = { name: 'Salary', date: new Date(Date.UTC(2025, 0, 15)), amount: 5000 };
      const calculator = makeMockCalculator({
        processActivityEvent: vi.fn().mockImplementation((_event, segmentResult) => {
          segmentResult.activitiesAdded.set('acct-1', [mockActivity]);
          return new Map([['acct-1', 5000]]);
        }),
      });

      const { processor, retirementManager } = makeProcessor({}, {}, calculator);
      const segment = makeSegment([event]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(retirementManager.tryAddToAnnualIncomes).toHaveBeenCalledWith('Salary', expect.any(Date), 5000);
    });

    it('adds taxable occurrences to tax manager', async () => {
      const event = makeEvent({ type: EventType.tax, id: 'tax-1', date: new Date(Date.UTC(2025, 2, 1)), priority: 3 });
      const mockTaxableOccurrence = { date: new Date(), year: 2025, amount: 1000, incomeType: 'ordinary' as IncomeType };
      const calculator = makeMockCalculator({
        processTaxEvent: vi.fn().mockImplementation((_event, segmentResult) => {
          segmentResult.taxableOccurrences.set('Checking', [mockTaxableOccurrence]);
          return new Map([['acct-1', -220]]);
        }),
      });

      const { processor, taxManager } = makeProcessor({}, {}, calculator);
      const segment = makeSegment([event]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(taxManager.addTaxableOccurrences).toHaveBeenCalledWith('acct-1', [mockTaxableOccurrence]);
    });

    it('handles taxable occurrence with unknown account gracefully', async () => {
      const event = makeEvent({ type: EventType.tax, id: 'tax-1', priority: 3 });
      const mockTaxableOccurrence = { date: new Date(), year: 2025, amount: 1000, incomeType: 'ordinary' as IncomeType };
      const calculator = makeMockCalculator({
        processTaxEvent: vi.fn().mockImplementation((_event, segmentResult) => {
          segmentResult.taxableOccurrences.set('UnknownAccount', [mockTaxableOccurrence]);
          return new Map();
        }),
      });
      const accountManager = makeMockAccountManager({ getAccountByName: vi.fn().mockReturnValue(null) });

      const { processor } = makeProcessor({}, {}, calculator, {}, {}, {}, accountManager);
      const segment = makeSegment([event]);
      const options = makeOptions();

      // Should not throw when account is not found (logged via debugLogger)
      await processor.processSegment(segment, options);
    });

    it('drains healthcare expense buffer into segmentResult after fresh compute', async () => {
      const event = makeEvent({ type: EventType.activity, id: 'act-1', date: new Date(Date.UTC(2025, 0, 15)) });
      const segment = makeSegment([event]);
      const options = makeOptions();

      const expenseUpdate = {
        personName: 'Jane',
        date: new Date(Date.UTC(2025, 0, 15)),
        amountTowardDeductible: 100,
        amountTowardOOP: 100,
        configId: 'hc-config-2',
      };

      const { processor, cache, healthcareManager } = makeProcessor(
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        { drainExpenseUpdates: vi.fn().mockReturnValue([expenseUpdate]) },
      );

      await processor.processSegment(segment, options);

      expect(healthcareManager.drainExpenseUpdates).toHaveBeenCalled();
      // The cached result should include the drained updates
      const cachedSegmentResult = (cache.setSegmentResult as any).mock.calls[0][1];
      expect(cachedSegmentResult.healthcareExpenseUpdates).toEqual([expenseUpdate]);
    });
  });

  // -------------------------------------------------------------------------
  // processSegment - event type routing
  // -------------------------------------------------------------------------
  describe('processSegment - event type routing', () => {
    const eventTypeTests = [
      { type: EventType.activity, calcMethod: 'processActivityEvent', priority: 1 },
      { type: EventType.bill, calcMethod: 'processBillEvent', priority: 2 },
      { type: EventType.interest, calcMethod: 'processInterestEvent', priority: 0 },
      { type: EventType.activityTransfer, calcMethod: 'processActivityTransferEvent', priority: 1 },
      { type: EventType.billTransfer, calcMethod: 'processBillTransferEvent', priority: 2 },
      { type: EventType.pension, calcMethod: 'processPensionEvent', priority: 2 },
      { type: EventType.socialSecurity, calcMethod: 'processSocialSecurityEvent', priority: 2 },
      { type: EventType.tax, calcMethod: 'processTaxEvent', priority: 3 },
      { type: EventType.rmd, calcMethod: 'processRMDEvent', priority: 0.5 },
      { type: EventType.spendingTracker, calcMethod: 'processSpendingTrackerEvent', priority: 2.5 },
    ];

    for (const { type, calcMethod, priority } of eventTypeTests) {
      it(`routes ${type} event to calculator.${calcMethod}`, async () => {
        const event = makeEvent({ type, id: `${type}-1`, priority });
        const segment = makeSegment([event]);
        const options = makeOptions();

        const { processor, calculator } = makeProcessor();
        await processor.processSegment(segment, options);

        expect((calculator as any)[calcMethod]).toHaveBeenCalled();
      });
    }

    it('handles unknown event type gracefully', async () => {
      const event = { ...makeEvent(), type: 'unknown_type' as any };
      const segment = makeSegment([event]);
      const options = makeOptions();

      const { processor } = makeProcessor();
      // Should not throw for unknown event types (logged via debugLogger)
      await processor.processSegment(segment, options);
    });
  });

  // -------------------------------------------------------------------------
  // processSegmentEvents - balance tracking
  // -------------------------------------------------------------------------
  describe('processSegmentEvents - balance tracking', () => {
    it('tracks minimum balance across events within segment', async () => {
      const event1 = makeEvent({ id: 'evt-1', date: new Date(Date.UTC(2025, 0, 10)), priority: 1 });
      const event2 = makeEvent({ id: 'evt-2', date: new Date(Date.UTC(2025, 0, 20)), priority: 1 });
      const segment = makeSegment([event1, event2]);

      const balanceTracker = makeMockBalanceTracker({
        getAccountBalance: vi.fn().mockReturnValue(1000),
        applySegmentResult: vi.fn().mockImplementation((_result, _date) => {
          // Capture result to inspect it
        }),
      });

      // First event: -300, Second event: -500
      const calculator = makeMockCalculator({
        processActivityEvent: vi.fn()
          .mockReturnValueOnce(new Map([['acct-1', -300]]))
          .mockReturnValueOnce(new Map([['acct-1', -500]])),
      });

      const { processor } = makeProcessor({}, balanceTracker, calculator);
      const options = makeOptions();
      await processor.processSegment(segment, options);

      expect(balanceTracker.applySegmentResult).toHaveBeenCalled();
      const capturedResult = (balanceTracker.applySegmentResult as any).mock.calls[0][0] as SegmentResult;
      expect(capturedResult.balanceMinimums.get('acct-1')).toBe(200); // 1000 - 300 - 500
      expect(capturedResult.balanceMaximums.get('acct-1')).toBe(700); // 1000 - 300
    });

    it('handles segment with no events', async () => {
      const segment = makeSegment([]);
      const options = makeOptions();

      const { processor, balanceTracker } = makeProcessor();
      await processor.processSegment(segment, options);

      // Should still apply an empty result
      expect(balanceTracker.applySegmentResult).toHaveBeenCalled();
    });

    it('processes events on the same day correctly', async () => {
      const sameDate = new Date(Date.UTC(2025, 0, 15));
      const event1 = makeEvent({ id: 'evt-1', date: sameDate, priority: 1 });
      const event2 = makeEvent({ id: 'evt-2', date: sameDate, priority: 2 });
      const segment = makeSegment([event1, event2]);
      const options = makeOptions();

      const { processor, calculator } = makeProcessor();
      await processor.processSegment(segment, options);

      expect(calculator.processActivityEvent).toHaveBeenCalledTimes(2);
    });

    it('groups events by date for processing', async () => {
      const date1 = new Date(Date.UTC(2025, 0, 10));
      const date2 = new Date(Date.UTC(2025, 0, 20));
      const event1 = makeEvent({ id: 'evt-1', date: date1, priority: 1 });
      const event2 = makeEvent({ id: 'evt-2', date: date2, priority: 1 });
      const segment = makeSegment([event1, event2]);
      const options = makeOptions();

      const { processor, balanceTracker } = makeProcessor();
      await processor.processSegment(segment, options);

      expect(balanceTracker.applySegmentResult).toHaveBeenCalled();
      const capturedResult = (balanceTracker.applySegmentResult as any).mock.calls[0][0] as SegmentResult;
      expect(capturedResult.processedEventIds.has('evt-1')).toBe(true);
      expect(capturedResult.processedEventIds.has('evt-2')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // processDayEvents - sorting
  // -------------------------------------------------------------------------
  describe('processDayEvents - event sorting', () => {
    it('processes lower priority events before higher priority events', async () => {
      const sameDate = new Date(Date.UTC(2025, 0, 15));
      const highPriorityEvent = makeEvent({ id: 'high', type: EventType.rmd, date: sameDate, priority: 0.5 });
      const lowPriorityEvent = makeEvent({ id: 'low', type: EventType.interest, date: sameDate, priority: 0 });
      const segment = makeSegment([highPriorityEvent, lowPriorityEvent]);
      const options = makeOptions();

      const callOrder: string[] = [];
      const calculator = makeMockCalculator({
        processInterestEvent: vi.fn().mockImplementation(() => { callOrder.push('interest'); return new Map(); }),
        processRMDEvent: vi.fn().mockImplementation(() => { callOrder.push('rmd'); return new Map(); }),
      });

      const { processor } = makeProcessor({}, {}, calculator);
      await processor.processSegment(segment, options);

      // Interest (priority 0) should be processed before RMD (priority 0.5)
      expect(callOrder.indexOf('interest')).toBeLessThan(callOrder.indexOf('rmd'));
    });
  });

  // -------------------------------------------------------------------------
  // recordSegmentActivities
  // -------------------------------------------------------------------------
  describe('recordSegmentActivities', () => {
    it('calls recordSegmentActivities after processing', async () => {
      const { processor, spendingTrackerManager } = makeProcessor();
      const segment = makeSegment([makeEvent()]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      expect(spendingTrackerManager.recordSegmentActivities).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // AIME Integration (Paycheck Editor Stage 5)
  // -------------------------------------------------------------------------
  describe('AIME integration with paycheck activities', () => {
    it('skips tryAddToAnnualIncomes for activities with isPaycheckActivity flag', async () => {
      const paycheckActivity = {
        name: 'Paycheck',
        date: new Date(Date.UTC(2025, 0, 15)),
        amount: 3000,
        isPaycheckActivity: true, // This flag marks it as a paycheck activity
      };
      const event = makeEvent({ type: EventType.activity, id: 'act-1', date: new Date(Date.UTC(2025, 0, 15)) });
      const calculator = makeMockCalculator({
        processActivityEvent: vi.fn().mockImplementation((_event, segmentResult) => {
          segmentResult.activitiesAdded.set('acct-1', [paycheckActivity]);
          return new Map([['acct-1', 3000]]);
        }),
      });

      const { processor, retirementManager } = makeProcessor({}, {}, calculator);
      const segment = makeSegment([event]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      // Should NOT have been called because of isPaycheckActivity flag
      expect(retirementManager.tryAddToAnnualIncomes).not.toHaveBeenCalled();
    });

    it('calls tryAddToAnnualIncomes for non-paycheck activities', async () => {
      const regularActivity = {
        name: 'Salary',
        date: new Date(Date.UTC(2025, 0, 15)),
        amount: 5000,
        // No isPaycheckActivity flag
      };
      const event = makeEvent({ type: EventType.activity, id: 'act-1', date: new Date(Date.UTC(2025, 0, 15)) });
      const calculator = makeMockCalculator({
        processActivityEvent: vi.fn().mockImplementation((_event, segmentResult) => {
          segmentResult.activitiesAdded.set('acct-1', [regularActivity]);
          return new Map([['acct-1', 5000]]);
        }),
      });

      const { processor, retirementManager } = makeProcessor({}, {}, calculator);
      const segment = makeSegment([event]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      // Should have been called with the activity's amount
      expect(retirementManager.tryAddToAnnualIncomes).toHaveBeenCalledWith('Salary', expect.any(Date), 5000);
    });

    it('handles mix of paycheck and non-paycheck activities correctly', async () => {
      const paycheckActivity = {
        name: 'Paycheck',
        date: new Date(Date.UTC(2025, 0, 15)),
        amount: 3000,
        isPaycheckActivity: true,
      };
      const bonusActivity = {
        name: 'Bonus',
        date: new Date(Date.UTC(2025, 0, 20)),
        amount: 2000,
        // No isPaycheckActivity flag
      };
      const event1 = makeEvent({ type: EventType.activity, id: 'act-1', date: new Date(Date.UTC(2025, 0, 15)) });
      const event2 = makeEvent({ type: EventType.activity, id: 'act-2', date: new Date(Date.UTC(2025, 0, 20)) });
      const calculator = makeMockCalculator({
        processActivityEvent: vi
          .fn()
          .mockImplementationOnce((_event, segmentResult) => {
            segmentResult.activitiesAdded.set('acct-1', [paycheckActivity]);
            return new Map([['acct-1', 3000]]);
          })
          .mockImplementationOnce((_event, segmentResult) => {
            // Get existing activities and add to them
            const existing = segmentResult.activitiesAdded.get('acct-1') || [];
            segmentResult.activitiesAdded.set('acct-1', [...existing, bonusActivity]);
            return new Map([['acct-1', 2000]]);
          }),
      });

      const { processor, retirementManager } = makeProcessor({}, {}, calculator);
      const segment = makeSegment([event1, event2]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      // Should only be called once for the bonus, not the paycheck
      expect(retirementManager.tryAddToAnnualIncomes).toHaveBeenCalledTimes(1);
      expect(retirementManager.tryAddToAnnualIncomes).toHaveBeenCalledWith('Bonus', expect.any(Date), 2000);
    });
  });

  // -------------------------------------------------------------------------
  // cache observability events
  // -------------------------------------------------------------------------
  describe('cache observability events', () => {
    it('logs cache-hit with segmentId when segment is cached', async () => {
      const cachedResult = makeSegmentResult({
        balanceChanges: new Map([['acct-1', 500]]),
        activitiesAdded: new Map(),
        spendingTrackerUpdates: [],
      });

      const debugLogger = {
        log: vi.fn(),
      };

      // Create processor with debugLogger by manually constructing it
      const cache = makeMockCache({ getSegmentResult: vi.fn().mockResolvedValue(cachedResult) });
      const balanceTracker = makeMockBalanceTracker();
      const calculator = makeMockCalculator();
      const pushPullHandler = makeMockPushPullHandler();
      const retirementManager = makeMockRetirementManager();
      const taxManager = makeMockTaxManager();
      const accountManager = makeMockAccountManager();
      const healthcareManager = makeMockHealthcareManager();
      const spendingTrackerManager = makeMockSpendingTrackerManager();

      const processor = new SegmentProcessor(
        cache,
        balanceTracker,
        calculator,
        pushPullHandler,
        retirementManager,
        taxManager,
        accountManager,
        healthcareManager,
        spendingTrackerManager,
        debugLogger as any,
        1,
      );

      const segment = makeSegment();
      const options = makeOptions();

      await processor.processSegment(segment, options);

      // Assert cache-hit was logged with segmentId
      expect(debugLogger.log).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          component: 'segment',
          event: 'cache-hit',
          segmentId: segment.id,
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        }),
      );

      // Assert cache-miss, segment-compute-start, cache-populate were NOT logged
      const calls = (debugLogger.log as any).mock.calls;
      const events = calls.map((call: any) => call[1].event);
      expect(events).toContain('cache-hit');
      expect(events).not.toContain('cache-miss');
      expect(events).not.toContain('segment-compute-start');
      expect(events).not.toContain('cache-populate');
    });

    it('logs cache-miss, segment-compute-start, and cache-populate in order when cache returns null', async () => {
      const debugLogger = {
        log: vi.fn(),
      };

      const cache = makeMockCache({ getSegmentResult: vi.fn().mockResolvedValue(null) });
      const balanceTracker = makeMockBalanceTracker();
      const calculator = makeMockCalculator();
      const pushPullHandler = makeMockPushPullHandler();
      const retirementManager = makeMockRetirementManager();
      const taxManager = makeMockTaxManager();
      const accountManager = makeMockAccountManager();
      const healthcareManager = makeMockHealthcareManager();
      const spendingTrackerManager = makeMockSpendingTrackerManager();

      const processor = new SegmentProcessor(
        cache,
        balanceTracker,
        calculator,
        pushPullHandler,
        retirementManager,
        taxManager,
        accountManager,
        healthcareManager,
        spendingTrackerManager,
        debugLogger as any,
        1,
      );

      const segment = makeSegment([makeEvent()]);
      const options = makeOptions();

      await processor.processSegment(segment, options);

      // Collect all logged events
      const calls = (debugLogger.log as any).mock.calls;
      const events = calls.map((call: any) => call[1].event);

      // Assert cache-hit was NOT logged
      expect(events).not.toContain('cache-hit');

      // Assert cache-miss, segment-compute-start, cache-populate were logged
      expect(events).toContain('cache-miss');
      expect(events).toContain('segment-compute-start');
      expect(events).toContain('cache-populate');

      // Assert they fired in the correct order
      const cacheHitIndex = events.indexOf('cache-miss');
      const computeStartIndex = events.indexOf('segment-compute-start');
      const populateIndex = events.indexOf('cache-populate');

      expect(cacheHitIndex).toBeLessThan(computeStartIndex);
      expect(computeStartIndex).toBeLessThan(populateIndex);

      // Verify all three have segmentId, startDate, endDate
      const cacheMissCall = calls.find((call: any) => call[1].event === 'cache-miss');
      expect(cacheMissCall[1]).toMatchObject({
        component: 'segment',
        event: 'cache-miss',
        segmentId: segment.id,
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });

      const computeStartCall = calls.find((call: any) => call[1].event === 'segment-compute-start');
      expect(computeStartCall[1]).toMatchObject({
        component: 'segment',
        event: 'segment-compute-start',
        segmentId: segment.id,
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });

      const populateCall = calls.find((call: any) => call[1].event === 'cache-populate');
      expect(populateCall[1]).toMatchObject({
        component: 'segment',
        event: 'cache-populate',
        segmentId: segment.id,
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
    });

    it('logs segment-compute-start but no cache events when monteCarlo is true', async () => {
      const debugLogger = {
        log: vi.fn(),
      };

      const cache = makeMockCache();
      const balanceTracker = makeMockBalanceTracker();
      const calculator = makeMockCalculator();
      const pushPullHandler = makeMockPushPullHandler();
      const retirementManager = makeMockRetirementManager();
      const taxManager = makeMockTaxManager();
      const accountManager = makeMockAccountManager();
      const healthcareManager = makeMockHealthcareManager();
      const spendingTrackerManager = makeMockSpendingTrackerManager();

      const processor = new SegmentProcessor(
        cache,
        balanceTracker,
        calculator,
        pushPullHandler,
        retirementManager,
        taxManager,
        accountManager,
        healthcareManager,
        spendingTrackerManager,
        debugLogger as any,
        1,
      );

      const segment = makeSegment([makeEvent()]);
      const options = makeOptions({ monteCarlo: true });

      await processor.processSegment(segment, options);

      const calls = (debugLogger.log as any).mock.calls;
      const events = calls.map((call: any) => call[1].event);

      // Assert none of the cache events were logged
      expect(events).not.toContain('cache-hit');
      expect(events).not.toContain('cache-miss');
      expect(events).not.toContain('cache-populate');

      // Assert segment-compute-start WAS logged
      expect(events).toContain('segment-compute-start');
    });

    it('skips cache-miss but logs segment-compute-start and cache-populate when forceRecalculation is true', async () => {
      const debugLogger = {
        log: vi.fn(),
      };

      const cache = makeMockCache();
      const balanceTracker = makeMockBalanceTracker();
      const calculator = makeMockCalculator();
      const pushPullHandler = makeMockPushPullHandler();
      const retirementManager = makeMockRetirementManager();
      const taxManager = makeMockTaxManager();
      const accountManager = makeMockAccountManager();
      const healthcareManager = makeMockHealthcareManager();
      const spendingTrackerManager = makeMockSpendingTrackerManager();

      const processor = new SegmentProcessor(
        cache,
        balanceTracker,
        calculator,
        pushPullHandler,
        retirementManager,
        taxManager,
        accountManager,
        healthcareManager,
        spendingTrackerManager,
        debugLogger as any,
        1,
      );

      const segment = makeSegment([makeEvent()]);
      const options = makeOptions({ forceRecalculation: true });

      await processor.processSegment(segment, options);

      const calls = (debugLogger.log as any).mock.calls;
      const events = calls.map((call: any) => call[1].event);

      // Assert cache-miss was NOT logged (lookup was skipped)
      expect(events).not.toContain('cache-miss');

      // Assert segment-compute-start WAS logged
      expect(events).toContain('segment-compute-start');

      // Assert cache-populate WAS logged (result still gets cached)
      expect(events).toContain('cache-populate');

      // Assert cache lookup was never called
      expect(cache.getSegmentResult).not.toHaveBeenCalled();
    });
  });
});
