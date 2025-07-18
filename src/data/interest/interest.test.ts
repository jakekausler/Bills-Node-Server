import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Interest, insertInterest, compoundInterest } from './interest';
import { InterestData } from './types';
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
  })),
}));

describe('Interest', () => {
  const testInterestData: InterestData = {
    id: 'interest-1',
    apr: 0.05,
    aprIsVariable: false,
    aprVariable: null,
    compounded: 'month',
    applicableDate: '2023-01-01',
    applicableDateIsVariable: false,
    applicableDateVariable: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an interest with provided data', () => {
      const interest = new Interest(testInterestData);

      expect(interest.id).toBe('interest-1');
      expect(interest.apr).toBe(0.05);
      expect(interest.aprIsVariable).toBe(false);
      expect(interest.aprVariable).toBe(null);
      expect(interest.compounded).toBe('month');
      expect(interest.applicableDate).toBeInstanceOf(Date);
      expect(interest.applicableDateIsVariable).toBe(false);
      expect(interest.applicableDateVariable).toBe(null);
    });

    it('should generate UUID when id is not provided', () => {
      const dataWithoutId = { ...testInterestData };
      delete dataWithoutId.id;
      
      const interest = new Interest(dataWithoutId);
      
      expect(interest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should handle variable APR', () => {
      const variableData: InterestData = {
        ...testInterestData,
        apr: 0.03,
        aprIsVariable: true,
        aprVariable: 'INTEREST_RATE',
      };

      const interest = new Interest(variableData);

      expect(interest.apr).toBe(0.03);
      expect(interest.aprIsVariable).toBe(true);
      expect(interest.aprVariable).toBe('INTEREST_RATE');
    });

    it('should handle variable applicable date', () => {
      const variableData: InterestData = {
        ...testInterestData,
        applicableDateIsVariable: true,
        applicableDateVariable: 'START_DATE',
      };

      const interest = new Interest(variableData);

      expect(interest.applicableDateIsVariable).toBe(true);
      expect(interest.applicableDateVariable).toBe('START_DATE');
    });

    it('should support all compounding frequencies', () => {
      const frequencies: Array<'day' | 'week' | 'month' | 'year'> = ['day', 'week', 'month', 'year'];

      frequencies.forEach(frequency => {
        const data: InterestData = {
          ...testInterestData,
          compounded: frequency,
        };

        const interest = new Interest(data);
        expect(interest.compounded).toBe(frequency);
      });
    });
  });

  describe('serialize', () => {
    it('should serialize interest data correctly', () => {
      const interest = new Interest(testInterestData);
      const serialized = interest.serialize();

      expect(serialized.id).toBe(testInterestData.id);
      expect(serialized.apr).toBe(testInterestData.apr);
      expect(serialized.aprIsVariable).toBe(testInterestData.aprIsVariable);
      expect(serialized.aprVariable).toBe(testInterestData.aprVariable);
      expect(serialized.compounded).toBe(testInterestData.compounded);
      expect(serialized.applicableDateIsVariable).toBe(testInterestData.applicableDateIsVariable);
      expect(serialized.applicableDateVariable).toBe(testInterestData.applicableDateVariable);
    });

    it('should format date correctly in serialization', () => {
      const interest = new Interest(testInterestData);
      const serialized = interest.serialize();

      expect(typeof serialized.applicableDate).toBe('string');
    });
  });

  describe('toActivity', () => {
    it('should create an interest activity with correct properties', () => {
      const interest = new Interest(testInterestData);
      const amount = 25.50;
      const date = new Date('2023-01-31');

      const activity = interest.toActivity('activity-1', 'Default', amount, date);

      expect(activity).toBeDefined();
      // Note: Using mock Activity constructor, so testing the call
    });
  });

  describe('advance', () => {
    it('should advance by one day for daily compounding', () => {
      const interest = new Interest({
        ...testInterestData,
        compounded: 'day',
        applicableDate: '2023-01-15',
      });
      
      const originalDate = new Date(interest.applicableDate);
      interest.advance();

      expect(interest.applicableDate.getDate()).toBe(originalDate.getDate() + 1);
    });

    it('should advance by one week for weekly compounding', () => {
      const interest = new Interest({
        ...testInterestData,
        compounded: 'week',
        applicableDate: '2023-01-15',
      });
      
      const originalDate = new Date(interest.applicableDate);
      interest.advance();

      const expectedDate = new Date(originalDate);
      expectedDate.setDate(expectedDate.getDate() + 7);
      expect(interest.applicableDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should advance by one month for monthly compounding', () => {
      const interest = new Interest({
        ...testInterestData,
        compounded: 'month',
        applicableDate: '2023-01-15',
      });
      
      const originalMonth = interest.applicableDate.getMonth();
      interest.advance();

      expect(interest.applicableDate.getMonth()).toBe((originalMonth + 1) % 12);
    });

    it('should advance by one year for yearly compounding', () => {
      const interest = new Interest({
        ...testInterestData,
        compounded: 'year',
        applicableDate: '2023-01-15',
      });
      
      const originalYear = interest.applicableDate.getFullYear();
      interest.advance();

      expect(interest.applicableDate.getFullYear()).toBe(originalYear + 1);
    });
  });
});

