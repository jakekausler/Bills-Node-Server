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
  });
});
