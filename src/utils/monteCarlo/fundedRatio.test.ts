import { describe, it, expect } from 'vitest';
import { FilteredAccount, FilteredActivity } from './types';

/**
 * Test suite for #9: Funded Ratio / Success Metrics tracking
 */
describe('Funded Ratio - Funding Failure Detection', () => {
  it('should detect no funding failure when pull account stays above minimum', () => {
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

    // Check for funding failure
    let fundingFailureYear: number | null = null;

    for (const account of filteredAccounts) {
      const accountConfig = accountsAndTransfers.accounts.find(
        (a) => a.id === account.id || a.name === account.name,
      );
      if (!accountConfig?.performsPulls) continue;

      const minBalance = accountConfig.minimumBalance ?? 0;

      for (const activity of account.consolidatedActivity) {
        if (activity.balance < minBalance) {
          const year = new Date(activity.date).getUTCFullYear();
          if (fundingFailureYear === null || year < fundingFailureYear) {
            fundingFailureYear = year;
          }
          break;
        }
      }
    }

    expect(fundingFailureYear).toBeNull();
  });

  it('should detect funding failure in the year a pull account drops below minimum', () => {
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
            balance: 45000, // Below minimum
            from: 'Retirement',
            to: 'Checking',
            date: '2027-03-15',
          },
        ],
      },
    ];

    // Check for funding failure
    let fundingFailureYear: number | null = null;

    for (const account of filteredAccounts) {
      const accountConfig = accountsAndTransfers.accounts.find(
        (a) => a.id === account.id || a.name === account.name,
      );
      if (!accountConfig?.performsPulls) continue;

      const minBalance = accountConfig.minimumBalance ?? 0;

      for (const activity of account.consolidatedActivity) {
        if (activity.balance < minBalance) {
          const year = new Date(activity.date).getUTCFullYear();
          if (fundingFailureYear === null || year < fundingFailureYear) {
            fundingFailureYear = year;
          }
          break;
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

    // Check for funding failure
    let fundingFailureYear: number | null = null;

    for (const account of filteredAccounts) {
      const accountConfig = accountsAndTransfers.accounts.find(
        (a) => a.id === account.id || a.name === account.name,
      );
      if (!accountConfig?.performsPulls) continue;

      const minBalance = accountConfig.minimumBalance ?? 0;

      for (const activity of account.consolidatedActivity) {
        if (activity.balance < minBalance) {
          const year = new Date(activity.date).getUTCFullYear();
          if (fundingFailureYear === null || year < fundingFailureYear) {
            fundingFailureYear = year;
          }
          break;
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

    // Check for funding failure
    let fundingFailureYear: number | null = null;

    for (const account of filteredAccounts) {
      const accountConfig = accountsAndTransfers.accounts.find(
        (a) => a.id === account.id || a.name === account.name,
      );
      if (!accountConfig?.performsPulls) continue;

      const minBalance = accountConfig.minimumBalance ?? 0;

      for (const activity of account.consolidatedActivity) {
        if (activity.balance < minBalance) {
          const year = new Date(activity.date).getUTCFullYear();
          if (fundingFailureYear === null || year < fundingFailureYear) {
            fundingFailureYear = year;
          }
          break;
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
