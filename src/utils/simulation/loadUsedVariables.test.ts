import { describe, it, expect } from 'vitest';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { AccountsAndTransfers } from '../../data/account/types';
import { loadUsedVariables } from './loadUsedVariables';

// Minimal empty data for the first 3 params so spending tracker tests are isolated
const emptyAccountsAndTransfers: AccountsAndTransfers = {
  accounts: [],
  transfers: { activity: [], bills: [] },
};
const emptySocialSecurities: [] = [];
const emptyPensions: [] = [];

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
