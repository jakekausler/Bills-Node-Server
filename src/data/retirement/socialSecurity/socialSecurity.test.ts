import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocialSecurity } from './socialSecurity';
import { SocialSecurityData } from './types';
import { loadVariable } from '../../../utils/simulation/variable';

// Mock dependencies
vi.mock('../../../utils/simulation/variable');

const mockLoadVariable = vi.mocked(loadVariable);

describe('SocialSecurity', () => {
  const mockSocialSecurityData: SocialSecurityData = {
    name: 'Test Social Security',
    payToAcccount: 'account-123',
    paycheckNames: ['Social Security Payment'],
    paycheckAccounts: ['account-123'],
    paycheckCategories: ['Income'],
    startDateVariable: 'retirementDate',
    birthDateVariable: 'birthDate',
    priorAnnualNetIncomes: [50000, 52000, 54000, 56000, 58000],
    priorAnnualNetIncomeYears: [2019, 2020, 2021, 2022, 2023]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a SocialSecurity instance with provided data', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.name).toBe('Test Social Security');
      expect(socialSecurity.payToAcccount).toBe('account-123');
      expect(socialSecurity.paycheckNames).toEqual(['Social Security Payment']);
      expect(socialSecurity.paycheckAccounts).toEqual(['account-123']);
      expect(socialSecurity.paycheckCategories).toEqual(['Income']);
      expect(socialSecurity.startDateVariable).toBe('retirementDate');
      expect(socialSecurity.birthDateVariable).toBe('birthDate');
      expect(socialSecurity.priorAnnualNetIncomes).toEqual([50000, 52000, 54000, 56000, 58000]);
      expect(socialSecurity.priorAnnualNetIncomeYears).toEqual([2019, 2020, 2021, 2022, 2023]);
    });

    it('should load variables using the simulation parameter', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      new SocialSecurity(mockSocialSecurityData, 'CustomSimulation');

      expect(mockLoadVariable).toHaveBeenCalledWith('retirementDate', 'CustomSimulation');
      expect(mockLoadVariable).toHaveBeenCalledWith('birthDate', 'CustomSimulation');
    });

    it('should use default simulation when none provided', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      new SocialSecurity(mockSocialSecurityData);

      expect(mockLoadVariable).toHaveBeenCalledWith('retirementDate', 'Default');
      expect(mockLoadVariable).toHaveBeenCalledWith('birthDate', 'Default');
    });

    it('should set loaded dates correctly', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.startDate).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(socialSecurity.birthDate).toEqual(new Date('1960-01-01T00:00:00Z'));
    });

    it('should initialize calculated properties to null', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.average35YearPayInflationAdjusted).toBeNull();
      expect(socialSecurity.monthlyPay).toBeNull();
    });

    it('should calculate startAge correctly', () => {
      // Birth date: 1960-01-01, Start date: 2024-01-01 = 64 years
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.startAge).toBe(64);
    });

    it('should calculate yearTurn60 correctly', () => {
      // Birth date: 1960-01-01, turns 60 in 2020
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.yearTurn60).toBe(2020);
    });

    it('should calculate collectionAge correctly', () => {
      // Start date: 2024-01-01, Birth date: 1960-01-01 = age 64
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.collectionAge).toBe(64);
    });

    it('should handle different birth and start dates', () => {
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2030-06-15T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1965-03-20T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(Math.floor(socialSecurity.startAge)).toBe(65); // 2030 - 1965 = 65
      expect(socialSecurity.yearTurn60).toBe(2025); // 1965 + 60 = 2025
      expect(Math.floor(socialSecurity.collectionAge)).toBe(65);
    });

    it('should handle empty arrays for income data', () => {
      const dataWithEmptyArrays = {
        ...mockSocialSecurityData,
        priorAnnualNetIncomes: [],
        priorAnnualNetIncomeYears: []
      };

      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(dataWithEmptyArrays);

      expect(socialSecurity.priorAnnualNetIncomes).toEqual([]);
      expect(socialSecurity.priorAnnualNetIncomeYears).toEqual([]);
    });

    it('should handle multiple paycheck configurations', () => {
      const dataWithMultiplePaychecks = {
        ...mockSocialSecurityData,
        paycheckNames: ['SS Payment 1', 'SS Payment 2'],
        paycheckAccounts: ['account-1', 'account-2'],
        paycheckCategories: ['Income', 'Retirement Income']
      };

      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const socialSecurity = new SocialSecurity(dataWithMultiplePaychecks);

      expect(socialSecurity.paycheckNames).toEqual(['SS Payment 1', 'SS Payment 2']);
      expect(socialSecurity.paycheckAccounts).toEqual(['account-1', 'account-2']);
      expect(socialSecurity.paycheckCategories).toEqual(['Income', 'Retirement Income']);
    });
  });

  describe('age calculations', () => {
    it('should handle edge case where start date is before birthday in start year', () => {
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-06-01T00:00:00Z')) // startDate (June)
        .mockReturnValueOnce(new Date('1960-08-01T00:00:00Z')); // birthDate (August)

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      // Should be 63 because birthday hasn't occurred yet in 2024
      expect(Math.floor(socialSecurity.startAge)).toBe(63);
      expect(Math.floor(socialSecurity.collectionAge)).toBe(63);
    });

    it('should handle edge case where start date is after birthday in start year', () => {
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-10-01T00:00:00Z')) // startDate (October)
        .mockReturnValueOnce(new Date('1960-08-01T00:00:00Z')); // birthDate (August)

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      // Should be 64 because birthday has occurred in 2024
      expect(Math.floor(socialSecurity.startAge)).toBe(64);
      expect(Math.floor(socialSecurity.collectionAge)).toBe(64);
    });
  });
});