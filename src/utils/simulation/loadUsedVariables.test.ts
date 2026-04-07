import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { AccountsAndTransfers } from '../../data/account/types';
import { loadUsedVariables } from './loadUsedVariables';

// Mock fs module to prevent loading monteCarloMappings.json from disk
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

// Project test conventions:
// - Framework: Vitest
// - Mocking: fs module mocked to exclude monteCarloMappings.json from tests
// - Assertions: expect().toEqual() / expect().toHaveLength()

// Minimal empty data for the first 3 params so spending tracker tests are isolated
const emptyAccountsAndTransfers: AccountsAndTransfers = {
  accounts: [],
  transfers: { activity: [], bills: [] },
};
const emptySocialSecurities: [] = [];
const emptyPensions: [] = [];

// ---------------------------------------------------------------------------
// Helpers for building minimal fake Account / Activity / Bill / Interest shapes
// The function only reads fields; full class instances are not required.
// ---------------------------------------------------------------------------

type FakeActivity = {
  name: string;
  date: Date;
  amountIsVariable: boolean;
  amountVariable: string | null;
  dateIsVariable: boolean;
  dateVariable: string | null;
};

type FakeBill = {
  name: string;
  startDate: Date;
  fro?: string | null;
  to?: string | null;
  amountIsVariable: boolean;
  amountVariable: string | null;
  startDateIsVariable: boolean;
  startDateVariable: string | null;
  endDateIsVariable: boolean;
  endDateVariable: string | null;
  increaseByIsVariable: boolean;
  increaseByVariable: string | null;
};

type FakeInterest = {
  applicableDate: Date;
  applicableDateIsVariable: boolean;
  applicableDateVariable: string | null;
  aprIsVariable: boolean;
  aprVariable: string | null;
};

type FakeAccount = {
  name: string;
  activity: FakeActivity[];
  bills: FakeBill[];
  interests: FakeInterest[];
};

type FakeTransferActivity = {
  name: string;
  date: Date;
  fro?: string | null;
  to?: string | null;
  amountIsVariable: boolean;
  amountVariable: string | null;
  dateIsVariable: boolean;
  dateVariable: string | null;
};

function makeAccountsAndTransfers(
  accounts: FakeAccount[] = [],
  transferActivities: FakeTransferActivity[] = [],
  transferBills: FakeBill[] = [],
): AccountsAndTransfers {
  return {
    accounts: accounts as unknown as AccountsAndTransfers['accounts'],
    transfers: {
      activity: transferActivities as unknown as AccountsAndTransfers['transfers']['activity'],
      bills: transferBills as unknown as AccountsAndTransfers['transfers']['bills'],
    },
  };
}

function makeCategory(overrides: Partial<SpendingTrackerCategory> = {}): SpendingTrackerCategory {
  return {
    id: 'cat-1',
    name: 'Eating Out',
    threshold: 150,
    thresholdIsVariable: false,
    thresholdVariable: null,
    interval: 'monthly',
    intervalStart: '1',
    accountId: 'acc-1',
    carryOver: false,
    carryUnder: false,
    increaseBy: 0,
    increaseByIsVariable: false,
    increaseByVariable: null,
    increaseByDate: '01/01',
    thresholdChanges: [],
    ...overrides,
  };
}

