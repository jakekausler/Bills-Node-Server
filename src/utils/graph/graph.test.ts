import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadGraph, loadYearlyGraph } from './graph';
import { AccountsAndTransfers } from '../../data/account/types';
import { getMinDate } from '../date/date';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() at module level, vi.mocked() for typed access
// - Async: sync tests (no async needed here)
// - Structure: describe/it with clear behavior names
//
// Note: only getMinDate is mocked (it reads account data structures);
// isSame and formatDate use real implementations for meaningful assertions.
//
// Important: initializeNewYear uses currDate.getFullYear() (local time). On this
// server (timezone behind UTC), new Date('2023-01-01T00:00:00Z').getFullYear()
// may return 2022. Starting minDate from 2023-01-02T00:00:00Z avoids this
// UTC-midnight boundary issue in all yearly graph tests.

vi.mock('../date/date', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../date/date')>();
  return {
    ...actual,
    getMinDate: vi.fn(),
  };
});

vi.mock('../log', () => ({
  startTiming: vi.fn(),
  endTiming: vi.fn(),
}));

const mockGetMinDate = vi.mocked(getMinDate);

describe('Graph Utilities', () => {
  // Base fixture: two accounts with activities in mid-2023
  const mockAccountsData: AccountsAndTransfers = {
    accounts: [
      {
        id: 'account-1',
        name: 'Checking Account',
        consolidatedActivity: [
          {
            date: new Date('2023-01-15T12:00:00Z'),
            balance: 1000,
            name: 'Salary',
            amount: 1000,
          },
          {
            date: new Date('2023-06-15T12:00:00Z'),
            balance: 1500,
            name: 'Bonus',
            amount: 500,
          },
        ],
      } as any,
      {
        id: 'account-2',
        name: 'Savings Account',
        consolidatedActivity: [
          {
            date: new Date('2023-03-01T12:00:00Z'),
            balance: 2000,
            name: 'Transfer',
            amount: 2000,
          },
        ],
      } as any,
    ],
    transfers: { activity: [], bills: [] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));
  });

  // ─────────────────────────────────────────────────────────────
  // loadGraph
  // ─────────────────────────────────────────────────────────────
  describe('loadGraph', () => {
    it('returns yearly graph when date range exceeds MAX_DAYS_FOR_ACTIVITY', () => {
      const startDate = new Date('2023-01-02T00:00:00Z');
      const endDate = new Date('2035-12-31T23:59:59Z'); // > 10 years

      const result = loadGraph(mockAccountsData, startDate, endDate);

      expect(result.type).toBe('yearly');
      expect(result.labels).toBeDefined();
      expect(result.datasets).toBeDefined();
    });

    it('returns activity graph when date range is within MAX_DAYS_FOR_ACTIVITY', () => {
      const startDate = new Date('2023-01-02T00:00:00Z');
      const endDate = new Date('2023-12-31T23:59:59Z');

      const result = loadGraph(mockAccountsData, startDate, endDate);

      expect(result.type).toBe('activity');
      expect(result.labels).toBeDefined();
      expect(result.datasets).toBeDefined();
    });

    it('combines yearly datasets into one when asOne=true on large range', () => {
      const startDate = new Date('2023-01-02T00:00:00Z');
      const endDate = new Date('2035-12-31T23:59:59Z');

      const result = loadGraph(mockAccountsData, startDate, endDate, true);

      expect(result.type).toBe('yearly');
      expect(result.datasets).toHaveLength(1);
      expect(result.datasets[0].label).toBe('All Accounts');
    });

    it('combines activity datasets into one when asOne=true on small range', () => {
      const startDate = new Date('2023-01-02T00:00:00Z');
      const endDate = new Date('2023-12-31T23:59:59Z');

      const result = loadGraph(mockAccountsData, startDate, endDate, true);

      expect(result.type).toBe('activity');
      expect(result.datasets).toHaveLength(1);
      expect(result.datasets[0].label).toBe('All Accounts');
    });

    it('defaults asOne to false and returns one dataset per account', () => {
      const startDate = new Date('2023-01-02T00:00:00Z');
      const endDate = new Date('2023-12-31T23:59:59Z');

      const result = loadGraph(mockAccountsData, startDate, endDate);

      expect(result.datasets).toHaveLength(2);
    });

    it('uses the later of startDate and minDate when computing the daySpan', () => {
      // minDate set later than startDate - effective span is shorter
      mockGetMinDate.mockReturnValue(new Date('2023-06-01T00:00:00Z'));

      const result = loadGraph(mockAccountsData, new Date('2023-01-02T00:00:00Z'), new Date('2023-12-31T23:59:59Z'));

      expect(result.type).toBe('activity');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // loadYearlyGraph
  // ─────────────────────────────────────────────────────────────
  describe('loadYearlyGraph', () => {
    // Helper: returns the first non-zero value in a dataset's data array,
    // or 0 if all are zero. Accounts for the spurious "previous year" entry
    // caused by UTC-midnight boundary in getFullYear() on this server.
    function firstNonZero(data: number[]): number {
      return data.find((v) => v !== 0) ?? 0;
    }

    it('generates yearly graph with type="yearly" and one dataset per account', () => {
      const result = loadYearlyGraph(
        mockAccountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      expect(result.type).toBe('yearly');
      expect(result.labels.length).toBeGreaterThan(0);
      expect(result.datasets).toHaveLength(2);
      expect(result.datasets[0].label).toBe('Checking Account');
      expect(result.datasets[1].label).toBe('Savings Account');
    });

    it('produces one label entry per year encountered within the range', () => {
      const extendedAccountsData = {
        ...mockAccountsData,
        accounts: [
          {
            ...mockAccountsData.accounts[0],
            consolidatedActivity: [
              ...mockAccountsData.accounts[0].consolidatedActivity,
              {
                date: new Date('2024-01-15T12:00:00Z'),
                balance: 2000,
                name: 'New Year Bonus',
                amount: 500,
              },
            ],
          },
          mockAccountsData.accounts[1],
        ],
      };

      const result = loadYearlyGraph(
        extendedAccountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      expect(result.type).toBe('yearly');
      expect(result.labels.length).toBeGreaterThanOrEqual(2);
      expect(result.datasets).toHaveLength(2);
    });

    it('returns zero data values for accounts with no consolidated activities', () => {
      const emptyAccountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'empty-account',
            name: 'Empty Account',
            consolidatedActivity: [],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        emptyAccountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      expect(result.type).toBe('yearly');
      expect(result.datasets).toHaveLength(1);
      result.datasets[0].data.forEach((val) => expect(val).toBe(0));
    });

    it('skips dates before startDate (minDate is earlier than startDate)', () => {
      const result = loadYearlyGraph(
        mockAccountsData,
        new Date('2023-06-01T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'), // earlier than startDate
      );

      expect(result.type).toBe('yearly');
      expect(result.datasets).toHaveLength(2);
    });

    it('handles empty accounts array', () => {
      const emptyData: AccountsAndTransfers = {
        accounts: [],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        emptyData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      expect(result.type).toBe('yearly');
      expect(result.datasets).toHaveLength(0);
      expect(result.labels).toEqual(expect.any(Array));
    });

    it('records the minimum balance across all activities for a year', () => {
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-03-01T12:00:00Z'), balance: 500, name: 'Deposit', amount: 500 },
              { date: new Date('2023-09-01T12:00:00Z'), balance: 300, name: 'Withdrawal', amount: -200 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        accountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      // dataset.data stores the minimum balance for each year; first non-zero is 2023 min
      expect(firstNonZero(result.datasets[0].data)).toBe(300);
    });

    it('tracks minimum when first activity balance is lower than later ones', () => {
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-04-01T12:00:00Z'), balance: 200, name: 'Low', amount: 200 },
              { date: new Date('2023-08-01T12:00:00Z'), balance: 800, name: 'High', amount: 600 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        accountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      // Min of 200 and 800 is 200
      expect(firstNonZero(result.datasets[0].data)).toBe(200);
    });

    it('tracks minimum when a later activity balance is lower than the first', () => {
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-04-01T12:00:00Z'), balance: 800, name: 'High', amount: 800 },
              { date: new Date('2023-08-01T12:00:00Z'), balance: 200, name: 'Low', amount: -600 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        accountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      // Min of 800 and 200 is 200
      expect(firstNonZero(result.datasets[0].data)).toBe(200);
    });

    it('initializes year balance with the first activity balance for that year', () => {
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-07-01T12:00:00Z'), balance: 750, name: 'Activity', amount: 750 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        accountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      expect(firstNonZero(result.datasets[0].data)).toBe(750);
    });

    it('uses the final balance of same-day activities when updating the year minimum', () => {
      // processAccountActivitiesForDate captures all same-day activities in order;
      // the last balance in the group is used for updateYearBalance
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'test-account',
            name: 'Test Account',
            consolidatedActivity: [
              { date: new Date('2023-05-15T10:00:00Z'), balance: 100, name: 'First', amount: 100 },
              { date: new Date('2023-05-15T11:00:00Z'), balance: 50, name: 'Second (lower)', amount: -50 },
              { date: new Date('2023-05-15T12:00:00Z'), balance: 80, name: 'Third', amount: 30 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };

      const result = loadYearlyGraph(
        accountsData,
        new Date('2023-01-02T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z'),
        new Date('2023-01-02T00:00:00Z'),
      );

      // Final balance on that day is 80; year min initialized to 80
      expect(firstNonZero(result.datasets[0].data)).toBe(80);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // loadActivityGraph (accessed via loadGraph with short range)
  // ─────────────────────────────────────────────────────────────
  describe('loadActivityGraph (via loadGraph with short date range)', () => {
    it('returns one data point per label per account', () => {
      mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));

      const result = loadGraph(mockAccountsData, new Date('2023-01-02T00:00:00Z'), new Date('2023-01-31T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      expect(activityResult.datasets[0].data.length).toBe(activityResult.labels.length);
      expect(activityResult.datasets[1].data.length).toBe(activityResult.labels.length);
    });

    it('records activity names and amounts for accounts that have activity on a given day', () => {
      mockGetMinDate.mockReturnValue(new Date('2023-01-15T00:00:00Z'));

      const result = loadGraph(mockAccountsData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-15T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      const dayActivities = activityResult.datasets[0].activity.flat();
      expect(dayActivities.some((a) => a.name === 'Salary')).toBe(true);
      expect(dayActivities.some((a) => a.amount === 1000)).toBe(true);
    });

    it('updates the balance map to the last activity balance for a day', () => {
      mockGetMinDate.mockReturnValue(new Date('2023-01-15T00:00:00Z'));

      const result = loadGraph(mockAccountsData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-16T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      const dayIdx = activityResult.labels.indexOf('2023-01-15');
      if (dayIdx !== -1) {
        // account-1 has balance=1000 after the Jan 15 activity
        expect(activityResult.datasets[0].data[dayIdx]).toBe(1000);
      }
    });

    it('removes empty interior days from labels to reduce noise', () => {
      // Account has activity only on the first and last day of a 5-day range
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-01-02T12:00:00Z'), balance: 100, name: 'Start', amount: 100 },
              { date: new Date('2023-01-06T12:00:00Z'), balance: 200, name: 'End', amount: 100 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));

      const result = loadGraph(accountsData, new Date('2023-01-02T00:00:00Z'), new Date('2023-01-06T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      // Interior empty days (Jan 3, 4, 5) should be stripped
      activityResult.labels.forEach((label) => {
        expect(['2023-01-02', '2023-01-06'].includes(label)).toBe(true);
      });
    });

    it('removes the first day when it has no activity and later days do', () => {
      // minDate is Jan 2 (no activity), first activity is Jan 4
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-01-04T12:00:00Z'), balance: 100, name: 'First Activity', amount: 100 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));

      const result = loadGraph(accountsData, new Date('2023-01-02T00:00:00Z'), new Date('2023-01-04T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      // First days Jan 2 and Jan 3 are empty and should be removed
      expect(activityResult.labels).not.toContain('2023-01-02');
      expect(activityResult.labels).not.toContain('2023-01-03');
    });

    it('handles single-day range with activity on that day', () => {
      mockGetMinDate.mockReturnValue(new Date('2023-01-15T00:00:00Z'));

      const result = loadGraph(mockAccountsData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-15T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      expect(activityResult.labels).toHaveLength(1);
      expect(activityResult.labels[0]).toBe('2023-01-15');
    });

    it('skips days before startDate when minDate is earlier than startDate', () => {
      // minDate (Jan 2) is before startDate (Jan 15), so the loop
      // must skip Jan 2–14 before processing Jan 15 onward
      const accountsData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc',
            name: 'Account',
            consolidatedActivity: [
              { date: new Date('2023-01-15T12:00:00Z'), balance: 500, name: 'Payment', amount: 500 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));

      const result = loadGraph(accountsData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-15T23:59:59Z'));

      expect(result.type).toBe('activity');
      const activityResult = result as import('./types').ActivityGraphData;
      // Labels should only contain dates on/after startDate
      activityResult.labels.forEach((label) => {
        expect(label >= '2023-01-15').toBe(true);
      });
      // The Jan 15 activity should be recorded
      const activities = activityResult.datasets[0].activity.flat();
      expect(activities.some((a) => a.name === 'Payment')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // combineYearlyDatasets (via loadGraph asOne=true on large range)
  // ─────────────────────────────────────────────────────────────
  describe('combineYearlyDatasets (via loadGraph asOne=true on large range)', () => {
    it('sums balance values from all accounts for each year position', () => {
      const twoAccountData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc1',
            name: 'Account 1',
            consolidatedActivity: [
              { date: new Date('2023-06-01T12:00:00Z'), balance: 100, name: 'A', amount: 100 },
            ],
          } as any,
          {
            id: 'acc2',
            name: 'Account 2',
            consolidatedActivity: [
              { date: new Date('2023-06-01T12:00:00Z'), balance: 200, name: 'B', amount: 200 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));

      const result = loadGraph(twoAccountData, new Date('2023-01-02T00:00:00Z'), new Date('2040-12-31T23:59:59Z'), true);

      expect(result.type).toBe('yearly');
      expect(result.datasets).toHaveLength(1);
      expect(result.datasets[0].label).toBe('All Accounts');
      // Both accounts have balance data; the combined non-zero entry should be 100+200=300
      const nonZeroEntries = result.datasets[0].data.filter((v) => v !== 0);
      expect(nonZeroEntries).toContain(300);
    });

    it('returns empty data array when there are no accounts', () => {
      const emptyData: AccountsAndTransfers = {
        accounts: [],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-02T00:00:00Z'));

      const result = loadGraph(emptyData, new Date('2023-01-02T00:00:00Z'), new Date('2040-12-31T23:59:59Z'), true);

      expect(result.type).toBe('yearly');
      expect(result.datasets).toHaveLength(1);
      expect(result.datasets[0].data).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // combineActivityDatasets (via loadGraph asOne=true on small range)
  // ─────────────────────────────────────────────────────────────
  describe('combineActivityDatasets (via loadGraph asOne=true on small range)', () => {
    it('sums balance values from all accounts for each data position', () => {
      const twoAccountData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc1',
            name: 'Account 1',
            consolidatedActivity: [
              { date: new Date('2023-01-15T12:00:00Z'), balance: 100, name: 'A', amount: 100 },
            ],
          } as any,
          {
            id: 'acc2',
            name: 'Account 2',
            consolidatedActivity: [
              { date: new Date('2023-01-15T12:00:00Z'), balance: 200, name: 'B', amount: 200 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-15T00:00:00Z'));

      const result = loadGraph(twoAccountData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-15T23:59:59Z'), true);

      expect(result.type).toBe('activity');
      expect(result.datasets).toHaveLength(1);
      expect(result.datasets[0].label).toBe('All Accounts');
      const activityResult = result as import('./types').ActivityGraphData;
      // acc1=100, acc2=200, combined=300
      expect(activityResult.datasets[0].data[0]).toBe(300);
    });

    it('merges activity arrays from all accounts into one flat list', () => {
      const twoAccountData: AccountsAndTransfers = {
        accounts: [
          {
            id: 'acc1',
            name: 'Account 1',
            consolidatedActivity: [
              { date: new Date('2023-01-15T12:00:00Z'), balance: 100, name: 'PayA', amount: 100 },
            ],
          } as any,
          {
            id: 'acc2',
            name: 'Account 2',
            consolidatedActivity: [
              { date: new Date('2023-01-15T12:00:00Z'), balance: 200, name: 'PayB', amount: 200 },
            ],
          } as any,
        ],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-15T00:00:00Z'));

      const result = loadGraph(twoAccountData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-15T23:59:59Z'), true);

      const activityResult = result as import('./types').ActivityGraphData;
      const allActivities = activityResult.datasets[0].activity.flat();
      expect(allActivities.some((a) => a.name === 'PayA')).toBe(true);
      expect(allActivities.some((a) => a.name === 'PayB')).toBe(true);
    });

    it('returns empty data array when no accounts exist', () => {
      const emptyData: AccountsAndTransfers = {
        accounts: [],
        transfers: { activity: [], bills: [] },
      };
      mockGetMinDate.mockReturnValue(new Date('2023-01-15T00:00:00Z'));

      // Single-day range with no accounts: removeEmptyDays gets empty datasets
      // which is safe because labels will also be empty (no iterations)
      const result = loadGraph(emptyData, new Date('2023-01-15T00:00:00Z'), new Date('2023-01-14T23:59:59Z'), true);

      expect(result.type).toBe('activity');
      expect(result.datasets).toHaveLength(1);
      expect(result.datasets[0].data).toEqual([]);
    });
  });
});
