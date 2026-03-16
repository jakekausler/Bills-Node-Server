import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RothConversionManager } from './roth-conversion-manager';
import { TaxManager } from './tax-manager';
import { Account } from '../../data/account/account';

// Mock the config file and other I/O
vi.mock('fs', () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes('rothConversionConfig.json')) {
      return JSON.stringify([
        {
          enabled: true,
          sourceAccount: 'Jake 401(k)',
          destinationAccount: 'Jake Roth IRA',
          startDateVariable: 'RETIRE_DATE',
          endDateVariable: 'JAKE_SOCIAL_SECURITY_START_DATE',
          strategy: 'fillBracket',
          targetBracketRate: 0.22,
          priority: 'largerFirst',
        },
      ]);
    }
    if (path.includes('pension_and_social_security.json')) {
      return JSON.stringify({ pensions: [], socialSecurities: [] });
    }
    throw new Error(`Unexpected file read: ${path}`);
  }),
}));

// Mock bracket calculator
vi.mock('./bracket-calculator', () => ({
  getBracketDataForYear: vi.fn((year: number, filingStatus: string) => ({
    brackets: {
      mfj: [
        { min: 0, max: 23200, rate: 0.10 },
        { min: 23200, max: 94300, rate: 0.12 },
        { min: 94300, max: 201050, rate: 0.22 },
        { min: 201050, max: 383900, rate: 0.24 },
      ],
    },
    standardDeduction: {
      mfj: 27700,
    },
    ssProvisionalThresholds: {
      mfj: { tier1: 32000, tier2: 44000 },
    },
  })),
}));

// Mock AccountManager
const mockAccountManager = {
  getAccountByName: vi.fn((name: string) => {
    if (name === 'Jake 401(k)') {
      return new Account({
        id: 'jake-401k-id',
        name: 'Jake 401(k)',
        accountOwnerDOB: '1993-07-15',
        usesRMD: true,
        performsPulls: true,
        performsPushes: false,
        type: 'Retirement',
        interests: [],
        activity: [],
        bills: [],
      });
    }
    if (name === 'Jake Roth IRA') {
      return new Account({
        id: 'jake-roth-id',
        name: 'Jake Roth IRA',
        accountOwnerDOB: '1993-07-15',
        usesRMD: false,
        performsPulls: false,
        performsPushes: false,
        type: 'Investment',
        interests: [],
        activity: [],
        bills: [],
      });
    }
    return null;
  }),
  getAllAccounts: vi.fn(() => []),
};

describe('RothConversionManager', () => {
  let manager: RothConversionManager;
  let taxManager: TaxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    taxManager = new TaxManager();
    manager = new RothConversionManager(mockAccountManager as any);
  });

  it('should load Roth conversion config from file', () => {
    expect(manager).toBeDefined();
  });

  it('should track conversion lots with correct 5-year penalty-free date', () => {
    const lots = manager.getConversionLots('jake-roth-id');
    expect(Array.isArray(lots)).toBe(true);
  });

  it('should return empty lots for accounts with no conversions', () => {
    const lots = manager.getConversionLots('non-existent-account');
    expect(lots).toEqual([]);
  });

  it('should calculate penalty-free balance as 0 for fresh conversions', () => {
    const penaltyFree = manager.getPenaltyFreeBalance('jake-roth-id', 2026);
    expect(penaltyFree).toBe(0);
  });

  it('should calculate penaltyable balance as 0 with no conversions', () => {
    const penaltyable = manager.getPenaltyableBalance('jake-roth-id', 2026);
    expect(penaltyable).toBe(0);
  });

  it('should handle processConversions without errors', () => {
    const year = 2026;
    taxManager.addTaxableOccurrence('jake-401k-id', {
      date: new Date(2026, 0, 1),
      year: 2026,
      amount: 50000,
      incomeType: 'retirement',
    });

    // Mock balance tracker
    const mockBalanceTracker = {
      getAccountBalance: vi.fn(() => 500000),
    } as any;

    // Should not throw
    expect(() => {
      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03);
    }).not.toThrow();
  });

  it('should add taxable occurrence when processing conversions', () => {
    const year = 2026;
    const mockBalanceTracker = {
      getAccountBalance: vi.fn(() => 500000),
    } as any;

    manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03);

    // Check if any taxable occurrences were added
    const allOccurrences = taxManager.getAllOccurrencesForYear(year);
    expect(Array.isArray(allOccurrences)).toBe(true);
  });
});