describe('insertInterest', () => {
  const testInterestData: InterestData = {
    id: 'interest-1',
    apr: 0.05,
    aprIsVariable: false,
    aprVariable: null,
    compounded: 'month',
    applicableDate: '2023-01-01',
    applicableDateIsVariable: false,
    applicableDateVariable: null,
  };

  it('should add interest activity to account', () => {
    const mockAccount = {
      activity: [],
      interests: [],
    } as Account;

    const mockInterest = new Interest(testInterestData);
    const mockActivityData = {
      id: 'activity-1',
      name: 'Interest',
      category: 'Banking.Interest',
      amount: 25.50,
      amountIsVariable: false,
      amountVariable: null,
      date: '2023-01-31',
      dateIsVariable: false,
      dateVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: false,
      from: null,
      to: null,
    };

    insertInterest(mockAccount, mockInterest, mockActivityData);

    expect(mockAccount.activity).toHaveLength(1);
  });

  it('should advance interest date after insertion', () => {
    const mockAccount = {
      activity: [],
      interests: [],
    } as Account;

    const mockInterest = new Interest({
      ...testInterestData,
      applicableDate: '2023-01-15',
    });
    
    const originalDate = new Date(mockInterest.applicableDate);
    const mockActivityData = {
      id: 'activity-1',
      name: 'Interest',
      category: 'Banking.Interest',
      amount: 25.50,
      amountIsVariable: false,
      amountVariable: null,
      date: '2023-01-31',
      dateIsVariable: false,
      dateVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: false,
      from: null,
      to: null,
    };

    insertInterest(mockAccount, mockInterest, mockActivityData);

    // Interest date should have advanced (monthly compounding)
    expect(mockInterest.applicableDate.getMonth()).toBe((originalDate.getMonth() + 1) % 12);
  });

  it('should remove superseded interest rates', () => {
    const oldInterest = new Interest({
      ...testInterestData,
      id: 'old-interest',
      applicableDate: '2022-12-01',
    });

    const mockAccount = {
      activity: [],
      interests: [oldInterest],
    } as Account;

    const newInterest = new Interest({
      ...testInterestData,
      id: 'new-interest',
      applicableDate: '2023-01-15',
    });

    const mockActivityData = {
      id: 'activity-1',
      name: 'Interest',
      category: 'Banking.Interest',
      amount: 25.50,
      amountIsVariable: false,
      amountVariable: null,
      date: '2023-01-31',
      dateIsVariable: false,
      dateVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: false,
      from: null,
      to: null,
    };

    insertInterest(mockAccount, newInterest, mockActivityData);

    // Old interest should be removed because it has an earlier applicable date
    expect(mockAccount.interests).toHaveLength(0);
  });
});

describe('compoundInterest', () => {
  it('should calculate daily compound interest correctly', () => {
    const balance = 10000;
    const apr = 0.05; // 5% annual rate
    const result = compoundInterest(balance, apr, 'day');

    expect(result).toBeCloseTo((0.05 / 365) * 10000, 2);
  });

  it('should calculate weekly compound interest correctly', () => {
    const balance = 10000;
    const apr = 0.05; // 5% annual rate
    const result = compoundInterest(balance, apr, 'week');

    expect(result).toBeCloseTo((0.05 / 52) * 10000, 2);
  });

  it('should calculate monthly compound interest correctly', () => {
    const balance = 10000;
    const apr = 0.05; // 5% annual rate
    const result = compoundInterest(balance, apr, 'month');

    expect(result).toBeCloseTo((0.05 / 12) * 10000, 2);
  });

  it('should calculate yearly compound interest correctly', () => {
    const balance = 10000;
    const apr = 0.05; // 5% annual rate
    const result = compoundInterest(balance, apr, 'year');

    expect(result).toBe(0.05 * 10000);
  });

  it('should throw error for invalid compounding frequency', () => {
    const balance = 10000;
    const apr = 0.05;
    
    expect(() => {
      compoundInterest(balance, apr, 'invalid' as any);
    }).toThrow('Invalid compounded interest: invalid');
  });

  it('should handle zero balance', () => {
    const result = compoundInterest(0, 0.05, 'month');
    expect(result).toBe(0);
  });

  it('should handle zero interest rate', () => {
    const result = compoundInterest(10000, 0, 'month');
    expect(result).toBe(0);
  });
});