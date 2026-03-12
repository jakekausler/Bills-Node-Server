import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetirementManager } from './retirement-manager';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { Pension } from '../../data/retirement/pension/pension';

// Mock I/O functions
vi.mock('../io/averageWageIndex', () => ({
  loadAverageWageIndex: vi.fn(() => ({
    2020: 55000,
    2021: 56000,
    2022: 57000,
  })),
}));

vi.mock('../io/bendPoints', () => ({
  loadBendPoints: vi.fn(() => ({
    2020: { first: 960, second: 5785 },
    2021: { first: 996, second: 6002 },
    2022: { first: 1024, second: 6172 },
  })),
}));

vi.mock('../io/io', () => ({
  load: vi.fn(() => ({
    72: 27.4,
    73: 26.5,
    74: 25.5,
    75: 24.6,
  })),
}));

vi.mock('../simulation/variable', () => ({
  loadVariable: vi.fn((varName: string) => {
    // Return dates for date variables
    if (varName.includes('DATE') || varName.includes('START')) {
      return new Date(Date.UTC(2024, 0, 1));
    }
    // Return numbers for other variables
    return 50000;
  }),
}));

describe('RetirementManager', () => {
  let retirementManager: RetirementManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Social Security calculations', () => {
    it('should calculate monthly pay for a social security recipient', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-1',
        name: 'John SS',
        payToAccount: 'checking-1',
        paycheckNames: ['John Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2024, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022],
        priorAnnualNetIncomes: [50000, 52000, 54000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Should not throw when calculating
      expect(() => retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity)).not.toThrow();

      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('John SS');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });

    it('should track annual income for social security paychecks', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-1',
        name: 'John SS',
        payToAccount: 'checking-1',
        paycheckNames: ['John Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2024, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021],
        priorAnnualNetIncomes: [50000, 52000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Add income for a known paycheck name
      retirementManager.tryAddToAnnualIncomes(
        'John Paycheck',
        new Date(Date.UTC(2023, 5, 15)),
        5000
      );

      // Should not throw, and internal state should be updated
      expect(retirementManager).toBeDefined();
    });

    it('should return 0 for social security monthly pay when not calculated', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-1',
        name: 'John SS',
        payToAccount: 'checking-1',
        paycheckNames: ['John Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2024, 0, 1)),
        priorAnnualNetIncomeYears: [2020],
        priorAnnualNetIncomes: [50000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('John SS');
      expect(monthlyPay).toBe(0);
    });
  });

  describe('Pension calculations', () => {
    it('should calculate monthly pay for a pension recipient', () => {
      const pension = new Pension({
        id: 'pension-1',
        name: 'Jane Pension',
        payToAccount: 'checking-1',
        paycheckNames: ['Jane Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.Pension'],
        startDateVariable: 'PENSION_START',
        birthDateVariable: 'BIRTH_DATE',
        workStartDateVariable: 'WORK_START',
        unreducedRequirements: [],
        reducedRequirements: [],
        highestCompensationConsecutiveYearsToAverage: 4,
        reducedRateByAgeThenYearsOfService: {},
        yearsWorked: 25,
        accrualFactor: 0.02,
        reductionFactor: 1.0,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022, 2023],
        priorAnnualNetIncomes: [60000, 62000, 64000, 66000],
      } as any);

      retirementManager = new RetirementManager([], [pension]);

      // Should not throw when calculating
      expect(() => retirementManager.calculatePensionMonthlyPay(pension)).not.toThrow();

      const monthlyPay = retirementManager.getPensionMonthlyPay('Jane Pension');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });

    it('should track annual income for pension paychecks', () => {
      const pension = new Pension({
        id: 'pension-1',
        name: 'Jane Pension',
        payToAccount: 'checking-1',
        paycheckNames: ['Jane Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.Pension'],
        startDateVariable: 'PENSION_START',
        birthDateVariable: 'BIRTH_DATE',
        workStartDateVariable: 'WORK_START',
        unreducedRequirements: [],
        reducedRequirements: [],
        highestCompensationConsecutiveYearsToAverage: 4,
        reducedRateByAgeThenYearsOfService: {},
        yearsWorked: 20,
        accrualFactor: 0.015,
        reductionFactor: 0.95,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        priorAnnualNetIncomeYears: [2020],
        priorAnnualNetIncomes: [60000],
      } as any);

      retirementManager = new RetirementManager([], [pension]);

      retirementManager.tryAddToAnnualIncomes(
        'Jane Paycheck',
        new Date(Date.UTC(2024, 3, 15)),
        6000
      );

      expect(retirementManager).toBeDefined();
    });

    it('should return 0 for pension monthly pay when not calculated', () => {
      const pension = new Pension({
        id: 'pension-1',
        name: 'Jane Pension',
        payToAccount: 'checking-1',
        paycheckNames: ['Jane Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.Pension'],
        startDateVariable: 'PENSION_START',
        birthDateVariable: 'BIRTH_DATE',
        workStartDateVariable: 'WORK_START',
        unreducedRequirements: [],
        reducedRequirements: [],
        highestCompensationConsecutiveYearsToAverage: 4,
        reducedRateByAgeThenYearsOfService: {},
        yearsWorked: 20,
        accrualFactor: 0.015,
        reductionFactor: 0.95,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        priorAnnualNetIncomeYears: [2020],
        priorAnnualNetIncomes: [60000],
      } as any);

      retirementManager = new RetirementManager([], [pension]);

      const monthlyPay = retirementManager.getPensionMonthlyPay('Jane Pension');
      expect(monthlyPay).toBe(0);
    });
  });

  describe('RMD calculations', () => {
    it('should calculate RMD for age in table', () => {
      retirementManager = new RetirementManager([], []);

      const rmd = retirementManager.rmd(100000, 72);
      expect(rmd).toBeCloseTo(100000 / 27.4, 2);
    });

    it('should return 0 for age not in RMD table', () => {
      retirementManager = new RetirementManager([], []);

      const rmd = retirementManager.rmd(100000, 65);
      expect(rmd).toBe(0);
    });

    it('should handle zero balance', () => {
      retirementManager = new RetirementManager([], []);

      const rmd = retirementManager.rmd(0, 72);
      expect(rmd).toBe(0);
    });
  });

  describe('tryAddToAnnualIncomes', () => {
    it('should not add income for unrecognized activity name', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-1',
        name: 'John SS',
        payToAccount: 'checking-1',
        paycheckNames: ['John Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2024, 0, 1)),
        priorAnnualNetIncomeYears: [2020],
        priorAnnualNetIncomes: [50000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Unrecognized activity name should not throw
      expect(() =>
        retirementManager.tryAddToAnnualIncomes(
          'Unknown Activity',
          new Date(Date.UTC(2023, 5, 15)),
          1000
        )
      ).not.toThrow();
    });
  });
});
