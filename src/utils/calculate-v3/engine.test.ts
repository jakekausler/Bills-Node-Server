// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for all heavy dependencies; vi.fn() for simple stubs
// - Async: async/await
// - Structure: describe/it blocks with beforeEach / afterEach

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies before any imports
// ---------------------------------------------------------------------------

vi.mock('./cache', () => ({
  initializeCache: vi.fn(() => mockCacheManager),
  CacheManager: vi.fn(),
}));

vi.mock('./timeline', () => ({
  Timeline: {
    fromAccountsAndTransfers: vi.fn(),
  },
}));

vi.mock('./balance-tracker', () => ({
  BalanceTracker: vi.fn(),
}));

vi.mock('./segment-processor', () => ({
  SegmentProcessor: vi.fn(),
}));

vi.mock('./calculator', () => ({
  Calculator: vi.fn(() => ({
    setMonteCarloConfig: vi.fn(),
    setMCRateGetter: vi.fn(),
    getRothConversionManager: vi.fn(() => ({})),
    getMortalityManager: vi.fn(() => null),
    getJobLossManager: vi.fn(() => ({ isUnemployed: vi.fn(() => false), evaluateYearStart: vi.fn() })),
    setLifeInsuranceManager: vi.fn(),
    setTaxProfile: vi.fn(),
    setPortfolioManager: vi.fn(),
    setPortfolioCutoffDates: vi.fn(),
    setFutureLotTracker: vi.fn(),
    setPendingPayouts: vi.fn(),
    getDeductionTracker: vi.fn(() => null),
  })),
}));

vi.mock('./push-pull-handler', () => ({
  PushPullHandler: vi.fn(),
}));

vi.mock('./account-manager', () => ({
  AccountManager: vi.fn(),
}));

vi.mock('./tax-manager', () => ({
  TaxManager: vi.fn(),
}));

vi.mock('./retirement-manager', () => ({
  RetirementManager: vi.fn(() => ({
    setMCRateGetter: vi.fn(),
    setMortalityManager: vi.fn(),
  })),
}));

vi.mock('./healthcare-manager', () => ({
  HealthcareManager: vi.fn(() => ({
    setMortalityManager: vi.fn(),
    setMCRateGetter: vi.fn(),
  })),
}));

vi.mock('./spending-tracker-manager', () => ({
  SpendingTrackerManager: vi.fn(),
}));

vi.mock('./monte-carlo-handler', () => ({
  MonteCarloHandler: {
    getInstance: vi.fn(() => ({
      getPRNG: vi.fn(() => vi.fn(() => 0.5)),
      getSample: vi.fn(() => 0.5),
    })),
  },
}));

vi.mock('../io/healthcareConfigs', () => ({
  loadHealthcareConfigs: vi.fn().mockReturnValue([]),
}));

vi.mock('../io/virtualHealthcarePlans', () => ({
  loadAllHealthcareConfigs: vi.fn().mockReturnValue([]),
  generateVirtualHealthcarePlans: vi.fn().mockReturnValue([]),
}));

vi.mock('../io/spendingTracker', () => ({
  loadSpendingTrackerCategories: vi.fn().mockReturnValue([]),
}));

vi.mock('../io/minDate', () => ({
  minDate: vi.fn().mockReturnValue(new Date(Date.UTC(2020, 0, 1))),
}));

