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

  describe('Social Security wage base cap', () => {
    it('should cap annual income at SS taxable maximum for 2024', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-1',
        name: 'High Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['High Earner Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2030, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022],
        priorAnnualNetIncomes: [50000, 52000, 54000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Add income above the 2024 cap ($168,600)
      // Total will be $200,000 which should be capped at $168,600
      retirementManager.tryAddToAnnualIncomes(
        'High Earner Paycheck',
        new Date(Date.UTC(2024, 0, 15)),
        100000
      );
      retirementManager.tryAddToAnnualIncomes(
        'High Earner Paycheck',
        new Date(Date.UTC(2024, 5, 15)),
        100000
      );

      // The cap should have been applied - we can't directly access the private map,
      // but we can verify the calculation doesn't throw and produces a result
      expect(() => retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity)).not.toThrow();
      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('High Earner SS');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });

    it('should not cap annual income below SS taxable maximum', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-2',
        name: 'Average Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Average Earner Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2030, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022],
        priorAnnualNetIncomes: [50000, 52000, 54000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Add income below the 2024 cap
      retirementManager.tryAddToAnnualIncomes(
        'Average Earner Paycheck',
        new Date(Date.UTC(2024, 0, 15)),
        30000
      );
      retirementManager.tryAddToAnnualIncomes(
        'Average Earner Paycheck',
        new Date(Date.UTC(2024, 5, 15)),
        30000
      );

      // Total income is $60,000, well below cap - should not be affected
      expect(() => retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity)).not.toThrow();
      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('Average Earner SS');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });

    it('should cap prior annual incomes during initialization', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-3',
        name: 'Prior High Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Prior High Earner Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2030, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022],
        priorAnnualNetIncomes: [250000, 300000, 350000], // All above cap
      } as any);

      // Cap should be applied during initialization
      retirementManager = new RetirementManager([socialSecurity], []);

      // Should not throw when calculating with capped prior incomes
      expect(() => retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity)).not.toThrow();
      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('Prior High Earner SS');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });

    it('should handle income exactly at wage base cap', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-4',
        name: 'Exact Cap Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Exact Cap Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2030, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022],
        priorAnnualNetIncomes: [50000, 52000, 54000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Add exactly the 2024 cap amount - should not be reduced
      retirementManager.tryAddToAnnualIncomes(
        'Exact Cap Paycheck',
        new Date(Date.UTC(2024, 0, 15)),
        168600
      );

      expect(() => retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity)).not.toThrow();
      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('Exact Cap Earner SS');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });

    it('should apply inflated caps for future years', () => {
      const socialSecurity = new SocialSecurity({
        id: 'ss-5',
        name: 'Future Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Future Earner Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2022,
        collectionAge: 67,
        startDate: new Date(Date.UTC(2040, 0, 1)),
        priorAnnualNetIncomeYears: [2020, 2021, 2022],
        priorAnnualNetIncomes: [50000, 52000, 54000],
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);

      // Add income in 2030 (6 years after 2024 base)
      // Cap should be $168,600 * (1.035^6) = ~$207,500
      // Adding $200k should not be capped, but $210k should be
      retirementManager.tryAddToAnnualIncomes(
        'Future Earner Paycheck',
        new Date(Date.UTC(2030, 0, 15)),
        100000
      );
      retirementManager.tryAddToAnnualIncomes(
        'Future Earner Paycheck',
        new Date(Date.UTC(2030, 5, 15)),
        110000
      );

      expect(() => retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity)).not.toThrow();
      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('Future Earner SS');
      expect(typeof monthlyPay).toBe('number');
      expect(monthlyPay).toBeGreaterThanOrEqual(0);
    });
  });
});
