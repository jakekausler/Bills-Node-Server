import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Activity } from './activity';
import { ActivityData } from './types';

// Mock the utility functions
vi.mock('../../utils/simulation/loadVariableValue', () => ({
  loadDateOrVariable: vi.fn((date, dateIsVariable, dateVariable, simulation) => ({
    date: new Date(date),
    dateIsVariable: dateIsVariable || false,
    dateVariable: dateVariable || null,
  })),
  loadNumberOrVariable: vi.fn((amount, amountIsVariable, amountVariable, simulation) => ({
    amount: amount,
    amountIsVariable: amountIsVariable || false,
    amountVariable: amountVariable || null,
  })),
}));

vi.mock('../../utils/date/date', () => ({
  formatDate: vi.fn((date) => date.toISOString().split('T')[0]),
}));

describe('Activity', () => {
  const mockActivityData: ActivityData = {
    id: 'activity-1',
    name: 'Test Activity',
    category: 'Income',
    flag: false,
    flagColor: null,
    isTransfer: false,
    from: null,
    to: null,
    amount: 1000,
    amountIsVariable: false,
    amountVariable: null,
    date: '2023-01-15',
    dateIsVariable: false,
    dateVariable: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an activity with provided data', () => {
      const activity = new Activity(mockActivityData);

      expect(activity.id).toBe('activity-1');
      expect(activity.name).toBe('Test Activity');
      expect(activity.category).toBe('Income');
      expect(activity.flag).toBe(false);
      expect(activity.flagColor).toBe(null);
      expect(activity.isTransfer).toBe(false);
      expect(activity.fro).toBe(null);
      expect(activity.to).toBe(null);
      expect(activity.amount).toBe(1000);
      expect(activity.amountIsVariable).toBe(false);
      expect(activity.amountVariable).toBe(null);
      expect(activity.dateIsVariable).toBe(false);
      expect(activity.dateVariable).toBe(null);
    });

    it('should generate UUID when id is not provided', () => {
      const dataWithoutId = { ...mockActivityData };
      delete dataWithoutId.id;

      const activity = new Activity(dataWithoutId);

      expect(activity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should set default flag color to gray when flag is true but no color provided', () => {
      const flaggedData: ActivityData = {
        ...mockActivityData,
        flag: true,
        flagColor: null,
      };

      const activity = new Activity(flaggedData);

      expect(activity.flag).toBe(true);
      expect(activity.flagColor).toBe('gray');
    });

    it('should preserve provided flag color', () => {
      const flaggedData: ActivityData = {
        ...mockActivityData,
        flag: true,
        flagColor: 'red',
      };

      const activity = new Activity(flaggedData);

      expect(activity.flag).toBe(true);
      expect(activity.flagColor).toBe('red');
    });

    it('should handle transfer activities correctly', () => {
      const transferData: ActivityData = {
        ...mockActivityData,
        isTransfer: true,
        from: 'account-1',
        to: 'account-2',
      };

      const activity = new Activity(transferData);

      expect(activity.isTransfer).toBe(true);
      expect(activity.fro).toBe('account-1');
      expect(activity.to).toBe('account-2');
    });

    it('should ignore from/to for non-transfer activities', () => {
      const nonTransferData: ActivityData = {
        ...mockActivityData,
        isTransfer: false,
        from: 'account-1',
        to: 'account-2',
      };

      const activity = new Activity(nonTransferData);

      expect(activity.isTransfer).toBe(false);
      expect(activity.fro).toBe(null);
      expect(activity.to).toBe(null);
    });

    it('should handle variable amounts', () => {
      const variableData: ActivityData = {
        ...mockActivityData,
        amount: '{HALF}',
        amountIsVariable: true,
        amountVariable: 'variable1',
      };

      const activity = new Activity(variableData);

      expect(activity.amount).toBe('{HALF}');
      expect(activity.amountIsVariable).toBe(true);
      expect(activity.amountVariable).toBe('variable1');
    });

    it('should handle variable dates', () => {
      const variableData: ActivityData = {
        ...mockActivityData,
        dateIsVariable: true,
        dateVariable: 'dateVar1',
      };

      const activity = new Activity(variableData);

      expect(activity.dateIsVariable).toBe(true);
      expect(activity.dateVariable).toBe('dateVar1');
    });

    it('should set spendingCategory when provided', () => {
      const dataWithSpendingCategory: ActivityData = {
        ...mockActivityData,
        spendingCategory: 'Groceries',
      };

      const activity = new Activity(dataWithSpendingCategory);

      expect(activity.spendingCategory).toBe('Groceries');
    });

    it('should default spendingCategory to null when not provided', () => {
      const activity = new Activity(mockActivityData);

      expect(activity.spendingCategory).toBeNull();
    });
  });

  describe('serialize', () => {
    it('should serialize activity data correctly', () => {
      const activity = new Activity(mockActivityData);
      const serialized = activity.serialize();

      expect(serialized.id).toBe(mockActivityData.id);
      expect(serialized.name).toBe(mockActivityData.name);
      expect(serialized.category).toBe(mockActivityData.category);
      expect(serialized.flag).toBe(mockActivityData.flag);
      expect(serialized.flagColor).toBe(mockActivityData.flagColor);
      expect(serialized.isTransfer).toBe(mockActivityData.isTransfer);
      expect(serialized.from).toBe(mockActivityData.from);
      expect(serialized.to).toBe(mockActivityData.to);
      expect(serialized.amount).toBe(mockActivityData.amount);
      expect(serialized.amountIsVariable).toBe(mockActivityData.amountIsVariable);
      expect(serialized.amountVariable).toBe(mockActivityData.amountVariable);
      expect(serialized.dateIsVariable).toBe(mockActivityData.dateIsVariable);
      expect(serialized.dateVariable).toBe(mockActivityData.dateVariable);
    });

    it('should serialize transfer activities correctly', () => {
      const transferData: ActivityData = {
        ...mockActivityData,
        isTransfer: true,
        from: 'account-1',
        to: 'account-2',
      };

      const activity = new Activity(transferData);
      const serialized = activity.serialize();

      expect(serialized.isTransfer).toBe(true);
      expect(serialized.from).toBe('account-1');
      expect(serialized.to).toBe('account-2');
    });

    it('should serialize flagged activities correctly', () => {
      const flaggedData: ActivityData = {
        ...mockActivityData,
        flag: true,
        flagColor: 'red',
      };

      const activity = new Activity(flaggedData);
      const serialized = activity.serialize();

      expect(serialized.flag).toBe(true);
      expect(serialized.flagColor).toBe('red');
    });

    it('should serialize variable amounts correctly', () => {
      const variableData: ActivityData = {
        ...mockActivityData,
        amount: '{FULL}',
        amountIsVariable: true,
        amountVariable: 'variable1',
      };

      const activity = new Activity(variableData);
      const serialized = activity.serialize();

      expect(serialized.amount).toBe('{FULL}');
      expect(serialized.amountIsVariable).toBe(true);
      expect(serialized.amountVariable).toBe('variable1');
    });

    it('should serialize spendingCategory when set', () => {
      const dataWithSpendingCategory: ActivityData = {
        ...mockActivityData,
        spendingCategory: 'Dining Out',
      };

      const activity = new Activity(dataWithSpendingCategory);
      const serialized = activity.serialize();

      expect(serialized.spendingCategory).toBe('Dining Out');
    });

    it('should round-trip spendingCategory through serialize and deserialize', () => {
      const dataWithSpendingCategory: ActivityData = {
        ...mockActivityData,
        spendingCategory: 'Transportation',
      };

      const activity = new Activity(dataWithSpendingCategory);
      const serialized = activity.serialize();
      const restored = new Activity(serialized);

      expect(restored.spendingCategory).toBe('Transportation');
    });

    it('should serialize spendingCategory as null when not provided', () => {
      const activity = new Activity(mockActivityData);
      const serialized = activity.serialize();

      expect(serialized.spendingCategory).toBeNull();
    });
  });

  describe('PaycheckDetails serialization', () => {
    it('should serialize and deserialize Activity with full PaycheckDetails', () => {
      const paycheckActivityData: ActivityData = {
        ...mockActivityData,
        name: 'Paycheck Activity',
        category: 'Income',
        isPaycheckActivity: true,
        paycheckDetails: {
          grossPay: 5000,
          traditional401k: 500,
          roth401k: 300,
          employerMatch: 250,
          hsa: 200,
          hsaEmployer: 100,
          ssTax: 310,
          medicareTax: 72.5,
          preTaxDeductions: [
            { label: 'Health Insurance', amount: 200 },
            { label: 'Dental Insurance', amount: 50 },
          ],
          postTaxDeductions: [
            { label: 'Union Dues', amount: 75 },
            { label: 'Parking', amount: 25 },
          ],
          netPay: 3117.5,
          parentPaycheckId: 'bill-paycheck-1',
        },
      };

      const activity = new Activity(paycheckActivityData);
      const serialized = activity.serialize();

      // Verify all PaycheckDetails fields survived serialization
      expect(serialized.isPaycheckActivity).toBe(true);
      expect(serialized.paycheckDetails).toBeDefined();
      expect(serialized.paycheckDetails?.grossPay).toBe(5000);
      expect(serialized.paycheckDetails?.traditional401k).toBe(500);
      expect(serialized.paycheckDetails?.roth401k).toBe(300);
      expect(serialized.paycheckDetails?.employerMatch).toBe(250);
      expect(serialized.paycheckDetails?.hsa).toBe(200);
      expect(serialized.paycheckDetails?.hsaEmployer).toBe(100);
      expect(serialized.paycheckDetails?.ssTax).toBe(310);
      expect(serialized.paycheckDetails?.medicareTax).toBe(72.5);
      expect(serialized.paycheckDetails?.netPay).toBe(3117.5);
      expect(serialized.paycheckDetails?.parentPaycheckId).toBe('bill-paycheck-1');

      // Verify deduction arrays
      expect(serialized.paycheckDetails?.preTaxDeductions).toHaveLength(2);
      expect(serialized.paycheckDetails?.preTaxDeductions).toEqual([
        { label: 'Health Insurance', amount: 200 },
        { label: 'Dental Insurance', amount: 50 },
      ]);
      expect(serialized.paycheckDetails?.postTaxDeductions).toHaveLength(2);
      expect(serialized.paycheckDetails?.postTaxDeductions).toEqual([
        { label: 'Union Dues', amount: 75 },
        { label: 'Parking', amount: 25 },
      ]);

      // Round-trip test: deserialize and verify
      const restoredActivity = new Activity(serialized);
      expect(restoredActivity.isPaycheckActivity).toBe(true);
      expect(restoredActivity.paycheckDetails).toEqual(activity.paycheckDetails);
    });

    it('should serialize and deserialize Activity without PaycheckDetails (backward compatibility)', () => {
      const regularActivityData: ActivityData = {
        ...mockActivityData,
        name: 'Regular Activity',
        category: 'Expense',
        // No isPaycheckActivity or paycheckDetails fields
      };

      const activity = new Activity(regularActivityData);
      const serialized = activity.serialize();

      // Verify paycheck fields default to false/null
      expect(serialized.isPaycheckActivity).toBe(false);
      expect(serialized.paycheckDetails).toBeNull();

      // Round-trip test
      const restoredActivity = new Activity(serialized);
      expect(restoredActivity.isPaycheckActivity).toBe(false);
      expect(restoredActivity.paycheckDetails).toBeNull();
    });

    it('should serialize Activity with isPaycheckActivity=true but null PaycheckDetails', () => {
      const activityData: ActivityData = {
        ...mockActivityData,
        name: 'Paycheck Placeholder',
        category: 'Income',
        isPaycheckActivity: true,
        paycheckDetails: null,
      };

      const activity = new Activity(activityData);
      const serialized = activity.serialize();

      // This represents a paycheck activity before details are computed
      expect(serialized.isPaycheckActivity).toBe(true);
      expect(serialized.paycheckDetails).toBeNull();

      // Round-trip test
      const restoredActivity = new Activity(serialized);
      expect(restoredActivity.isPaycheckActivity).toBe(true);
      expect(restoredActivity.paycheckDetails).toBeNull();
    });

    it('should serialize Activity with minimal PaycheckDetails', () => {
      const minimalPaycheckData: ActivityData = {
        ...mockActivityData,
        name: 'Simple Paycheck',
        category: 'Income',
        isPaycheckActivity: true,
        paycheckDetails: {
          grossPay: 3000,
          traditional401k: 0,
          roth401k: 0,
          employerMatch: 0,
          hsa: 0,
          hsaEmployer: 0,
          ssTax: 186,
          medicareTax: 43.5,
          preTaxDeductions: [],
          postTaxDeductions: [],
          netPay: 2770.5,
          // no parentPaycheckId
        },
      };

      const activity = new Activity(minimalPaycheckData);
      const serialized = activity.serialize();

      expect(serialized.isPaycheckActivity).toBe(true);
      expect(serialized.paycheckDetails?.grossPay).toBe(3000);
      expect(serialized.paycheckDetails?.traditional401k).toBe(0);
      expect(serialized.paycheckDetails?.preTaxDeductions).toEqual([]);
      expect(serialized.paycheckDetails?.postTaxDeductions).toEqual([]);
      expect(serialized.paycheckDetails?.netPay).toBe(2770.5);
      expect(serialized.paycheckDetails?.parentPaycheckId).toBeUndefined();

      // Round-trip test
      const restoredActivity = new Activity(serialized);
      expect(restoredActivity.paycheckDetails?.grossPay).toBe(3000);
      expect(restoredActivity.paycheckDetails?.preTaxDeductions).toEqual([]);
      expect(restoredActivity.paycheckDetails?.postTaxDeductions).toEqual([]);
    });

    it('should handle PaycheckDetails with empty deduction arrays', () => {
      const activityData: ActivityData = {
        ...mockActivityData,
        isPaycheckActivity: true,
        paycheckDetails: {
          grossPay: 4000,
          traditional401k: 400,
          roth401k: 0,
          employerMatch: 200,
          hsa: 0,
          hsaEmployer: 0,
          ssTax: 248,
          medicareTax: 58,
          preTaxDeductions: [],
          postTaxDeductions: [],
          netPay: 3094,
        },
      };

      const activity = new Activity(activityData);
      const serialized = activity.serialize();

      expect(serialized.paycheckDetails?.preTaxDeductions).toEqual([]);
      expect(serialized.paycheckDetails?.postTaxDeductions).toEqual([]);

      // Round-trip test
      const restoredActivity = new Activity(serialized);
      expect(restoredActivity.paycheckDetails?.preTaxDeductions).toEqual([]);
      expect(restoredActivity.paycheckDetails?.postTaxDeductions).toEqual([]);
    });
  });
});
