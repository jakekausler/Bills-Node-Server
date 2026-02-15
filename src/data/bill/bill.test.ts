import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bill, insertBill } from './bill';
import { BillData } from './types';
import { AccountsAndTransfers } from '../account/types';
import { Account } from '../account/account';

// Mock dependencies
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

vi.mock('../activity/activity', () => ({
  Activity: vi.fn().mockImplementation((data) => ({
    id: data.id,
    name: data.name,
    category: data.category,
    amount: data.amount,
    date: new Date(data.date),
    isTransfer: data.isTransfer,
    spendingCategory: data.spendingCategory ?? null,
  })),
}));

describe('Bill', () => {
  const mockBillData: BillData = {
    id: 'bill-1',
    name: 'Test Monthly Bill',
    category: 'Utilities',
    startDate: '2023-01-15',
    startDateIsVariable: false,
    startDateVariable: null,
    endDate: null,
    endDateIsVariable: false,
    endDateVariable: null,
    everyN: 1,
    periods: 'month',
    annualStartDate: null,
    annualEndDate: null,
    isAutomatic: false,
    amount: 100,
    amountIsVariable: false,
    amountVariable: null,
    increaseBy: 0.03,
    increaseByIsVariable: true,
    increaseByVariable: 'INFLATION',
    increaseByDate: '01/01',
    ceilingMultiple: 0,
    isTransfer: false,
    from: null,
    to: null,
    flagColor: null,
    flag: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a bill with provided data', () => {
      const bill = new Bill(mockBillData);

      expect(bill.id).toBe('bill-1');
      expect(bill.name).toBe('Test Monthly Bill');
      expect(bill.category).toBe('Utilities');
      expect(bill.everyN).toBe(1);
      expect(bill.periods).toBe('month');
      expect(bill.isTransfer).toBe(false);
      expect(bill.fro).toBe(null);
      expect(bill.to).toBe(null);
      expect(bill.flag).toBe(false);
      expect(bill.flagColor).toBe(null);
      expect(bill.isAutomatic).toBe(false);
    });

    it('should generate UUID when id is not provided', () => {
      const dataWithoutId = { ...mockBillData };
      delete dataWithoutId.id;

      const bill = new Bill(dataWithoutId);

      expect(bill.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should set default flag color to gray when flag is true but no color provided', () => {
      const flaggedData: BillData = {
        ...mockBillData,
        flag: true,
        flagColor: null,
      };

      const bill = new Bill(flaggedData);

      expect(bill.flag).toBe(true);
      expect(bill.flagColor).toBe('gray');
    });

    it('should preserve provided flag color', () => {
      const flaggedData: BillData = {
        ...mockBillData,
        flag: true,
        flagColor: 'red',
      };

      const bill = new Bill(flaggedData);

      expect(bill.flag).toBe(true);
      expect(bill.flagColor).toBe('red');
    });

    it('should handle transfer bills correctly', () => {
      const transferData: BillData = {
        ...mockBillData,
        isTransfer: true,
        from: 'account-1',
        to: 'account-2',
      };

      const bill = new Bill(transferData);

      expect(bill.isTransfer).toBe(true);
      expect(bill.fro).toBe('account-1');
      expect(bill.to).toBe('account-2');
    });

    it('should ignore from/to for non-transfer bills', () => {
      const nonTransferData: BillData = {
        ...mockBillData,
        isTransfer: false,
        from: 'account-1',
        to: 'account-2',
      };

      const bill = new Bill(nonTransferData);

      expect(bill.isTransfer).toBe(false);
      expect(bill.fro).toBe(null);
      expect(bill.to).toBe(null);
    });

    it('should handle end date when provided', () => {
      const dataWithEndDate: BillData = {
        ...mockBillData,
        endDate: '2023-12-31',
        endDateIsVariable: false,
        endDateVariable: null,
      };

      const bill = new Bill(dataWithEndDate);

      expect(bill.endDate).toBeInstanceOf(Date);
      expect(bill.endDateIsVariable).toBe(false);
      expect(bill.endDateVariable).toBe(null);
    });

    it('should handle bills without end date', () => {
      const bill = new Bill(mockBillData);

      expect(bill.endDate).toBe(null);
      expect(bill.endDateIsVariable).toBe(false);
      expect(bill.endDateVariable).toBe(null);
    });
  });

  describe('setIncreaseByDate', () => {
    it('should parse MM/DD format correctly', () => {
      const bill = new Bill(mockBillData);
      const result = bill.setIncreaseByDate('03/15');

      expect(result).toEqual({ day: 15, month: 2 }); // Month is 0-indexed
    });

    it('should return default values for empty string', () => {
      const bill = new Bill(mockBillData);
      const result = bill.setIncreaseByDate('');

      expect(result).toEqual({ day: 1, month: 0 });
    });
  });

  describe('getUTCMonthAndDay', () => {
    it('should parse MM/DD format correctly', () => {
      const bill = new Bill(mockBillData);
      const result = bill.getUTCMonthAndDay('03/15');

      expect(result).toEqual([3, 15]);
    });
  });

  describe('serialize', () => {
    it('should serialize bill data correctly', () => {
      const bill = new Bill(mockBillData);
      const serialized = bill.serialize();

      expect(serialized.id).toBe(mockBillData.id);
      expect(serialized.name).toBe(mockBillData.name);
      expect(serialized.category).toBe(mockBillData.category);
      expect(serialized.everyN).toBe(mockBillData.everyN);
      expect(serialized.periods).toBe(mockBillData.periods);
      expect(serialized.isTransfer).toBe(mockBillData.isTransfer);
      expect(serialized.from).toBe(mockBillData.from);
      expect(serialized.to).toBe(mockBillData.to);
      expect(serialized.flag).toBe(mockBillData.flag);
      expect(serialized.flagColor).toBe(mockBillData.flagColor);
      expect(serialized.isAutomatic).toBe(mockBillData.isAutomatic);
    });

    it('should format increase by date correctly', () => {
      const bill = new Bill({
        ...mockBillData,
        increaseByDate: '03/15',
      });

      const serialized = bill.serialize();

      expect(serialized.increaseByDate).toBe('03/15');
    });

    it('should serialize spendingCategory when set', () => {
      const bill = new Bill({
        ...mockBillData,
        spendingCategory: 'Utilities',
      });

      const serialized = bill.serialize();

      expect(serialized.spendingCategory).toBe('Utilities');
    });

    it('should serialize spendingCategory as null when not provided', () => {
      const bill = new Bill(mockBillData);
      const serialized = bill.serialize();

      expect(serialized.spendingCategory).toBeNull();
    });
  });

  describe('toActivity', () => {
    it('should create an activity from bill data', () => {
      const bill = new Bill(mockBillData);
      const date = new Date('2023-02-15');
      const amount = 150;

      const activity = bill.toActivity('activity-1', 'Default', amount, date);

      expect(activity).toBeDefined();
      // Note: We're using a mock Activity constructor, so we can only test that it was called
      // In a real scenario, we'd test the actual Activity properties
    });

    it('should include spendingCategory in the returned activity', () => {
      const bill = new Bill({
        ...mockBillData,
        spendingCategory: 'Housing',
      });
      const date = new Date('2023-02-15');
      const amount = 150;

      const activity = bill.toActivity('activity-1', 'Default', amount, date);

      expect(activity.spendingCategory).toBe('Housing');
    });

    it('should pass null spendingCategory when bill has no spendingCategory', () => {
      const bill = new Bill(mockBillData);
      const date = new Date('2023-02-15');
      const amount = 150;

      const activity = bill.toActivity('activity-1', 'Default', amount, date);

      expect(activity.spendingCategory).toBeNull();
    });
  });

  describe('checkAnnualDates', () => {
    it('should return date unchanged when no annual constraints', () => {
      const bill = new Bill(mockBillData);
      const testDate = new Date('2023-06-15');

      const result = bill.checkAnnualDates(testDate);

      expect(result).toBe(testDate);
    });

    it('should handle annual start date only', () => {
      const billWithAnnualStart = new Bill({
        ...mockBillData,
        annualStartDate: '03/01',
      });

      const testDate = new Date('2023-02-15'); // Before annual start

      const result = billWithAnnualStart.checkAnnualDates(testDate);

      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(3); // April (month is 1-indexed in getUTCMonthAndDay, 0-indexed in Date constructor)
      expect(result.getDate()).toBe(1);
    });

    it('should handle annual end date only', () => {
      const billWithAnnualEnd = new Bill({
        ...mockBillData,
        annualEndDate: '10/31',
      });

      const testDate = new Date('2023-11-15'); // After annual end

      const result = billWithAnnualEnd.checkAnnualDates(testDate);

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(1); // February (month is 1-indexed in getUTCMonthAndDay, 0-indexed in Date constructor)
      expect(result.getDate()).toBe(1);
    });
  });

  describe('advance', () => {
    it('should advance by days correctly', () => {
      const bill = new Bill({
        ...mockBillData,
        periods: 'day',
        everyN: 7,
      });

      const originalDate = new Date(bill.startDate);
      bill.advance();

      const expectedDate = new Date(originalDate);
      expectedDate.setDate(expectedDate.getDate() + 7);

      expect(bill.startDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should advance by weeks correctly', () => {
      const bill = new Bill({
        ...mockBillData,
        periods: 'week',
        everyN: 2,
      });

      const originalDate = new Date(bill.startDate);
      bill.advance();

      const expectedDate = new Date(originalDate);
      expectedDate.setDate(expectedDate.getDate() + 14);

      expect(bill.startDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should advance by months correctly', () => {
      const bill = new Bill({
        ...mockBillData,
        periods: 'month',
        everyN: 1,
      });

      const originalMonth = bill.startDate.getMonth();
      bill.advance();

      expect(bill.startDate.getMonth()).toBe((originalMonth + 1) % 12);
    });

    it('should advance by years correctly', () => {
      const bill = new Bill({
        ...mockBillData,
        periods: 'year',
        everyN: 1,
      });

      const originalYear = bill.startDate.getFullYear();
      bill.advance();

      expect(bill.startDate.getFullYear()).toBe(originalYear + 1);
    });
  });

  describe('skip', () => {
    it('should call advance method', () => {
      const bill = new Bill(mockBillData);
      const advanceSpy = vi.spyOn(bill, 'advance');

      bill.skip();

      expect(advanceSpy).toHaveBeenCalled();
    });
  });
});

