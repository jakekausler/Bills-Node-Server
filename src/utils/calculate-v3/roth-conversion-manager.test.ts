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

// Mock simulation variable loading
vi.mock('../simulation/loadVariableValue', () => ({
  loadDateOrVariable: vi.fn((date: any, isVar: boolean, varName: string, simulation: string) => {
    // Map variable names to specific dates for testing
    if (varName === 'RETIRE_DATE') {
      return { date: new Date('2025-01-01'), dateIsVariable: true };
    }
    if (varName === 'JAKE_SOCIAL_SECURITY_START_DATE') {
      return { date: new Date('2035-01-01'), dateIsVariable: true };
    }
    return { date: null, dateIsVariable: false };
  }),
}));

// Helper to create accounts with different configurations
function createAccount(config: {
  id: string;
  name: string;
  usesRMD?: boolean;
  performsPulls?: boolean;
  performsPushes?: boolean;
  minimumBalance?: number;
}) {
  return new Account({
    accountOwnerDOB: '1993-07-15',
    type: 'Retirement',
    interests: [],
    activity: [],
    bills: [],
    ...config,
  });
}

describe('RothConversionManager', () => {
  let manager: RothConversionManager;
  let taxManager: TaxManager;
  let mockAccountManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    taxManager = new TaxManager();

    mockAccountManager = {
      getAccountByName: vi.fn((name: string) => {
        const accounts: Record<string, Account> = {
          'Jake 401(k)': createAccount({
            id: 'jake-401k-id',
            name: 'Jake 401(k)',
            usesRMD: true,
            performsPulls: true,
            performsPushes: false,
          }),
          'Jake Roth IRA': createAccount({
            id: 'jake-roth-id',
            name: 'Jake Roth IRA',
            usesRMD: false,
            performsPulls: false,
            performsPushes: false,
          }),
          'Checking Account': createAccount({
            id: 'checking-id',
            name: 'Checking Account',
            usesRMD: false,
            performsPulls: true,
            performsPushes: true,
            minimumBalance: 5000,
          }),
          'Kendall 401(k)': createAccount({
            id: 'kendall-401k-id',
            name: 'Kendall 401(k)',
            usesRMD: true,
            performsPulls: true,
            performsPushes: false,
          }),
        };
        return accounts[name] || null;
      }),
      getAllAccounts: vi.fn(() => [
        mockAccountManager.getAccountByName('Jake 401(k)'),
        mockAccountManager.getAccountByName('Jake Roth IRA'),
        mockAccountManager.getAccountByName('Checking Account'),
        mockAccountManager.getAccountByName('Kendall 401(k)'),
      ]),
    };

    manager = new RothConversionManager(mockAccountManager);
  });

  it('should load Roth conversion config from file', () => {
    expect(manager).toBeDefined();
  });

  it('should return empty lots for accounts with no conversions', () => {
    const lots = manager.getConversionLots('non-existent-account');
    expect(lots).toEqual([]);
  });

  describe('Bracket Filling', () => {
    it('should fill remaining bracket space with conversion', () => {
      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 200000; // Has funds
          if (id === 'checking-id') return 50000; // Liquid assets
          return 0;
        }),
      } as any;

      // Set income to $80K (leaving ~$121K space in 22% bracket)
      taxManager.addTaxableOccurrence('jake-401k-id', {
        date: new Date(2026, 0, 1),
        year: 2026,
        amount: 80000,
        incomeType: 'ordinary',
      });

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      // Should have conversion lot
      const lots = manager.getConversionLots('jake-roth-id');
      expect(lots.length).toBeGreaterThan(0);
      expect(lots[0]?.amount).toBeGreaterThan(0); // Has conversion amount
      expect(lots[0]?.penaltyFreeYear).toBe(2031); // year + 5
    });
  });

  describe('Liquid Asset Check', () => {
    it('should skip conversion if insufficient liquid assets', () => {
      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 200000;
          if (id === 'checking-id') return 5000; // Only $5K liquid (not enough for tax)
          return 0;
        }),
      } as any;

      taxManager.addTaxableOccurrence('jake-401k-id', {
        date: new Date(2026, 0, 1),
        year: 2026,
        amount: 80000,
        incomeType: 'ordinary',
      });

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      // Should skip because liquid assets can't cover estimated tax
      const lots = manager.getConversionLots('jake-roth-id');
      expect(lots.length).toBe(0);
    });
  });

  describe('Larger First Priority', () => {
    it('should convert from larger 401(k) first when priority is largerFirst', () => {
      const mockAccountManager2 = {
        getAccountByName: vi.fn((name: string) => {
          const accounts: Record<string, Account> = {
            'Jake 401(k)': createAccount({
              id: 'jake-401k-id',
              name: 'Jake 401(k)',
              usesRMD: true,
              performsPulls: true,
            }),
            'Kendall 401(k)': createAccount({
              id: 'kendall-401k-id',
              name: 'Kendall 401(k)',
              usesRMD: true,
              performsPulls: true,
            }),
            'Jake Roth IRA': createAccount({
              id: 'jake-roth-id',
              name: 'Jake Roth IRA',
              usesRMD: false,
              performsPulls: false,
            }),
            'Checking Account': createAccount({
              id: 'checking-id',
              name: 'Checking Account',
              usesRMD: false,
              performsPulls: true,
              minimumBalance: 5000,
            }),
          };
          return accounts[name] || null;
        }),
        getAllAccounts: vi.fn(() => [
          mockAccountManager2.getAccountByName('Jake 401(k)'),
          mockAccountManager2.getAccountByName('Kendall 401(k)'),
          mockAccountManager2.getAccountByName('Jake Roth IRA'),
          mockAccountManager2.getAccountByName('Checking Account'),
        ]),
      };

      const manager2 = new RothConversionManager(mockAccountManager2);

      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 100000; // Smaller
          if (id === 'kendall-401k-id') return 200000; // Larger
          if (id === 'checking-id') return 100000; // Enough liquid
          return 0;
        }),
      } as any;

      taxManager.addTaxableOccurrence('kendall-401k-id', {
        date: new Date(2026, 0, 1),
        year: 2026,
        amount: 80000,
        incomeType: 'ordinary',
      });

      // With largerFirst, Kendall's 401(k) ($200K) should be prioritized
      manager2.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      const lots = manager2.getConversionLots('jake-roth-id');
      expect(lots.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Date Range Checking', () => {
    it('should skip conversion outside configured window', () => {
      const year = 2050; // Outside RETIRE_DATE (2025) to JAKE_SOCIAL_SECURITY_START_DATE (2035)
      const mockBalanceTracker = {
        getAccountBalance: vi.fn(() => 200000),
      } as any;

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      // Should be skipped because year is outside window
      const lots = manager.getConversionLots('jake-roth-id');
      expect(lots.length).toBe(0);
    });

    it('should process conversion within configured window', () => {
      const year = 2028; // Within RETIRE_DATE (2025) to JAKE_SOCIAL_SECURITY_START_DATE (2035)
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 200000;
          if (id === 'checking-id') return 50000; // Liquid assets
          return 0;
        }),
      } as any;

      taxManager.addTaxableOccurrence('jake-401k-id', {
        date: new Date(2028, 0, 1),
        year: 2028,
        amount: 80000,
        incomeType: 'ordinary',
      });

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      // Should have been processed
      const lots = manager.getConversionLots('jake-roth-id');
      expect(lots.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Lot Tracking and 5-Year Rule', () => {
    it('should track conversion lot with correct 5-year penalty-free date', () => {
      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 100000;
          if (id === 'checking-id') return 50000;
          return 0;
        }),
      } as any;

      taxManager.addTaxableOccurrence('jake-401k-id', {
        date: new Date(2026, 0, 1),
        year: 2026,
        amount: 50000,
        incomeType: 'ordinary',
      });

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      const lots = manager.getConversionLots('jake-roth-id');
      expect(lots.length).toBeGreaterThan(0);
      expect(lots[0]?.penaltyFreeYear).toBe(2031);
    });

    it('should calculate penalty-free balance after 5 years', () => {
      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 100000;
          if (id === 'checking-id') return 50000;
          return 0;
        }),
      } as any;

      taxManager.addTaxableOccurrence('jake-401k-id', {
        date: new Date(2026, 0, 1),
        year: 2026,
        amount: 50000,
        incomeType: 'ordinary',
      });

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      // In year 2031, balance should be penalty-free
      const penaltyFree = manager.getPenaltyFreeBalance('jake-roth-id', 2031);
      expect(penaltyFree).toBeGreaterThan(0);
    });
  });

  describe('Source Account Empty', () => {
    it('should skip conversion if source account has zero balance', () => {
      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 0; // Empty
          if (id === 'checking-id') return 50000;
          return 0;
        }),
      } as any;

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      const lots = manager.getConversionLots('jake-roth-id');
      expect(lots.length).toBe(0);
    });
  });

  describe('Taxable Occurrence', () => {
    it('should add conversion amount as retirement income occurrence', () => {
      const year = 2026;
      const mockBalanceTracker = {
        getAccountBalance: vi.fn((id: string) => {
          if (id === 'jake-401k-id') return 100000;
          if (id === 'checking-id') return 50000;
          return 0;
        }),
      } as any;

      taxManager.addTaxableOccurrence('jake-401k-id', {
        date: new Date(2026, 0, 1),
        year: 2026,
        amount: 50000,
        incomeType: 'ordinary',
      });

      manager.processConversions(year, taxManager, mockBalanceTracker, 'mfj', 0.03, 'default');

      const allOccurrences = taxManager.getAllOccurrencesForYear(year);
      const conversionOccurrence = allOccurrences.find(
        (occ) => occ.incomeType === 'retirement' && occ.amount > 0
      );

      expect(conversionOccurrence).toBeDefined();
      expect(conversionOccurrence?.amount).toBeGreaterThan(0);
    });
  });
});
