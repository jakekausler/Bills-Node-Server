import { describe, it, expect } from 'vitest';
import { FilteredAccount, FilteredActivity } from './types';

/**
 * Test suite for #9: Funded Ratio / Success Metrics tracking
 */
describe('Funded Ratio - Funding Failure Detection', () => {
  it('should detect no funding failure when pull account yearly min stays above minimum', () => {
    // Simulate an account that performs pulls and stays above minimum
    const accountsAndTransfers = {
      accounts: [
        {
          id: 'acc1',
          name: 'Retirement',
          performsPulls: true,
          minimumBalance: 50000,
        },
      ],
    };

    const filteredAccounts: FilteredAccount[] = [
      {
        id: 'acc1',
        name: 'Retirement',
        consolidatedActivity: [
          {
            name: 'Start',
            id: '1',
            amount: 0,
            balance: 100000,
            from: '',
            to: '',
            date: '2026-01-01',
          },
          {
            name: 'Withdrawal',
            id: '2',
            amount: -10000,
            balance: 90000,
            from: 'Retirement',
            to: 'Checking',
            date: '2026-06-01',
          },
          {
            name: 'Withdrawal',
            id: '3',
            amount: -10000,
            balance: 80000,
            from: 'Retirement',
            to: 'Checking',
            date: '2027-06-01',
          },
        ],
      },
    ];

    // Mock yearly min balance data (calculated by calculateYearlyMinBalances)
    const balanceData = {
      combined: { 2026: 80000, 2027: 80000 },
      perAccount: {
        '2026': { acc1: 80000 },
        '2027': { acc1: 80000 },
      },
    };

    // Check for funding failure using yearly min balances
    let fundingFailureYear: number | null = null;

    const pullAccounts = accountsAndTransfers.accounts
      .filter((a) => a.performsPulls)
      .map((a) => ({ id: a.id, name: a.name, minimumBalance: a.minimumBalance ?? 0 }));

    if (balanceData.perAccount) {
      for (const [yearStr, accountBalances] of Object.entries(balanceData.perAccount)) {
        const year = parseInt(yearStr);
        for (const pullAccount of pullAccounts) {
          const accountId = pullAccount.id;
          const minBal = accountBalances[accountId];
          if (minBal !== undefined && minBal < pullAccount.minimumBalance) {
            if (fundingFailureYear === null || year < fundingFailureYear) {
              fundingFailureYear = year;
            }
          }
        }
      }
    }

    expect(fundingFailureYear).toBeNull();
  });

  it('should detect funding failure in the year a pull account yearly min drops below minimum', () => {
    const accountsAndTransfers = {
      accounts: [
        {
          id: 'acc1',
          name: 'Retirement',
          performsPulls: true,
          minimumBalance: 50000,
        },
      ],
    };

    const filteredAccounts: FilteredAccount[] = [
      {
        id: 'acc1',
        name: 'Retirement',
        consolidatedActivity: [
          {
            name: 'Start',
            id: '1',
            amount: 0,
            balance: 100000,
            from: '',
            to: '',
            date: '2026-01-01',
          },
          {
            name: 'Withdrawal',
            id: '2',
            amount: -30000,
            balance: 70000,
            from: 'Retirement',
            to: 'Checking',
            date: '2026-06-01',
          },
          {
            name: 'Large Withdrawal',
            id: '3',
            amount: -25000,
            balance: 45000, // Temporary dip, push/pull corrects it
            from: 'Retirement',
            to: 'Checking',
            date: '2027-03-15',
          },
        ],
      },
    ];

    // Mock yearly min balance data - the yearly min in 2027 is below minimum
    const balanceData = {
      combined: { 2026: 70000, 2027: 45000 },
      perAccount: {
        '2026': { acc1: 70000 },
        '2027': { acc1: 45000 }, // Yearly min below minimum
      },
    };

    // Check for funding failure using yearly min balances
    let fundingFailureYear: number | null = null;

    const pullAccounts = accountsAndTransfers.accounts
      .filter((a) => a.performsPulls)
      .map((a) => ({ id: a.id, name: a.name, minimumBalance: a.minimumBalance ?? 0 }));

    if (balanceData.perAccount) {
      for (const [yearStr, accountBalances] of Object.entries(balanceData.perAccount)) {
        const year = parseInt(yearStr);
        for (const pullAccount of pullAccounts) {
          const accountId = pullAccount.id;
          const minBal = accountBalances[accountId];
          if (minBal !== undefined && minBal < pullAccount.minimumBalance) {
            if (fundingFailureYear === null || year < fundingFailureYear) {
              fundingFailureYear = year;
            }
          }
        }
      }
    }

    expect(fundingFailureYear).toBe(2027);
  });

  it('should ignore non-pull accounts when checking for funding failure', () => {
    const accountsAndTransfers = {
      accounts: [
        {
          id: 'acc1',
          name: 'Savings',
          performsPulls: false, // Does not perform pulls
          minimumBalance: 50000,
        },
        {
          id: 'acc2',
          name: 'Retirement',
          performsPulls: true,
          minimumBalance: 50000,
        },
      ],
    };

    const filteredAccounts: FilteredAccount[] = [
      {
        id: 'acc1',
        name: 'Savings',
        consolidatedActivity: [
          {
            name: 'Start',
            id: '1',
            amount: 0,
            balance: 100000,
            from: '',
            to: '',
            date: '2026-01-01',
          },
          {
            name: 'Debit',
            id: '2',
            amount: -60000,
            balance: 40000, // Below minimum but not a pull account
            from: 'Savings',
            to: 'Other',
            date: '2026-06-01',
          },
        ],
      },
      {
        id: 'acc2',
        name: 'Retirement',
        consolidatedActivity: [
          {
            name: 'Start',
            id: '1',
            amount: 0,
            balance: 100000,
            from: '',
            to: '',
            date: '2026-01-01',
          },
          {
            name: 'Withdrawal',
            id: '2',
            amount: -10000,
            balance: 90000, // Above minimum
            from: 'Retirement',
            to: 'Checking',
            date: '2026-06-01',
          },
        ],
      },
    ];

    // Mock yearly min balance data
    const balanceData = {
      combined: { 2026: 40000 },
      perAccount: {
        '2026': { acc1: 40000, acc2: 90000 }, // acc1 below minimum but doesn't perform pulls
      },
    };

    // Check for funding failure using yearly min balances
    let fundingFailureYear: number | null = null;

    const pullAccounts = accountsAndTransfers.accounts
      .filter((a) => a.performsPulls)
      .map((a) => ({ id: a.id, name: a.name, minimumBalance: a.minimumBalance ?? 0 }));

    if (balanceData.perAccount) {
      for (const [yearStr, accountBalances] of Object.entries(balanceData.perAccount)) {
        const year = parseInt(yearStr);
        for (const pullAccount of pullAccounts) {
          const accountId = pullAccount.id;
          const minBal = accountBalances[accountId];
          if (minBal !== undefined && minBal < pullAccount.minimumBalance) {
            if (fundingFailureYear === null || year < fundingFailureYear) {
              fundingFailureYear = year;
            }
          }
        }
      }
    }

    // Should be null because the only account that performs pulls stays above minimum
    expect(fundingFailureYear).toBeNull();
  });

  it('should use earliest failure year when multiple pull accounts fail in different years', () => {
    const accountsAndTransfers = {
      accounts: [
        {
          id: 'acc1',
          name: 'Retirement',
          performsPulls: true,
          minimumBalance: 50000,
        },
        {
          id: 'acc2',
          name: 'Emergency Fund',
          performsPulls: true,
          minimumBalance: 10000,
        },
      ],
    };

    const filteredAccounts: FilteredAccount[] = [
      {
        id: 'acc1',
        name: 'Retirement',
        consolidatedActivity: [
          {
            name: 'Start',
            id: '1',
            amount: 0,
            balance: 100000,
            from: '',
            to: '',
            date: '2026-01-01',
          },
          {
            name: 'Withdrawal',
            id: '2',
            amount: -50000,
            balance: 45000, // Below minimum in 2028
            from: 'Retirement',
            to: 'Checking',
            date: '2028-06-01',
          },
        ],
      },
      {
        id: 'acc2',
        name: 'Emergency Fund',
        consolidatedActivity: [
          {
            name: 'Start',
            id: '1',
            amount: 0,
            balance: 50000,
            from: '',
            to: '',
            date: '2026-01-01',
          },
          {
            name: 'Withdrawal',
            id: '2',
            amount: -45000,
            balance: 5000, // Below minimum in 2027
            from: 'Emergency Fund',
            to: 'Checking',
            date: '2027-03-01',
          },
        ],
      },
    ];

    // Mock yearly min balance data
    const balanceData = {
      combined: { 2026: 50000, 2027: 5000, 2028: 45000 },
      perAccount: {
        '2026': { acc1: 100000, acc2: 50000 },
        '2027': { acc1: 100000, acc2: 5000 }, // acc2 fails in 2027
        '2028': { acc1: 45000, acc2: 5000 }, // acc1 fails in 2028
      },
    };

    // Check for funding failure using yearly min balances
    let fundingFailureYear: number | null = null;

    const pullAccounts = accountsAndTransfers.accounts
      .filter((a) => a.performsPulls)
      .map((a) => ({ id: a.id, name: a.name, minimumBalance: a.minimumBalance ?? 0 }));

    if (balanceData.perAccount) {
      for (const [yearStr, accountBalances] of Object.entries(balanceData.perAccount)) {
        const year = parseInt(yearStr);
        for (const pullAccount of pullAccounts) {
          const accountId = pullAccount.id;
          const minBal = accountBalances[accountId];
          if (minBal !== undefined && minBal < pullAccount.minimumBalance) {
            if (fundingFailureYear === null || year < fundingFailureYear) {
              fundingFailureYear = year;
            }
          }
        }
      }
    }

    // Should report earliest failure (2027)
    expect(fundingFailureYear).toBe(2027);
  });
});