describe('loadUsedVariables - spending tracker', () => {
  it('should track category with thresholdIsVariable', () => {
    const category = makeCategory({
      name: 'Eating Out',
      thresholdIsVariable: true,
      thresholdVariable: 'EATING_OUT_BUDGET',
    });

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      emptyPensions,
      [category],
    );

    expect(result['EATING_OUT_BUDGET']).toEqual([
      { type: 'spendingTracker', name: 'Eating Out' },
    ]);
  });

  it('should track category with increaseByIsVariable', () => {
    const category = makeCategory({
      name: 'Groceries',
      increaseByIsVariable: true,
      increaseByVariable: 'INFLATION',
    });

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      emptyPensions,
      [category],
    );

    expect(result['INFLATION']).toEqual([
      { type: 'spendingTracker', name: 'Groceries' },
    ]);
  });

  it('should track thresholdChange with dateIsVariable', () => {
    const category = makeCategory({
      name: 'Vacation',
      thresholdChanges: [
        {
          date: '2026-06-01',
          dateIsVariable: true,
          dateVariable: 'CHANGE_DATE',
          newThreshold: 200,
          newThresholdIsVariable: false,
          newThresholdVariable: null,
          resetCarry: false,
        },
      ],
    });

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      emptyPensions,
      [category],
    );

    expect(result['CHANGE_DATE']).toEqual([
      { type: 'spendingTracker', name: 'Vacation' },
    ]);
  });

  it('should track thresholdChange with newThresholdIsVariable', () => {
    const category = makeCategory({
      name: 'Entertainment',
      thresholdChanges: [
        {
          date: '2026-06-01',
          dateIsVariable: false,
          dateVariable: null,
          newThreshold: 300,
          newThresholdIsVariable: true,
          newThresholdVariable: 'NEW_AMOUNT',
          resetCarry: false,
        },
      ],
    });

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      emptyPensions,
      [category],
    );

    expect(result['NEW_AMOUNT']).toEqual([
      { type: 'spendingTracker', name: 'Entertainment' },
    ]);
  });

  it('should not add entries for category with no variable fields', () => {
    const category = makeCategory({
      name: 'Transport',
      thresholdIsVariable: false,
      thresholdVariable: null,
      increaseByIsVariable: false,
      increaseByVariable: null,
      thresholdChanges: [],
    });

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      emptyPensions,
      [category],
    );

    // No spending tracker entries should exist
    const spendingTrackerEntries = Object.values(result)
      .flat()
      .filter((entry) => entry.type === 'spendingTracker');
    expect(spendingTrackerEntries).toHaveLength(0);
  });

  it('should track variables from multiple categories', () => {
    const categories = [
      makeCategory({
        id: 'cat-1',
        name: 'Eating Out',
        thresholdIsVariable: true,
        thresholdVariable: 'EATING_OUT_BUDGET',
      }),
      makeCategory({
        id: 'cat-2',
        name: 'Groceries',
        increaseByIsVariable: true,
        increaseByVariable: 'INFLATION',
        thresholdChanges: [
          {
            date: '2027-01-01',
            dateIsVariable: true,
            dateVariable: 'GROCERY_CHANGE_DATE',
            newThreshold: 500,
            newThresholdIsVariable: true,
            newThresholdVariable: 'GROCERY_NEW_THRESHOLD',
            resetCarry: false,
          },
        ],
      }),
    ];

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      emptyPensions,
      categories,
    );

    expect(result['EATING_OUT_BUDGET']).toEqual([
      { type: 'spendingTracker', name: 'Eating Out' },
    ]);
    expect(result['INFLATION']).toEqual([
      { type: 'spendingTracker', name: 'Groceries' },
    ]);
    expect(result['GROCERY_CHANGE_DATE']).toEqual([
      { type: 'spendingTracker', name: 'Groceries' },
    ]);
    expect(result['GROCERY_NEW_THRESHOLD']).toEqual([
      { type: 'spendingTracker', name: 'Groceries' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Account activity tests
// ---------------------------------------------------------------------------

describe('loadUsedVariables - account activities', () => {
  it('should track activity with amountIsVariable', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [
        {
          name: 'Salary',
          date: new Date('2024-01-15T12:00:00Z'),
          amountIsVariable: true,
          amountVariable: 'SALARY_VAR',
          dateIsVariable: false,
          dateVariable: null,
        },
      ],
      bills: [],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['SALARY_VAR']).toEqual([
      {
        type: 'activity',
        account: 'Checking',
        name: 'Salary',
        date: '2024-01-15',
      },
    ]);
  });

  it('should track activity with dateIsVariable', () => {
    const account: FakeAccount = {
      name: 'Savings',
      activity: [
        {
          name: 'Bonus',
          date: new Date('2024-03-01T12:00:00Z'),
          amountIsVariable: false,
          amountVariable: null,
          dateIsVariable: true,
          dateVariable: 'BONUS_DATE',
        },
      ],
      bills: [],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['BONUS_DATE']).toEqual([
      {
        type: 'activity',
        account: 'Savings',
        name: 'Bonus',
      },
    ]);
    // date field should NOT be present when dateIsVariable
    expect(result['BONUS_DATE'][0]).not.toHaveProperty('date');
  });

  it('should not add entries for activity with no variable fields', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [
        {
          name: 'Groceries',
          date: new Date('2024-02-01T12:00:00Z'),
          amountIsVariable: false,
          amountVariable: null,
          dateIsVariable: false,
          dateVariable: null,
        },
      ],
      bills: [],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should not add entries when amountIsVariable is true but amountVariable is null', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [
        {
          name: 'Payment',
          date: new Date('2024-02-01T12:00:00Z'),
          amountIsVariable: true,
          amountVariable: null,
          dateIsVariable: false,
          dateVariable: null,
        },
      ],
      bills: [],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should accumulate multiple usages of the same variable', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [
        {
          name: 'Payment A',
          date: new Date('2024-01-01T12:00:00Z'),
          amountIsVariable: true,
          amountVariable: 'SHARED_VAR',
          dateIsVariable: false,
          dateVariable: null,
        },
        {
          name: 'Payment B',
          date: new Date('2024-02-01T12:00:00Z'),
          amountIsVariable: true,
          amountVariable: 'SHARED_VAR',
          dateIsVariable: false,
          dateVariable: null,
        },
      ],
      bills: [],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['SHARED_VAR']).toHaveLength(2);
    expect(result['SHARED_VAR'][0].name).toBe('Payment A');
    expect(result['SHARED_VAR'][1].name).toBe('Payment B');
  });
});