vi.mock('./period-utils', () => ({
  computePeriodBoundaries: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Shared mock objects (reassigned per test as needed)
// ---------------------------------------------------------------------------

const mockSegments = [
  { id: 'seg-1', startDate: new Date(Date.UTC(2025, 0, 1)), endDate: new Date(Date.UTC(2025, 0, 31)), events: [], affectedAccountIds: new Set(), cached: false, cacheKey: 'k1' },
];

const mockAccountManager = {
  getSocialSecurities: vi.fn().mockReturnValue([]),
  getPensions: vi.fn().mockReturnValue([]),
  getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
  getAccountByName: vi.fn().mockReturnValue(null),
  getAllAccounts: vi.fn().mockReturnValue([]),
};

const mockTimeline = {
  getSegments: vi.fn().mockReturnValue(mockSegments),
  getAccountManager: vi.fn().mockReturnValue(mockAccountManager),
  applyMonteCarlo: vi.fn(),
  applyGlidePath: vi.fn(),
  setPortfolioMakeup: vi.fn(),
  setCutoffDates: vi.fn(),
  clone: vi.fn(),
};

const mockBalanceTracker = {
  initializeBalances: vi.fn().mockResolvedValue(undefined),
  getAccountsWithFilteredDates: vi.fn().mockReturnValue([]),
  applySegmentResult: vi.fn(),
  getAccountBalance: vi.fn().mockReturnValue(0),
  findAccountById: vi.fn(() => null),
  updateBalance: vi.fn(),
};

const mockSegmentProcessor = {
  processSegment: vi.fn().mockResolvedValue(undefined),
};

const mockCacheManager = {
  getCalculationResult: vi.fn().mockResolvedValue(null),
  setCalculationResult: vi.fn().mockResolvedValue(undefined),
  getSegmentResult: vi.fn().mockResolvedValue(null),
  setSegmentResult: vi.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Wire mocks to constructors
// ---------------------------------------------------------------------------

import { Timeline } from './timeline';
import { BalanceTracker } from './balance-tracker';
import { SegmentProcessor } from './segment-processor';
import { Engine, calculateAllActivity } from './engine';
import { CalculationOptions } from './types';

function wireConstructorMocks() {
  (Timeline.fromAccountsAndTransfers as any).mockResolvedValue(mockTimeline);
  (mockTimeline.clone as any).mockReturnValue(mockTimeline);
  (BalanceTracker as any).mockImplementation(() => mockBalanceTracker);
  (SegmentProcessor as any).mockImplementation(() => mockSegmentProcessor);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(id: string, name: string = 'Account'): any {
  return {
    id,
    name,
    balance: 1000,
    consolidatedActivity: [
      {
        amount: 500,
        balance: 1500,
      },
    ],
    serialize: vi.fn().mockReturnValue({ id, name }),
    interests: [],
    bills: [],
    activity: [],
  };
}

function makeAccountsAndTransfers(accounts: any[] = []): any {
  return {
    accounts,
    transfers: { activity: [], bills: [] },
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireConstructorMocks();
    // Reset cache to miss by default
    mockCacheManager.getCalculationResult.mockResolvedValue(null);
    mockCacheManager.setCalculationResult.mockResolvedValue(undefined);
    mockBalanceTracker.getAccountsWithFilteredDates.mockReturnValue([]);
  });

  // -------------------------------------------------------------------------
  // Constructor / mergeConfig
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('creates an Engine with default config', () => {
      const engine = new Engine('Default');
      expect(engine).toBeDefined();
    });

    it('creates an Engine with custom config', () => {
      const engine = new Engine('Default', { snapshotInterval: 'yearly', useDiskCache: true });
      expect(engine).toBeDefined();
    });

    it('creates an Engine in monte carlo mode', () => {
      const engine = new Engine('Default', {}, true);
      expect(engine).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // calculate - cache hit
  // -------------------------------------------------------------------------
  describe('calculate - cache hit', () => {
    it('returns cached result when available and not forceRecalculation', async () => {
      const cachedResult = makeAccountsAndTransfers([makeAccount('acct-1')]);
      mockCacheManager.getCalculationResult.mockResolvedValue(cachedResult);

      const engine = new Engine('Default');
      const options = makeOptions();
      const result = await engine.calculate(makeAccountsAndTransfers(), options);

      expect(result).toBe(cachedResult);
      expect(mockCacheManager.getCalculationResult).toHaveBeenCalledWith(options.startDate, options.endDate);
      // Should NOT have called fromAccountsAndTransfers since cache was hit
      expect(Timeline.fromAccountsAndTransfers).not.toHaveBeenCalled();
    });

    it('skips cache check when forceRecalculation is true', async () => {
      const cachedResult = makeAccountsAndTransfers([makeAccount('acct-1')]);
      mockCacheManager.getCalculationResult.mockResolvedValue(cachedResult);

      const engine = new Engine('Default');
      const options = makeOptions({ forceRecalculation: true });
      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(mockCacheManager.getCalculationResult).not.toHaveBeenCalled();
      expect(Timeline.fromAccountsAndTransfers).toHaveBeenCalled();
    });

    it('skips cache check when monteCarlo is true', async () => {
      const cachedResult = makeAccountsAndTransfers([makeAccount('acct-1')]);
      mockCacheManager.getCalculationResult.mockResolvedValue(cachedResult);

      const engine = new Engine('Default', {}, true);
      const options = makeOptions({ monteCarlo: true, simulationNumber: 1, totalSimulations: 100 });

      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(mockCacheManager.getCalculationResult).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // calculate - full calculation
  // -------------------------------------------------------------------------
  describe('calculate - full calculation', () => {
    it('performs full calculation on cache miss', async () => {
      const accountsAndTransfers = makeAccountsAndTransfers([makeAccount('acct-1')]);
      const engine = new Engine('Default');
      const options = makeOptions();

      const result = await engine.calculate(accountsAndTransfers, options);

      expect(Timeline.fromAccountsAndTransfers).toHaveBeenCalled();
      expect(mockBalanceTracker.initializeBalances).toHaveBeenCalledWith(accountsAndTransfers, false);
      expect(mockSegmentProcessor.processSegment).toHaveBeenCalledWith(mockSegments[0], options);
      expect(result).toBeDefined();
    });

    it('calls processSegment for each segment in the timeline', async () => {
      const extraSegments = [
        ...mockSegments,
        { id: 'seg-2', startDate: new Date(Date.UTC(2025, 1, 1)), endDate: new Date(Date.UTC(2025, 1, 28)), events: [], affectedAccountIds: new Set(), cached: false, cacheKey: 'k2' },
      ];
      mockTimeline.getSegments.mockReturnValue(extraSegments);

      const engine = new Engine('Default');
      const options = makeOptions();
      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(mockSegmentProcessor.processSegment).toHaveBeenCalledTimes(2);
    });

    it('caches result after calculation when not monteCarlo', async () => {
      const engine = new Engine('Default');
      const options = makeOptions();
      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(mockCacheManager.setCalculationResult).toHaveBeenCalled();
    });

    it('does not cache result in monte carlo mode', async () => {
      const engine = new Engine('Default', {}, true);
      const options = makeOptions({ monteCarlo: true });
      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(mockCacheManager.setCalculationResult).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // formatResults
  // -------------------------------------------------------------------------
  describe('formatResults (via calculate)', () => {
    it('rounds consolidatedActivity amounts to 2 decimal places', async () => {
      const account = makeAccount('acct-1');
      account.consolidatedActivity = [
        { amount: 123.456789, balance: 999.1234 },
        { amount: -50.009, balance: 500.567 },
      ];
      mockBalanceTracker.getAccountsWithFilteredDates.mockReturnValue([account]);

      const engine = new Engine('Default');
      const options = makeOptions();
      const result = await engine.calculate(makeAccountsAndTransfers(), options);

      expect(result.accounts[0].consolidatedActivity[0].amount).toBe(123.46);
      expect(result.accounts[0].consolidatedActivity[0].balance).toBe(999.12);
      expect(result.accounts[0].consolidatedActivity[1].amount).toBe(-50.01);
      expect(result.accounts[0].consolidatedActivity[1].balance).toBe(500.57);
    });

    it('handles account with no consolidatedActivity gracefully', async () => {
      const account = makeAccount('acct-1');
      account.consolidatedActivity = undefined;
      mockBalanceTracker.getAccountsWithFilteredDates.mockReturnValue([account]);

      const engine = new Engine('Default');
      const options = makeOptions();
      const result = await engine.calculate(makeAccountsAndTransfers(), options);

      expect(result.accounts).toHaveLength(1);
    });

    it('handles non-numeric amount in consolidatedActivity without throwing', async () => {
      const account = makeAccount('acct-1');
      account.consolidatedActivity = [
        { amount: 'invalid', balance: 100 },
      ];
      mockBalanceTracker.getAccountsWithFilteredDates.mockReturnValue([account]);

      const engine = new Engine('Default');
      const options = makeOptions();
      // Should not throw even with invalid amount
      const result = await engine.calculate(makeAccountsAndTransfers(), options);
      expect(result).toBeDefined();
    });

    it('preserves transfers in results', async () => {
      const transfers = { activity: [{ id: 'act-1' }], bills: [] };
      const accountsAndTransfers = makeAccountsAndTransfers();
      accountsAndTransfers.transfers = transfers;

      const engine = new Engine('Default');
      const options = makeOptions();
      const result = await engine.calculate(accountsAndTransfers, options);

      expect(result.transfers).toBe(transfers);
    });
  });

  // -------------------------------------------------------------------------
  // calculate - with provided timeline
  // -------------------------------------------------------------------------
  describe('calculate - with provided timeline', () => {
    it('clones a provided timeline instead of building from scratch', async () => {
      const providedTimeline = { ...mockTimeline };
      (providedTimeline.clone as any) = vi.fn().mockReturnValue(mockTimeline);

      const engine = new Engine('Default');
      const options = makeOptions();
      await engine.calculate(makeAccountsAndTransfers(), options, providedTimeline as any);

      // Should call clone on the provided timeline, not fromAccountsAndTransfers
      expect(providedTimeline.clone).toHaveBeenCalled();
      expect(Timeline.fromAccountsAndTransfers).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // logging behavior
  // -------------------------------------------------------------------------
  describe('logging', () => {
    it('logs messages when enableLogging is true', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const engine = new Engine('Default');
      const options = makeOptions({ enableLogging: true });
      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not log when enableLogging is false', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const engine = new Engine('Default');
      const options = makeOptions({ enableLogging: false });
      await engine.calculate(makeAccountsAndTransfers(), options);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// calculateAllActivity convenience function
// ---------------------------------------------------------------------------

describe('calculateAllActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireConstructorMocks();
    mockCacheManager.getCalculationResult.mockResolvedValue(null);
    mockCacheManager.setCalculationResult.mockResolvedValue(undefined);
    mockBalanceTracker.getAccountsWithFilteredDates.mockReturnValue([]);
  });

  it('returns an AccountsAndTransfers result', async () => {
    const accountsAndTransfers = makeAccountsAndTransfers();
    const result = await calculateAllActivity(
      accountsAndTransfers,
      new Date(Date.UTC(2025, 0, 1)),
      new Date(Date.UTC(2025, 11, 31)),
    );

    expect(result).toBeDefined();
    expect(result).toHaveProperty('accounts');
    expect(result).toHaveProperty('transfers');
  });

  it('accepts null startDate', async () => {
    const accountsAndTransfers = makeAccountsAndTransfers();
    const result = await calculateAllActivity(
      accountsAndTransfers,
      null,
      new Date(Date.UTC(2025, 11, 31)),
    );

    expect(result).toBeDefined();
  });

  it('passes simulation parameter to Engine', async () => {
    const { initializeCache } = await import('./cache');

    const accountsAndTransfers = makeAccountsAndTransfers();
    await calculateAllActivity(
      accountsAndTransfers,
      null,
      new Date(Date.UTC(2025, 11, 31)),
      'MySimulation',
    );

    expect(initializeCache).toHaveBeenCalledWith(
      expect.any(Object),
      'MySimulation',
      false,
    );
  });

  it('defaults simulation to "Default" when not provided', async () => {
    const { initializeCache } = await import('./cache');

    const accountsAndTransfers = makeAccountsAndTransfers();
    await calculateAllActivity(
      accountsAndTransfers,
      null,
      new Date(Date.UTC(2025, 11, 31)),
    );

    expect(initializeCache).toHaveBeenCalledWith(
      expect.any(Object),
      'Default',
      false,
    );
  });

  it('passes monteCarlo flag to Engine', async () => {
    const { initializeCache } = await import('./cache');

    await calculateAllActivity(
      makeAccountsAndTransfers(),
      null,
      new Date(Date.UTC(2025, 11, 31)),
      'Default',
      true,
    );

    expect(initializeCache).toHaveBeenCalledWith(
      expect.any(Object),
      'Default',
      true,
    );
  });

  it('accepts config overrides', async () => {
    const accountsAndTransfers = makeAccountsAndTransfers();
    const result = await calculateAllActivity(
      accountsAndTransfers,
      null,
      new Date(Date.UTC(2025, 11, 31)),
      'Default',
      false,
      1,
      1,
      false,
      false,
      { snapshotInterval: 'yearly' },
    );

    expect(result).toBeDefined();
  });
});
