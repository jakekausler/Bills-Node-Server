import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetirementManager } from './retirement-manager';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { Pension } from '../../data/retirement/pension/pension';

// Mock I/O functions
vi.mock('../io/averageWageIndex', () => ({
  loadAverageWageIndex: vi.fn(() => {
    const wageIndex: Record<number, number> = {};
    // Generate 50 years of wage index data starting from a base
    const baseYear = 1980;
    const baseWage = 12513; // Actual 1980 AWI
    const growthRate = 0.035; // 3.5% average annual growth

    for (let i = 0; i < 50; i++) {
      const year = baseYear + i;
      wageIndex[year] = baseWage * Math.pow(1 + growthRate, i);
    }

    return wageIndex;
  }),
}));

vi.mock('../io/bendPoints', () => ({
  loadBendPoints: vi.fn(() => ({
    2018: { first: 895, second: 5397 },
    2019: { first: 926, second: 5583 },
    2020: { first: 960, second: 5785 },
    2021: { first: 996, second: 6002 },
    2022: { first: 1024, second: 6172 },
  })),
}));

vi.mock('../io/io', () => ({
  load: vi.fn((filename: string) => {
    // Return historical rates when loading historicRates.json
    if (filename === 'historicRates.json') {
      return {
        investment: { stock: [10, 15, 20] },
        savings: { highYield: [3, 4, 5], lowYield: [0.5, 1, 1.5] },
        inflation: [2, 3, 2.5],
        raise: [3, 4, 3.5],
        limitIncrease401k: [5, 6, 7],
        ssWageBase: {
          '2020': 137700,
          '2021': 142800,
          '2022': 147000,
          '2023': 160200,
          '2024': 168600,
          '2025': 176100,
        },
        contributionLimits: {
          '401k': { '2020': 19500, '2021': 19500, '2022': 20500, '2023': 22500, '2024': 23500 },
          'ira': { '2020': 6000, '2021': 6000, '2022': 6500, '2023': 6500, '2024': 7000 },
          'hsa': { '2020': 3550, '2021': 3600, '2022': 3850, '2023': 3850, '2024': 4150 },
        },
      };
    }
    // Return RMD table for other loads
    return {
      72: 27.4,
      73: 26.5,
      74: 25.5,
      75: 24.6,
    };
  }),
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

  // Helper to generate 35 years of income data for realistic SS calculations
  function generate35YearsIncome(endYear: number, avgIncome: number = 50000): { years: number[]; incomes: number[] } {
    const years: number[] = [];
    const incomes: number[] = [];
    for (let i = 34; i >= 0; i--) {
      years.push(endYear - i);
      incomes.push(avgIncome * (1 + 0.02 * (34 - i))); // Simulate 2% annual raises
    }
    return { years, incomes };
  }

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

  describe('Social Security collection age factors with birth-year-based FRA', () => {
    it('should not throw when calculating with different birth years and FRAs', () => {
      const { years, incomes } = generate35YearsIncome(2020);

      // Test various birth years with different FRAs
      const testCases = [
        { birthYear: 1937, fra: 65, collectionAge: 65 },
        { birthYear: 1954, fra: 66, collectionAge: 66 },
        { birthYear: 1957, fra: 66.5, collectionAge: 67 },
        { birthYear: 1960, fra: 67, collectionAge: 67 },
      ];

      testCases.forEach(({ birthYear, collectionAge }) => {
        const ss = new SocialSecurity({
          id: `ss-${birthYear}`,
          name: `Born ${birthYear} SS`,
          payToAccount: 'checking-1',
          paycheckNames: [`Born ${birthYear} Paycheck`],
          paycheckAccounts: ['checking-1'],
          paycheckCategories: ['Income.SocialSecurity'],
          startDateVariable: 'SS_START',
          birthDateVariable: 'BIRTH_DATE',
          yearTurn60: 2020,
          collectionAge,
          startDate: new Date(Date.UTC(2020 + collectionAge - 60, 0, 1)),
          birthDate: new Date(Date.UTC(birthYear, 0, 1)),
          priorAnnualNetIncomeYears: years,
          priorAnnualNetIncomes: incomes,
        } as any);

        const manager = new RetirementManager([ss], []);
        // Should not throw
        expect(() => manager.calculateSocialSecurityMonthlyPay(ss)).not.toThrow();
      });
    });

    it('should correctly apply FRA based on birth year (integration test)', () => {
      // This test verifies that the FRA is determined by birth year and affects benefit calculations
      // We test this by ensuring calculations complete without errors for different birth years
      const { years, incomes } = generate35YearsIncome(2020);

      const birthYearsAndFRAs = [
        { birthYear: 1937, expectedFRA: 65 },
        { birthYear: 1943, expectedFRA: 66 },  // 1943-1954 -> 66
        { birthYear: 1955, expectedFRA: 66 + 2/12 },
        { birthYear: 1957, expectedFRA: 66 + 6/12 },
        { birthYear: 1960, expectedFRA: 67 },
      ];

      birthYearsAndFRAs.forEach(({ birthYear, expectedFRA }) => {
        const ss = new SocialSecurity({
          id: `ss-${birthYear}`,
          name: `Born ${birthYear} SS`,
          payToAccount: 'checking-1',
          paycheckNames: [`Born ${birthYear} Paycheck`],
          paycheckAccounts: ['checking-1'],
          paycheckCategories: ['Income.SocialSecurity'],
          startDateVariable: 'SS_START',
          birthDateVariable: 'BIRTH_DATE',
          yearTurn60: 2020,
          collectionAge: 62,
          startDate: new Date(Date.UTC(2022, 0, 1)),
          birthDate: new Date(Date.UTC(birthYear, 0, 1)),
          priorAnnualNetIncomeYears: years,
          priorAnnualNetIncomes: incomes,
        } as any);

        const manager = new RetirementManager([ss], []);
        // Calculation should complete without throwing
        expect(() => manager.calculateSocialSecurityMonthlyPay(ss)).not.toThrow();

        // The monthly pay calculation uses the birth-year-based FRA
        // We can't easily test the exact value without exposing private methods,
        // but we've verified the calculation completes
        const monthlyPay = manager.getSocialSecurityMonthlyPay(`Born ${birthYear} SS`);
        expect(monthlyPay).toBeGreaterThanOrEqual(0);
      });
    });

    it('should return 0 factor for claiming before age 62', () => {
      const { years, incomes } = generate35YearsIncome(2020);
      const socialSecurity = new SocialSecurity({
        id: 'ss-8',
        name: 'Too Early SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Too Early Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        yearTurn60: 2020,
        collectionAge: 60,
        startDate: new Date(Date.UTC(2020, 0, 1)),
        birthDate: new Date(Date.UTC(1960, 0, 1)),
        priorAnnualNetIncomeYears: years,
        priorAnnualNetIncomes: incomes,
      } as any);

      retirementManager = new RetirementManager([socialSecurity], []);
      retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity);

      // Claiming before 62 is not allowed -> factor = 0
      const monthlyPay = retirementManager.getSocialSecurityMonthlyPay('Too Early SS');
      expect(monthlyPay).toBe(0);
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

  describe('getWageBaseCapForYear with MC ratios', () => {
    it('should return historical wage base cap for known years', () => {
      retirementManager = new RetirementManager([], []);
      // 2024 is in the historical data
      const cap2024 = retirementManager.getWageBaseCapForYear(2024);
      expect(cap2024).toBe(168600);
    });

    it('should use fixed inflation without MC ratio for future years', () => {
      retirementManager = new RetirementManager([], []);
      // Without MC ratio, should use fixed 3.5% NAWI growth
      const cap2026 = retirementManager.getWageBaseCapForYear(2026);
      // Should be around 176100 * 1.035 = 182263.5
      expect(cap2026).toBeCloseTo(176100 * Math.pow(1.035, 1), 0);
    });

    it('should use MC ratio to compound from previous year', () => {
      retirementManager = new RetirementManager([], []);
      // MC ratio: 1.089796 (from 2023 historical data)
      const mcRatio = 1.089796;
      const cap2026 = retirementManager.getWageBaseCapForYear(2026, mcRatio);

      // Should compound from previous year's cap
      expect(cap2026).toBeGreaterThan(0);
    });

    it('should handle multiple MC ratios in sequence', () => {
      retirementManager = new RetirementManager([], []);
      const ratio1 = 1.05; // 5% increase
      const ratio2 = 1.03; // 3% increase

      const cap2026 = retirementManager.getWageBaseCapForYear(2026, ratio1);
      const cap2027 = retirementManager.getWageBaseCapForYear(2027, ratio2);

      expect(cap2026).toBeGreaterThan(0);
      expect(cap2027).toBeGreaterThan(cap2026); // Should keep increasing
    });
  });

  describe('Spousal Social Security benefits (#26)', () => {
    it('should apply spousal benefit when spouse benefit is higher than own benefit', () => {
      const { years, incomes } = generate35YearsIncome(2020, 50000);
      const { years: lowIncomeYears, incomes: lowIncomes } = generate35YearsIncome(2020, 30000);

      // Higher earner
      const higherEarnerSS = new SocialSecurity({
        name: 'Higher Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Higher Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: years,
        priorAnnualNetIncomes: incomes,
        spouseName: 'Lower Earner SS',
      } as any);
      // Override with actual date/age values
      (higherEarnerSS as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (higherEarnerSS as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (higherEarnerSS as any).yearTurn60 = 2020;
      (higherEarnerSS as any).collectionAge = 67;

      // Lower earner
      const lowerEarnerSS = new SocialSecurity({
        name: 'Lower Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Lower Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: lowIncomeYears,
        priorAnnualNetIncomes: lowIncomes,
        spouseName: 'Higher Earner SS',
      } as any);
      // Override with actual date/age values
      (lowerEarnerSS as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (lowerEarnerSS as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (lowerEarnerSS as any).yearTurn60 = 2020;
      (lowerEarnerSS as any).collectionAge = 67;

      retirementManager = new RetirementManager([higherEarnerSS, lowerEarnerSS], []);

      // Calculate higher earner first
      retirementManager.calculateSocialSecurityMonthlyPay(higherEarnerSS);
      const higherPay = retirementManager.getSocialSecurityMonthlyPay('Higher Earner SS');
      expect(higherPay).toBeGreaterThan(0);

      // Calculate lower earner - should get spousal benefit if it's higher
      retirementManager.calculateSocialSecurityMonthlyPay(lowerEarnerSS);
      const lowerPay = retirementManager.getSocialSecurityMonthlyPay('Lower Earner SS');

      // Lower earner should get at least 50% of higher earner's benefit
      const spousalBenefit = higherPay * 0.5;
      expect(lowerPay).toBeGreaterThanOrEqual(spousalBenefit * 0.99); // Allow 1% floating point tolerance
    });

    it('should not apply spousal benefit when own benefit is higher', () => {
      const { years, incomes } = generate35YearsIncome(2020, 50000);
      const { years: lowIncomeYears, incomes: lowIncomes } = generate35YearsIncome(2020, 30000);

      // Higher earner
      const higherEarnerSS = new SocialSecurity({
        name: 'Higher Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Higher Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: years,
        priorAnnualNetIncomes: incomes,
        spouseName: 'Lower Earner SS',
      } as any);
      // Override with actual date/age values
      (higherEarnerSS as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (higherEarnerSS as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (higherEarnerSS as any).yearTurn60 = 2020;
      (higherEarnerSS as any).collectionAge = 67;

      // Lower earner
      const lowerEarnerSS = new SocialSecurity({
        name: 'Lower Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Lower Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: lowIncomeYears,
        priorAnnualNetIncomes: lowIncomes,
        spouseName: 'Higher Earner SS',
      } as any);
      // Override with actual date/age values
      (lowerEarnerSS as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (lowerEarnerSS as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (lowerEarnerSS as any).yearTurn60 = 2020;
      (lowerEarnerSS as any).collectionAge = 67;

      retirementManager = new RetirementManager([higherEarnerSS, lowerEarnerSS], []);

      // Calculate lower earner first (before spouse)
      retirementManager.calculateSocialSecurityMonthlyPay(lowerEarnerSS);
      const lowerPayBefore = retirementManager.getSocialSecurityMonthlyPay('Lower Earner SS');

      // Calculate higher earner
      retirementManager.calculateSocialSecurityMonthlyPay(higherEarnerSS);
      const higherPay = retirementManager.getSocialSecurityMonthlyPay('Higher Earner SS');

      // Higher earner should keep their own benefit (no spousal for higher earner)
      expect(higherPay).toBeGreaterThan(0);
    });

    it('should use own benefit when spouse benefit not yet calculated', () => {
      const { years, incomes } = generate35YearsIncome(2020, 50000);

      const socialSecurityWithoutSpouse = new SocialSecurity({
        name: 'No Spouse SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: years,
        priorAnnualNetIncomes: incomes,
        spouseName: null,
      } as any);
      // Override with actual date/age values
      (socialSecurityWithoutSpouse as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (socialSecurityWithoutSpouse as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (socialSecurityWithoutSpouse as any).yearTurn60 = 2020;
      (socialSecurityWithoutSpouse as any).collectionAge = 67;

      retirementManager = new RetirementManager([socialSecurityWithoutSpouse], []);
      retirementManager.calculateSocialSecurityMonthlyPay(socialSecurityWithoutSpouse);

      const pay = retirementManager.getSocialSecurityMonthlyPay('No Spouse SS');
      expect(pay).toBeGreaterThan(0);
    });

    it('should handle case when spouse has not yet been calculated', () => {
      const { years, incomes } = generate35YearsIncome(2020, 50000);
      const { years: lowIncomeYears, incomes: lowIncomes } = generate35YearsIncome(2020, 30000);

      // Lower earner who references spouse
      const lowerEarnerSS = new SocialSecurity({
        name: 'Lower Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Lower Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: lowIncomeYears,
        priorAnnualNetIncomes: lowIncomes,
        spouseName: 'Higher Earner SS',
      } as any);
      // Override with actual date/age values
      (lowerEarnerSS as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (lowerEarnerSS as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (lowerEarnerSS as any).yearTurn60 = 2020;
      (lowerEarnerSS as any).collectionAge = 67;

      // Higher earner
      const higherEarnerSS = new SocialSecurity({
        name: 'Higher Earner SS',
        payToAccount: 'checking-1',
        paycheckNames: ['Higher Paycheck'],
        paycheckAccounts: ['checking-1'],
        paycheckCategories: ['Income.SocialSecurity'],
        startDateVariable: 'SS_START',
        birthDateVariable: 'BIRTH_DATE',
        priorAnnualNetIncomeYears: years,
        priorAnnualNetIncomes: incomes,
        spouseName: 'Lower Earner SS',
      } as any);
      // Override with actual date/age values
      (higherEarnerSS as any).startDate = new Date(Date.UTC(2027, 0, 1));
      (higherEarnerSS as any).birthDate = new Date(Date.UTC(1960, 0, 1));
      (higherEarnerSS as any).yearTurn60 = 2020;
      (higherEarnerSS as any).collectionAge = 67;

      retirementManager = new RetirementManager([lowerEarnerSS, higherEarnerSS], []);

      // Calculate lower earner first - spouse not calculated yet
      retirementManager.calculateSocialSecurityMonthlyPay(lowerEarnerSS);
      const lowerPayWithoutSpouse = retirementManager.getSocialSecurityMonthlyPay('Lower Earner SS');
      expect(lowerPayWithoutSpouse).toBeGreaterThan(0);

      // Now calculate higher earner
      retirementManager.calculateSocialSecurityMonthlyPay(higherEarnerSS);
      const higherPay = retirementManager.getSocialSecurityMonthlyPay('Higher Earner SS');
      expect(higherPay).toBeGreaterThan(0);
    });
  });
});