// ---------------------------------------------------------------------------
// Account bill tests
// ---------------------------------------------------------------------------

describe('loadUsedVariables - account bills', () => {
  it('should track bill with amountIsVariable', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [],
      bills: [
        {
          name: 'Rent',
          startDate: new Date('2024-01-01T12:00:00Z'),
          amountIsVariable: true,
          amountVariable: 'RENT_AMOUNT',
          startDateIsVariable: false,
          startDateVariable: null,
          endDateIsVariable: false,
          endDateVariable: null,
          increaseByIsVariable: false,
          increaseByVariable: null,
        },
      ],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['RENT_AMOUNT']).toEqual([
      {
        type: 'bill',
        account: 'Checking',
        name: 'Rent',
        date: '2024-01-01',
      },
    ]);
  });

  it('should track bill with startDateIsVariable', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [],
      bills: [
        {
          name: 'Mortgage',
          startDate: new Date('2024-06-01T12:00:00Z'),
          amountIsVariable: false,
          amountVariable: null,
          startDateIsVariable: true,
          startDateVariable: 'MORTGAGE_START',
          endDateIsVariable: false,
          endDateVariable: null,
          increaseByIsVariable: false,
          increaseByVariable: null,
        },
      ],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['MORTGAGE_START']).toEqual([
      {
        type: 'bill',
        account: 'Checking',
        name: 'Mortgage',
      },
    ]);
    // No date field for startDateIsVariable
    expect(result['MORTGAGE_START'][0]).not.toHaveProperty('date');
  });

  it('should track bill with endDateIsVariable', () => {
    const account: FakeAccount = {
      name: 'Savings',
      activity: [],
      bills: [
        {
          name: 'Subscription',
          startDate: new Date('2024-01-01T12:00:00Z'),
          amountIsVariable: false,
          amountVariable: null,
          startDateIsVariable: false,
          startDateVariable: null,
          endDateIsVariable: true,
          endDateVariable: 'SUB_END',
          increaseByIsVariable: false,
          increaseByVariable: null,
        },
      ],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['SUB_END']).toEqual([
      {
        type: 'bill',
        account: 'Savings',
        name: 'Subscription',
        date: '2024-01-01',
      },
    ]);
  });

  it('should track bill with increaseByIsVariable', () => {
    const account: FakeAccount = {
      name: 'Checking',
      activity: [],
      bills: [
        {
          name: 'Utilities',
          startDate: new Date('2024-03-15T12:00:00Z'),
          amountIsVariable: false,
          amountVariable: null,
          startDateIsVariable: false,
          startDateVariable: null,
          endDateIsVariable: false,
          endDateVariable: null,
          increaseByIsVariable: true,
          increaseByVariable: 'INFLATION_RATE',
        },
      ],
      interests: [],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['INFLATION_RATE']).toEqual([
      {
        type: 'bill',
        account: 'Checking',
        name: 'Utilities',
        date: '2024-03-15',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Account interest tests
// ---------------------------------------------------------------------------

describe('loadUsedVariables - account interests', () => {
  it('should track interest with applicableDateIsVariable', () => {
    const account: FakeAccount = {
      name: 'Savings',
      activity: [],
      bills: [],
      interests: [
        {
          applicableDate: new Date('2024-01-01T12:00:00Z'),
          applicableDateIsVariable: true,
          applicableDateVariable: 'INTEREST_DATE',
          aprIsVariable: false,
          aprVariable: null,
        },
      ],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['INTEREST_DATE']).toEqual([
      {
        type: 'interest',
        account: 'Savings',
        name: 'Interest',
      },
    ]);
    // No date field for applicableDateIsVariable
    expect(result['INTEREST_DATE'][0]).not.toHaveProperty('date');
  });

  it('should track interest with aprIsVariable', () => {
    const account: FakeAccount = {
      name: 'Investment',
      activity: [],
      bills: [],
      interests: [
        {
          applicableDate: new Date('2024-07-01T12:00:00Z'),
          applicableDateIsVariable: false,
          applicableDateVariable: null,
          aprIsVariable: true,
          aprVariable: 'APR_VAR',
        },
      ],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['APR_VAR']).toEqual([
      {
        type: 'interest',
        account: 'Investment',
        name: 'Interest',
        date: '2024-07-01',
      },
    ]);
  });

  it('should not add entries for interest with no variable fields', () => {
    const account: FakeAccount = {
      name: 'Savings',
      activity: [],
      bills: [],
      interests: [
        {
          applicableDate: new Date('2024-01-01T12:00:00Z'),
          applicableDateIsVariable: false,
          applicableDateVariable: null,
          aprIsVariable: false,
          aprVariable: null,
        },
      ],
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([account]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transfer activity tests
// ---------------------------------------------------------------------------

describe('loadUsedVariables - transfer activities', () => {
  it('should track transfer activity with amountIsVariable', () => {
    const transfer: FakeTransferActivity = {
      name: 'Auto Transfer',
      date: new Date('2024-05-10T12:00:00Z'),
      fro: 'Checking',
      to: 'Savings',
      amountIsVariable: true,
      amountVariable: 'TRANSFER_AMT',
      dateIsVariable: false,
      dateVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [transfer]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['TRANSFER_AMT']).toEqual([
      {
        type: 'transfer',
        from: 'Checking',
        to: 'Savings',
        name: 'Auto Transfer',
        date: '2024-05-10',
      },
    ]);
  });

  it('should track transfer activity with dateIsVariable', () => {
    const transfer: FakeTransferActivity = {
      name: 'Scheduled Transfer',
      date: new Date('2024-09-01T12:00:00Z'),
      fro: 'Checking',
      to: 'Retirement',
      amountIsVariable: false,
      amountVariable: null,
      dateIsVariable: true,
      dateVariable: 'TRANSFER_DATE',
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [transfer]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['TRANSFER_DATE']).toEqual([
      {
        type: 'transfer',
        from: 'Checking',
        to: 'Retirement',
        name: 'Scheduled Transfer',
      },
    ]);
    expect(result['TRANSFER_DATE'][0]).not.toHaveProperty('date');
  });

  it('should default from/to to empty string for amountIsVariable when fro/to is null', () => {
    const transfer: FakeTransferActivity = {
      name: 'Transfer No From/To',
      date: new Date('2024-01-01T12:00:00Z'),
      fro: null,
      to: null,
      amountIsVariable: true,
      amountVariable: 'AMT_VAR',
      dateIsVariable: false,
      dateVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [transfer]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['AMT_VAR'][0].from).toBe('');
    expect(result['AMT_VAR'][0].to).toBe('');
  });

  it('should default from/to to empty string for dateIsVariable when fro/to is null', () => {
    const transfer: FakeTransferActivity = {
      name: 'Transfer Null Date',
      date: new Date('2024-01-01T12:00:00Z'),
      fro: null,
      to: null,
      amountIsVariable: false,
      amountVariable: null,
      dateIsVariable: true,
      dateVariable: 'NULL_DATE_VAR',
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [transfer]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['NULL_DATE_VAR'][0].from).toBe('');
    expect(result['NULL_DATE_VAR'][0].to).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Transfer bill tests
// ---------------------------------------------------------------------------

describe('loadUsedVariables - transfer bills', () => {
  it('should track transfer bill with amountIsVariable', () => {
    const bill: FakeBill = {
      name: 'Monthly Transfer Bill',
      startDate: new Date('2024-02-01T12:00:00Z'),
      fro: 'Checking',
      to: 'Savings',
      amountIsVariable: true,
      amountVariable: 'TBILL_AMT',
      startDateIsVariable: false,
      startDateVariable: null,
      endDateIsVariable: false,
      endDateVariable: null,
      increaseByIsVariable: false,
      increaseByVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['TBILL_AMT']).toEqual([
      {
        type: 'bill',
        name: 'Monthly Transfer Bill',
        from: 'Checking',
        to: 'Savings',
        date: '2024-02-01',
      },
    ]);
  });

  it('should track transfer bill with startDateIsVariable', () => {
    const bill: FakeBill = {
      name: 'Transfer Start Bill',
      startDate: new Date('2024-03-01T12:00:00Z'),
      fro: 'A',
      to: 'B',
      amountIsVariable: false,
      amountVariable: null,
      startDateIsVariable: true,
      startDateVariable: 'TBILL_START',
      endDateIsVariable: false,
      endDateVariable: null,
      increaseByIsVariable: false,
      increaseByVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['TBILL_START']).toEqual([
      {
        type: 'bill',
        name: 'Transfer Start Bill',
        from: 'A',
        to: 'B',
      },
    ]);
    expect(result['TBILL_START'][0]).not.toHaveProperty('date');
  });

  it('should track transfer bill with endDateIsVariable', () => {
    const bill: FakeBill = {
      name: 'Transfer End Bill',
      startDate: new Date('2024-04-01T12:00:00Z'),
      fro: 'X',
      to: 'Y',
      amountIsVariable: false,
      amountVariable: null,
      startDateIsVariable: false,
      startDateVariable: null,
      endDateIsVariable: true,
      endDateVariable: 'TBILL_END',
      increaseByIsVariable: false,
      increaseByVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['TBILL_END']).toEqual([
      {
        type: 'bill',
        name: 'Transfer End Bill',
        from: 'X',
        to: 'Y',
        date: '2024-04-01',
      },
    ]);
  });

  it('should track transfer bill with increaseByIsVariable', () => {
    const bill: FakeBill = {
      name: 'Transfer Inflate Bill',
      startDate: new Date('2024-05-01T12:00:00Z'),
      fro: 'M',
      to: 'N',
      amountIsVariable: false,
      amountVariable: null,
      startDateIsVariable: false,
      startDateVariable: null,
      endDateIsVariable: false,
      endDateVariable: null,
      increaseByIsVariable: true,
      increaseByVariable: 'TBILL_INFLATE',
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['TBILL_INFLATE']).toEqual([
      {
        type: 'bill',
        name: 'Transfer Inflate Bill',
        from: 'M',
        to: 'N',
        date: '2024-05-01',
      },
    ]);
  });

  it('should default from/to to empty string for transfer bill amountIsVariable when fro/to is null', () => {
    const bill: FakeBill = {
      name: 'Null From/To Amount Bill',
      startDate: new Date('2024-06-01T12:00:00Z'),
      fro: null,
      to: null,
      amountIsVariable: true,
      amountVariable: 'NULL_AMT',
      startDateIsVariable: false,
      startDateVariable: null,
      endDateIsVariable: false,
      endDateVariable: null,
      increaseByIsVariable: false,
      increaseByVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['NULL_AMT'][0].from).toBe('');
    expect(result['NULL_AMT'][0].to).toBe('');
  });

  it('should default from/to to empty string for transfer bill startDateIsVariable when fro/to is null', () => {
    const bill: FakeBill = {
      name: 'Null From/To Start Bill',
      startDate: new Date('2024-06-01T12:00:00Z'),
      fro: null,
      to: null,
      amountIsVariable: false,
      amountVariable: null,
      startDateIsVariable: true,
      startDateVariable: 'NULL_START',
      endDateIsVariable: false,
      endDateVariable: null,
      increaseByIsVariable: false,
      increaseByVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['NULL_START'][0].from).toBe('');
    expect(result['NULL_START'][0].to).toBe('');
  });

  it('should default from/to to empty string for transfer bill endDateIsVariable when fro/to is null', () => {
    const bill: FakeBill = {
      name: 'Null From/To End Bill',
      startDate: new Date('2024-06-01T12:00:00Z'),
      fro: null,
      to: null,
      amountIsVariable: false,
      amountVariable: null,
      startDateIsVariable: false,
      startDateVariable: null,
      endDateIsVariable: true,
      endDateVariable: 'NULL_END',
      increaseByIsVariable: false,
      increaseByVariable: null,
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['NULL_END'][0].from).toBe('');
    expect(result['NULL_END'][0].to).toBe('');
  });

  it('should default from/to to empty string for transfer bill increaseByIsVariable when fro/to is null', () => {
    const bill: FakeBill = {
      name: 'Null From/To Inflate Bill',
      startDate: new Date('2024-07-01T12:00:00Z'),
      fro: null,
      to: null,
      amountIsVariable: false,
      amountVariable: null,
      startDateIsVariable: false,
      startDateVariable: null,
      endDateIsVariable: false,
      endDateVariable: null,
      increaseByIsVariable: true,
      increaseByVariable: 'NULL_INFLATE',
    };

    const result = loadUsedVariables(
      makeAccountsAndTransfers([], [], [bill]),
      emptySocialSecurities,
      emptyPensions,
      [],
    );

    expect(result['NULL_INFLATE'][0].from).toBe('');
    expect(result['NULL_INFLATE'][0].to).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Pension tests
// ---------------------------------------------------------------------------

describe('loadUsedVariables - pensions', () => {
  it('should always track workStartDateVariable for pensions', () => {
    const pension = {
      name: 'State Pension',
      workStartDateVariable: 'PEN_WORK_START',
      workStartDate: new Date('1995-08-01T12:00:00Z'),
    };

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      [pension as never],
      [],
    );

    expect(result['PEN_WORK_START']).toEqual([
      {
        type: 'pension',
        name: 'State Pension',
      },
    ]);
  });

  it('should track variables from multiple pensions', () => {
    const pen1 = {
      name: 'Pension A',
      workStartDateVariable: 'PA_WORK',
      workStartDate: new Date('1993-01-01T12:00:00Z'),
    };
    const pen2 = {
      name: 'Pension B',
      workStartDateVariable: 'PB_WORK',
      workStartDate: new Date('2000-01-01T12:00:00Z'),
    };

    const result = loadUsedVariables(
      emptyAccountsAndTransfers,
      emptySocialSecurities,
      [pen1 as never, pen2 as never],
      [],
    );

    expect(result['PA_WORK']).toHaveLength(1);
    expect(result['PB_WORK']).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Empty inputs test
// ---------------------------------------------------------------------------

describe('loadUsedVariables - empty inputs', () => {
  it('should return empty object when all inputs are empty', () => {
    const result = loadUsedVariables(emptyAccountsAndTransfers, [], [], []);
    expect(result).toEqual({});
  });
});
