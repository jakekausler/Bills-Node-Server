import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPensionsAndSocialSecurity } from './retirement';
import { load } from './io';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';

// Mock the io module
vi.mock('./io');

// Mock the Pension and SocialSecurity classes
vi.mock('../../data/retirement/pension/pension');
vi.mock('../../data/retirement/socialSecurity/socialSecurity');

describe('Retirement IO Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadPensionsAndSocialSecurity', () => {
    it('should load pensions and social securities from pension_and_social_security.json', () => {
      const mockData = {
        pensions: [
          {
            name: 'Military Pension',
            payToAccount: 'Checking',
            paycheckNames: ['Pension Payment'],
            paycheckAccounts: ['Checking'],
            paycheckCategories: ['Income'],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'workStartDate',
            priorAnnualNetIncomes: [50000, 55000],
            priorAnnualNetIncomeYears: [2022, 2023],
            unreducedRequirements: [{ yearsWorked: 20 }],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 3,
            accrualFactor: 0.025,
            reducedRateByAgeThenYearsOfService: {},
          },
        ],
        socialSecurities: [
          {
            name: 'Social Security',
            payToAccount: 'Savings',
            paycheckNames: ['SS Benefit'],
            paycheckAccounts: ['Savings'],
            paycheckCategories: ['Income'],
            priorAnnualNetIncomes: [60000, 65000, 70000],
            priorAnnualNetIncomeYears: [2021, 2022, 2023],
          },
        ],
      };

      const mockPension = { monthlyBenefit: 3000 };
      const mockSocialSecurity = { startAge: 67 };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension).mockImplementation(() => mockPension as any);
      vi.mocked(SocialSecurity).mockImplementation(() => mockSocialSecurity as any);

      const result = loadPensionsAndSocialSecurity('Default');

      expect(load).toHaveBeenCalledWith('pension_and_social_security.json');
      expect(Pension).toHaveBeenCalledWith(mockData.pensions[0], 'Default');
      expect(SocialSecurity).toHaveBeenCalledWith(mockData.socialSecurities[0]);
      expect(result.pensions).toEqual([mockPension]);
      expect(result.socialSecurities).toEqual([mockSocialSecurity]);
    });

    it('should use Default simulation when no simulation parameter is provided', () => {
      const mockData = {
        pensions: [
          {
            name: 'Pension A',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var3',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 1,
            accrualFactor: 0.02,
            reducedRateByAgeThenYearsOfService: {},
          },
        ],
        socialSecurities: [],
      };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension).mockImplementation(() => ({}) as any);

      loadPensionsAndSocialSecurity();

      expect(Pension).toHaveBeenCalledWith(mockData.pensions[0], 'Default');
    });

    it('should use specified simulation name when provided', () => {
      const mockData = {
        pensions: [],
        socialSecurities: [
          {
            name: 'SS',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
          },
        ],
      };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(SocialSecurity).mockImplementation(() => ({}) as any);

      loadPensionsAndSocialSecurity('Conservative');

      expect(SocialSecurity).toHaveBeenCalledWith(mockData.socialSecurities[0]);
    });

    it('should handle empty pensions and social securities arrays', () => {
      const mockData = {
        pensions: [],
        socialSecurities: [],
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadPensionsAndSocialSecurity();

      expect(result.pensions).toEqual([]);
      expect(result.socialSecurities).toEqual([]);
      expect(Pension).not.toHaveBeenCalled();
      expect(SocialSecurity).not.toHaveBeenCalled();
    });

    it('should handle multiple pensions', () => {
      const mockData = {
        pensions: [
          {
            name: 'Pension 1',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var3',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 1,
            accrualFactor: 0.02,
            reducedRateByAgeThenYearsOfService: {},
          },
          {
            name: 'Pension 2',
            payToAccount: 'Account2',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var6',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 2,
            accrualFactor: 0.03,
            reducedRateByAgeThenYearsOfService: {},
          },
        ],
        socialSecurities: [],
      };

      const mockPension1 = { name: 'Pension 1' };
      const mockPension2 = { name: 'Pension 2' };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension)
        .mockImplementationOnce(() => mockPension1 as any)
        .mockImplementationOnce(() => mockPension2 as any);

      const result = loadPensionsAndSocialSecurity('Default');

      expect(Pension).toHaveBeenCalledTimes(2);
      expect(result.pensions).toEqual([mockPension1, mockPension2]);
    });

    it('should handle multiple social securities', () => {
      const mockData = {
        pensions: [],
        socialSecurities: [
          {
            name: 'SS 1',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
          },
          {
            name: 'SS 2',
            payToAccount: 'Account2',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
          },
        ],
      };

      const mockSS1 = { name: 'SS 1' };
      const mockSS2 = { name: 'SS 2' };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(SocialSecurity)
        .mockImplementationOnce(() => mockSS1 as any)
        .mockImplementationOnce(() => mockSS2 as any);

      const result = loadPensionsAndSocialSecurity('Default');

      expect(SocialSecurity).toHaveBeenCalledTimes(2);
      expect(result.socialSecurities).toEqual([mockSS1, mockSS2]);
    });

    it('should handle complex pension configuration with reduced rates', () => {
      const mockData = {
        pensions: [
          {
            name: 'Complex Pension',
            payToAccount: 'Primary',
            paycheckNames: ['Monthly Payment', 'Special Payment'],
            paycheckAccounts: ['Primary', 'Savings'],
            paycheckCategories: ['Retirement Income', 'Bonus'],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'workStartDate',
            priorAnnualNetIncomes: [40000, 45000, 50000, 55000],
            priorAnnualNetIncomeYears: [2020, 2021, 2022, 2023],
            unreducedRequirements: [
              { age: 62, yearsWorked: 30 },
              { age: 55, yearsWorked: 40 },
            ],
            reducedRequirements: [{ age: 50, yearsWorked: 20 }],
            highestCompensationConsecutiveYearsToAverage: 5,
            accrualFactor: 0.025,
            reducedRateByAgeThenYearsOfService: {
              55: { 20: 0.8, 25: 0.85, 30: 0.9 },
              60: { 20: 0.9, 25: 0.95, 30: 1.0 },
            },
          },
        ],
        socialSecurities: [],
      };

      const mockPension = { monthlyBenefit: 5000 };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension).mockImplementation(() => mockPension as any);

      const result = loadPensionsAndSocialSecurity('Aggressive');

      expect(Pension).toHaveBeenCalledWith(mockData.pensions[0], 'Aggressive');
      expect(result.pensions[0]).toEqual(mockPension);
    });

    it('should handle social security with multiple income years', () => {
      const mockData = {
        pensions: [],
        socialSecurities: [
          {
            name: 'Primary SS',
            payToAccount: 'Checking',
            paycheckNames: ['Monthly Benefit', 'Annual Adjustment'],
            paycheckAccounts: ['Checking', 'Checking'],
            paycheckCategories: ['Benefits', 'Adjustments'],
            priorAnnualNetIncomes: [30000, 35000, 40000, 45000, 50000],
            priorAnnualNetIncomeYears: [2019, 2020, 2021, 2022, 2023],
          },
        ],
      };

      const mockSS = { startAge: 70, monthlyBenefit: 3500 };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(SocialSecurity).mockImplementation(() => mockSS as any);

      const result = loadPensionsAndSocialSecurity('Conservative');

      expect(SocialSecurity).toHaveBeenCalledWith(mockData.socialSecurities[0]);
      expect(result.socialSecurities[0]).toEqual(mockSS);
    });

    it('should load both pensions and social securities together', () => {
      const mockData = {
        pensions: [
          {
            name: 'Pension',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var3',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 1,
            accrualFactor: 0.02,
            reducedRateByAgeThenYearsOfService: {},
          },
          {
            name: 'Pension 2',
            payToAccount: 'Account2',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var6',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 1,
            accrualFactor: 0.02,
            reducedRateByAgeThenYearsOfService: {},
          },
        ],
        socialSecurities: [
          {
            name: 'SS 1',
            payToAccount: 'Account3',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
          },
          {
            name: 'SS 2',
            payToAccount: 'Account4',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
          },
        ],
      };

      const mockPension1 = { name: 'P1' };
      const mockPension2 = { name: 'P2' };
      const mockSS1 = { name: 'S1' };
      const mockSS2 = { name: 'S2' };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension)
        .mockImplementationOnce(() => mockPension1 as any)
        .mockImplementationOnce(() => mockPension2 as any);
      vi.mocked(SocialSecurity)
        .mockImplementationOnce(() => mockSS1 as any)
        .mockImplementationOnce(() => mockSS2 as any);

      const result = loadPensionsAndSocialSecurity('Default');

      expect(Pension).toHaveBeenCalledTimes(2);
      expect(SocialSecurity).toHaveBeenCalledTimes(2);
      expect(result.pensions).toEqual([mockPension1, mockPension2]);
      expect(result.socialSecurities).toEqual([mockSS1, mockSS2]);
    });

    it('should propagate errors thrown by the load function', () => {
      const mockError = new Error('File not found');
      vi.mocked(load).mockImplementation(() => {
        throw mockError;
      });

      expect(() => loadPensionsAndSocialSecurity()).toThrow('File not found');
    });

    it('should propagate errors thrown by Pension constructor', () => {
      const mockData = {
        pensions: [
          {
            name: 'Pension',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var3',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 1,
            accrualFactor: 0.02,
            reducedRateByAgeThenYearsOfService: {},
          },
        ],
        socialSecurities: [],
      };

      const mockError = new Error('Invalid pension data');
      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension).mockImplementation(() => {
        throw mockError;
      });

      expect(() => loadPensionsAndSocialSecurity()).toThrow('Invalid pension data');
    });

    it('should propagate errors thrown by SocialSecurity constructor', () => {
      const mockData = {
        pensions: [],
        socialSecurities: [
          {
            name: 'SS',
            payToAccount: 'Account1',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
          },
        ],
      };

      const mockError = new Error('Invalid social security data');
      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(SocialSecurity).mockImplementation(() => {
        throw mockError;
      });

      expect(() => loadPensionsAndSocialSecurity()).toThrow('Invalid social security data');
    });

    it('should handle different simulation names correctly', () => {
      const mockData = {
        pensions: [
          {
            name: 'Pension',
            payToAccount: 'Account',
            paycheckNames: [],
            paycheckAccounts: [],
            paycheckCategories: [],
            retirementOffset: { years: 0, months: 0 },
            workStartDateVariable: 'var3',
            priorAnnualNetIncomes: [],
            priorAnnualNetIncomeYears: [],
            unreducedRequirements: [],
            reducedRequirements: [],
            highestCompensationConsecutiveYearsToAverage: 1,
            accrualFactor: 0.02,
            reducedRateByAgeThenYearsOfService: {},
          },
        ],
        socialSecurities: [],
      };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension).mockImplementation(() => ({}) as any);

      loadPensionsAndSocialSecurity('Aggressive');
      loadPensionsAndSocialSecurity('Conservative');
      loadPensionsAndSocialSecurity('Custom Scenario');

      expect(Pension).toHaveBeenNthCalledWith(1, mockData.pensions[0], 'Aggressive');
      expect(Pension).toHaveBeenNthCalledWith(2, mockData.pensions[0], 'Conservative');
      expect(Pension).toHaveBeenNthCalledWith(3, mockData.pensions[0], 'Custom Scenario');
    });

    it('should call load with correct filename', () => {
      const mockData = {
        pensions: [],
        socialSecurities: [],
      };

      vi.mocked(load).mockReturnValue(mockData);

      loadPensionsAndSocialSecurity();

      expect(load).toHaveBeenCalledWith('pension_and_social_security.json');
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('should maintain data integrity when creating instances', () => {
      const pensionData = {
        name: 'Test Pension',
        payToAccount: 'TestAccount',
        paycheckNames: ['Payment1'],
        paycheckAccounts: ['Account1'],
        paycheckCategories: ['Category1'],
        retirementOffset: { years: 0, months: 0 },
        workStartDateVariable: 'workVar',
        priorAnnualNetIncomes: [50000],
        priorAnnualNetIncomeYears: [2023],
        unreducedRequirements: [{ yearsWorked: 20 }],
        reducedRequirements: [],
        highestCompensationConsecutiveYearsToAverage: 3,
        accrualFactor: 0.025,
        reducedRateByAgeThenYearsOfService: {},
      };

      const ssData = {
        name: 'Test SS',
        payToAccount: 'TestAccount2',
        paycheckNames: ['SS Payment'],
        paycheckAccounts: ['Account2'],
        paycheckCategories: ['Category2'],
        priorAnnualNetIncomes: [60000],
        priorAnnualNetIncomeYears: [2023],
      };

      const mockData = {
        pensions: [pensionData],
        socialSecurities: [ssData],
      };

      const mockPension = { verified: true };
      const mockSS = { verified: true };

      vi.mocked(load).mockReturnValue(mockData);
      vi.mocked(Pension).mockImplementation(() => mockPension as any);
      vi.mocked(SocialSecurity).mockImplementation(() => mockSS as any);

      loadPensionsAndSocialSecurity('TestSim');

      // Verify exact data was passed
      const pensionCall = vi.mocked(Pension).mock.calls[0];
      expect(pensionCall[0]).toEqual(pensionData);
      expect(pensionCall[1]).toBe('TestSim');

      const ssCall = vi.mocked(SocialSecurity).mock.calls[0];
      expect(ssCall[0]).toEqual(ssData);
    });
  });
});
