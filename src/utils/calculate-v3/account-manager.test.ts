// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() at top, import mocked modules after
// - Async: sync methods only in this module
// - Structure: describe/it with beforeEach and vi.clearAllMocks()

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountManager } from './account-manager';
import { Account } from '../../data/account/account';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../io/retirement', () => ({
  loadPensionsAndSocialSecurity: vi.fn().mockReturnValue({
    socialSecurities: [],
    pensions: [],
  }),
}));

import { loadPensionsAndSocialSecurity } from '../io/retirement';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccountData(overrides: Record<string, any> = {}): any {
  return {
    id: 'account-1',
    name: 'Checking',
    type: 'checking',
    balance: 0,
    interests: [],
    activity: [],
    bills: [],
    consolidatedActivity: [],
    hidden: false,
    pullPriority: 1,
    interestPayAccount: null,
    ...overrides,
  };
}

function makeAccount(id: string, name: string = 'Account', overrides: Record<string, any> = {}): Account {
  return new Account(makeAccountData({ id, name, ...overrides }));
}

function makeOptions(simulation = 'Default'): any {
  return {
    startDate: null,
    endDate: new Date(Date.UTC(2025, 11, 31)),
    simulation,
    monteCarlo: false,
    simulationNumber: 0,
    totalSimulations: 1,
    forceRecalculation: false,
    enableLogging: false,
    config: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (loadPensionsAndSocialSecurity as ReturnType<typeof vi.fn>).mockReturnValue({
      socialSecurities: [],
      pensions: [],
    });
  });

  // -------------------------------------------------------------------------
  // construction
  // -------------------------------------------------------------------------
  describe('construction', () => {
    it('creates an AccountManager instance', () => {
      const accounts = [makeAccount('account-1')];
      const manager = new AccountManager(accounts, makeOptions());
      expect(manager).toBeDefined();
    });

    it('deep-clones accounts so external mutations do not affect lookup maps', () => {
      const account = makeAccount('account-1', 'Checking');
      const manager = new AccountManager([account], makeOptions());

      // Mutate external account name
      account.name = 'Mutated';

      // Internal lookup should use original name
      const found = manager.getAccountByName('Checking');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Checking');
    });

    it('loads social securities and pensions from options.simulation', () => {
      const mockPension = { id: 'pension-1', name: 'Pension A' } as any;
      const mockSS = { id: 'ss-1', name: 'Social Security A' } as any;
      (loadPensionsAndSocialSecurity as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        socialSecurities: [mockSS],
        pensions: [mockPension],
      });

      const manager = new AccountManager([], makeOptions('MySimulation'));

      expect(loadPensionsAndSocialSecurity).toHaveBeenCalledWith('MySimulation');
      expect(manager.getPensions()).toHaveLength(1);
      expect(manager.getSocialSecurities()).toHaveLength(1);
    });

    it('populates interestPayAccountNames with non-null interestPayAccount values', () => {
      const account1 = makeAccount('account-1', 'Checking', { interestPayAccount: 'Savings' });
      const account2 = makeAccount('account-2', 'Savings', { interestPayAccount: null });

      const manager = new AccountManager([account1, account2], makeOptions());
      const names = manager.getInterestPayAccountNames();

      expect(names.has('Savings')).toBe(true);
      expect(names.has(null as any)).toBe(false);
      expect(names.size).toBe(1);
    });

    it('excludes accounts with pullPriority === -1 from pullable accounts', () => {
      const pullable = makeAccount('account-1', 'Checking', { pullPriority: 1 });
      const nonPullable = makeAccount('account-2', 'Savings', { pullPriority: -1 });

      const manager = new AccountManager([pullable, nonPullable], makeOptions());
      const pullableAccounts = manager.getPullableAccounts();

      expect(pullableAccounts).toHaveLength(1);
      expect(pullableAccounts[0].name).toBe('Checking');
    });

    it('includes all accounts in pullable list when none have pullPriority -1', () => {
      const accounts = [
        makeAccount('account-1', 'Checking', { pullPriority: 1 }),
        makeAccount('account-2', 'Savings', { pullPriority: 2 }),
      ];

      const manager = new AccountManager(accounts, makeOptions());
      expect(manager.getPullableAccounts()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // getAccountByName
  // -------------------------------------------------------------------------
  describe('getAccountByName', () => {
    it('returns the account when found by name', () => {
      const accounts = [makeAccount('account-1', 'Checking'), makeAccount('account-2', 'Savings')];
      const manager = new AccountManager(accounts, makeOptions());

      const found = manager.getAccountByName('Checking');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Checking');
    });

    it('returns undefined when account name does not exist', () => {
      const accounts = [makeAccount('account-1', 'Checking')];
      const manager = new AccountManager(accounts, makeOptions());

      expect(manager.getAccountByName('NonExistent')).toBeUndefined();
    });

    it('finds the correct account among multiple accounts', () => {
      const accounts = [
        makeAccount('account-1', 'Checking'),
        makeAccount('account-2', 'Savings'),
        makeAccount('account-3', '401k'),
      ];
      const manager = new AccountManager(accounts, makeOptions());

      expect(manager.getAccountByName('Savings')?.name).toBe('Savings');
      expect(manager.getAccountByName('401k')?.name).toBe('401k');
    });

    it('returns undefined for an empty account list', () => {
      const manager = new AccountManager([], makeOptions());
      expect(manager.getAccountByName('Anything')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getAccountById
  // -------------------------------------------------------------------------
  describe('getAccountById', () => {
    it('returns the account when found by id', () => {
      const accounts = [makeAccount('account-1', 'Checking'), makeAccount('account-2', 'Savings')];
      const manager = new AccountManager(accounts, makeOptions());

      const found = manager.getAccountById('account-2');
      expect(found).toBeDefined();
      expect(found?.id).toBe('account-2');
    });

    it('returns undefined when account id does not exist', () => {
      const accounts = [makeAccount('account-1', 'Checking')];
      const manager = new AccountManager(accounts, makeOptions());

      expect(manager.getAccountById('nonexistent-id')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getPullableAccounts
  // -------------------------------------------------------------------------
  describe('getPullableAccounts', () => {
    it('returns an empty array when all accounts have pullPriority -1', () => {
      const accounts = [
        makeAccount('account-1', 'Checking', { pullPriority: -1 }),
        makeAccount('account-2', 'Savings', { pullPriority: -1 }),
      ];
      const manager = new AccountManager(accounts, makeOptions());
      expect(manager.getPullableAccounts()).toHaveLength(0);
    });

    it('returns pullable accounts in the order they appear', () => {
      const accounts = [
        makeAccount('account-1', 'Low', { pullPriority: 2 }),
        makeAccount('account-2', 'High', { pullPriority: 1 }),
        makeAccount('account-3', 'Excluded', { pullPriority: -1 }),
      ];
      const manager = new AccountManager(accounts, makeOptions());
      const pullable = manager.getPullableAccounts();

      expect(pullable).toHaveLength(2);
      expect(pullable[0].name).toBe('Low');
      expect(pullable[1].name).toBe('High');
    });
  });

  // -------------------------------------------------------------------------
  // getSocialSecurities
  // -------------------------------------------------------------------------
  describe('getSocialSecurities', () => {
    it('returns empty array when no social securities loaded', () => {
      const manager = new AccountManager([], makeOptions());
      expect(manager.getSocialSecurities()).toHaveLength(0);
    });

    it('returns loaded social securities', () => {
      const mockSS = { id: 'ss-1' } as any;
      (loadPensionsAndSocialSecurity as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        socialSecurities: [mockSS],
        pensions: [],
      });

      const manager = new AccountManager([], makeOptions());
      expect(manager.getSocialSecurities()).toHaveLength(1);
      expect(manager.getSocialSecurities()[0]).toBe(mockSS);
    });
  });

  // -------------------------------------------------------------------------
  // getPensions
  // -------------------------------------------------------------------------
  describe('getPensions', () => {
    it('returns empty array when no pensions loaded', () => {
      const manager = new AccountManager([], makeOptions());
      expect(manager.getPensions()).toHaveLength(0);
    });

    it('returns loaded pensions', () => {
      const mockPension = { id: 'pension-1' } as any;
      (loadPensionsAndSocialSecurity as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        socialSecurities: [],
        pensions: [mockPension],
      });

      const manager = new AccountManager([], makeOptions());
      expect(manager.getPensions()).toHaveLength(1);
      expect(manager.getPensions()[0]).toBe(mockPension);
    });
  });

  // -------------------------------------------------------------------------
  // getInterestPayAccountNames
  // -------------------------------------------------------------------------
  describe('getInterestPayAccountNames', () => {
    it('returns empty set when no accounts have interestPayAccount', () => {
      const accounts = [makeAccount('account-1'), makeAccount('account-2')];
      const manager = new AccountManager(accounts, makeOptions());
      expect(manager.getInterestPayAccountNames().size).toBe(0);
    });

    it('returns all unique interestPayAccount names', () => {
      const accounts = [
        makeAccount('account-1', 'Checking', { interestPayAccount: 'Savings' }),
        makeAccount('account-2', 'Savings', { interestPayAccount: 'Checking' }),
        makeAccount('account-3', '401k', { interestPayAccount: 'Savings' }), // Duplicate
      ];
      const manager = new AccountManager(accounts, makeOptions());
      const names = manager.getInterestPayAccountNames();

      expect(names.size).toBe(2);
      expect(names.has('Savings')).toBe(true);
      expect(names.has('Checking')).toBe(true);
    });
  });
});