describe('insertBill', () => {
  const testBillData: BillData = {
    id: 'bill-1',
    name: 'Test Bill',
    category: 'Utilities',
    startDate: '2023-01-15',
    startDateIsVariable: false,
    startDateVariable: null,
    endDate: null,
    endDateIsVariable: false,
    endDateVariable: null,
    everyN: 1,
    periods: 'month',
    annualStartDate: null,
    annualEndDate: null,
    isAutomatic: false,
    amount: 100,
    amountIsVariable: false,
    amountVariable: null,
    increaseBy: 0.03,
    increaseByIsVariable: true,
    increaseByVariable: 'INFLATION',
    increaseByDate: '01/01',
    ceilingMultiple: 0,
    isTransfer: false,
    from: null,
    to: null,
    flagColor: null,
    flag: false,
  };

  it('should add activity to account for non-transfer bills', () => {
    const mockAccount = {
      activity: [],
    } as Account;

    const mockAccountsAndTransfers = {
      transfers: { activity: [] },
    } as AccountsAndTransfers;

    const mockBill = new Bill(testBillData);
    const mockActivityData = {
      id: 'activity-1',
      name: 'Test Activity',
      category: 'Utilities',
      amount: 100,
      amountIsVariable: false,
      amountVariable: null,
      date: '2023-01-15',
      dateIsVariable: false,
      dateVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: false,
      from: null,
      to: null,
    };

    insertBill(mockAccountsAndTransfers, mockAccount, mockBill, mockActivityData, false);

    expect(mockAccount.activity).toHaveLength(1);
    expect(mockAccountsAndTransfers.transfers.activity).toHaveLength(0);
  });

  it('should add activity to transfers for transfer bills', () => {
    const mockAccount = {
      activity: [],
    } as Account;

    const mockAccountsAndTransfers = {
      transfers: { activity: [] },
    } as AccountsAndTransfers;

    const mockBill = new Bill(testBillData);
    const mockActivityData = {
      id: 'activity-1',
      name: 'Test Transfer',
      category: 'Transfer',
      amount: 100,
      amountIsVariable: false,
      amountVariable: null,
      date: '2023-01-15',
      dateIsVariable: false,
      dateVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: true,
      from: 'account-1',
      to: 'account-2',
    };

    insertBill(mockAccountsAndTransfers, mockAccount, mockBill, mockActivityData, true);

    expect(mockAccount.activity).toHaveLength(0);
    expect(mockAccountsAndTransfers.transfers.activity).toHaveLength(1);
  });

  it('should handle special amount variables', () => {
    const mockAccount = {
      activity: [],
    } as Account;

    const mockAccountsAndTransfers = {
      transfers: { activity: [] },
    } as AccountsAndTransfers;

    const mockBill = new Bill(testBillData);
    const mockActivityData = {
      id: 'activity-1',
      name: 'Test Activity',
      category: 'Utilities',
      amount: 100,
      amountIsVariable: true,
      amountVariable: '{HALF}',
      date: '2023-01-15',
      dateIsVariable: false,
      dateVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: false,
      from: null,
      to: null,
    };

    insertBill(mockAccountsAndTransfers, mockAccount, mockBill, mockActivityData, false);

    expect(mockActivityData.amountIsVariable).toBe(false);
    expect(mockActivityData.amountVariable).toBe(null);
  });
});