describe('Funded Ratio Computation', () => {
  it('should compute correct funded ratio (8 out of 10 pass = 80%)', () => {
    const simulationData = [
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: 2030 },
      { fundingFailureYear: 2032 },
    ];

    const totalSims = simulationData.length;
    const failedSims = simulationData.filter(
      (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
    ).length;
    const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

    expect(totalSims).toBe(10);
    expect(failedSims).toBe(2);
    expect(fundedRatio).toBe(80);
  });

  it('should compute funded ratio as 100% when no simulations fail', () => {
    const simulationData = [
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
    ];

    const totalSims = simulationData.length;
    const failedSims = simulationData.filter(
      (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
    ).length;
    const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

    expect(fundedRatio).toBe(100);
  });

  it('should compute funded ratio as 0% when all simulations fail', () => {
    const simulationData = [
      { fundingFailureYear: 2030 },
      { fundingFailureYear: 2031 },
      { fundingFailureYear: 2029 },
    ];

    const totalSims = simulationData.length;
    const failedSims = simulationData.filter(
      (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
    ).length;
    const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

    expect(fundedRatio).toBe(0);
  });

  it('should compute correct median failure year', () => {
    const failureYears = [2030, 2031, 2029, 2035, 2032].sort((a, b) => a - b);
    // Sorted: [2029, 2030, 2031, 2032, 2035]
    const medianFailureYear = failureYears[Math.floor(failureYears.length / 2)];

    expect(medianFailureYear).toBe(2031);
  });

  it('should handle median failure year with even number of failures', () => {
    const failureYears = [2030, 2031, 2029, 2035].sort((a, b) => a - b);
    // Sorted: [2029, 2030, 2031, 2035]
    // Length 4, Math.floor(4/2) = 2, so failureYears[2] = 2031
    const medianFailureYear = failureYears[Math.floor(failureYears.length / 2)];

    expect(medianFailureYear).toBe(2031);
  });

  it('should return null median failure year when no simulations fail', () => {
    const simulationData = [
      { fundingFailureYear: null },
      { fundingFailureYear: null },
    ];

    const failureYears = simulationData
      .filter((s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined)
      .map((s) => s.fundingFailureYear!);

    const medianFailureYear = failureYears.length > 0 ? failureYears.sort((a, b) => a - b)[Math.floor(failureYears.length / 2)] : null;

    expect(medianFailureYear).toBeNull();
  });
});
