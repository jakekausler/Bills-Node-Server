import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocialSecurity } from './socialSecurity';
import { SocialSecurityData } from './types';

// Mock dependencies
vi.mock('../../../api/person-config/person-config');

import { getPersonBirthDate, getPersonSSStartDate } from '../../../api/person-config/person-config';
const mockGetPersonBirthDate = vi.mocked(getPersonBirthDate);
const mockGetPersonSSStartDate = vi.mocked(getPersonSSStartDate);

describe('SocialSecurity', () => {
  const mockSocialSecurityData: SocialSecurityData = {
    name: 'Test Social Security',
    payToAccount: 'account-123',
    paycheckNames: ['Social Security Payment'],
    paycheckAccounts: ['account-123'],
    paycheckCategories: ['Income'],
    person: 'TestPerson',
    priorAnnualNetIncomes: [50000, 52000, 54000, 56000, 58000],
    priorAnnualNetIncomeYears: [2019, 2020, 2021, 2022, 2023],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockGetPersonBirthDate.mockReturnValue(new Date('1960-01-01T00:00:00Z'));
    mockGetPersonSSStartDate.mockReturnValue(new Date('2024-01-01T00:00:00Z'));
  });

  describe('constructor', () => {
    it('should create a SocialSecurity instance with provided data', () => {
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.name).toBe('Test Social Security');
      expect(socialSecurity.payToAccount).toBe('account-123');
      expect(socialSecurity.paycheckNames).toEqual(['Social Security Payment']);
      expect(socialSecurity.paycheckAccounts).toEqual(['account-123']);
      expect(socialSecurity.paycheckCategories).toEqual(['Income']);
      expect(socialSecurity.person).toBe('TestPerson');
      expect(socialSecurity.priorAnnualNetIncomes).toEqual([50000, 52000, 54000, 56000, 58000]);
      expect(socialSecurity.priorAnnualNetIncomeYears).toEqual([2019, 2020, 2021, 2022, 2023]);
    });

    it('should set loaded dates correctly', () => {
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.startDate).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(socialSecurity.birthDate).toEqual(new Date('1960-01-01T00:00:00Z'));
    });

    it('should initialize calculated properties to null', () => {
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.average35YearPayInflationAdjusted).toBeNull();
      expect(socialSecurity.monthlyPay).toBeNull();
    });

    it('should calculate startAge correctly', () => {
      // Birth date: 1960-01-01, Start date: 2024-01-01 = 64 years
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.startAge).toBe(64);
    });

    it('should calculate yearTurn60 correctly', () => {
      // Birth date: 1960-01-01, turns 60 in 2020
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.yearTurn60).toBe(2020);
    });

    it('should calculate collectionAge correctly', () => {
      // Start date: 2024-01-01, Birth date: 1960-01-01 = age 64
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(socialSecurity.collectionAge).toBe(64);
    });

    it('should handle different birth and start dates', () => {
      vi.clearAllMocks();
      mockGetPersonSSStartDate.mockReturnValueOnce(new Date('2030-06-15T00:00:00Z'));
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1965-03-20T00:00:00Z'));

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      expect(Math.floor(socialSecurity.startAge)).toBe(65); // 2030 - 1965 = 65
      expect(socialSecurity.yearTurn60).toBe(2025); // 1965 + 60 = 2025
      expect(Math.floor(socialSecurity.collectionAge)).toBe(65);
    });

    it('should handle empty arrays for income data', () => {
      const dataWithEmptyArrays = {
        ...mockSocialSecurityData,
        priorAnnualNetIncomes: [],
        priorAnnualNetIncomeYears: [],
      };

      const socialSecurity = new SocialSecurity(dataWithEmptyArrays);

      expect(socialSecurity.priorAnnualNetIncomes).toEqual([]);
      expect(socialSecurity.priorAnnualNetIncomeYears).toEqual([]);
    });

    it('should handle multiple paycheck configurations', () => {
      const dataWithMultiplePaychecks = {
        ...mockSocialSecurityData,
        paycheckNames: ['SS Payment 1', 'SS Payment 2'],
        paycheckAccounts: ['account-1', 'account-2'],
        paycheckCategories: ['Income', 'Retirement Income'],
      };

      const socialSecurity = new SocialSecurity(dataWithMultiplePaychecks);

      expect(socialSecurity.paycheckNames).toEqual(['SS Payment 1', 'SS Payment 2']);
      expect(socialSecurity.paycheckAccounts).toEqual(['account-1', 'account-2']);
      expect(socialSecurity.paycheckCategories).toEqual(['Income', 'Retirement Income']);
    });
  });

  describe('serialize', () => {
    it('should return a SocialSecurityData object with all non-computed fields', () => {
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);
      const serialized = socialSecurity.serialize();

      expect(serialized).toEqual({
        name: 'Test Social Security',
        payToAccount: 'account-123',
        paycheckNames: ['Social Security Payment'],
        paycheckAccounts: ['account-123'],
        paycheckCategories: ['Income'],
        person: 'TestPerson',
        priorAnnualNetIncomes: [50000, 52000, 54000, 56000, 58000],
        priorAnnualNetIncomeYears: [2019, 2020, 2021, 2022, 2023],
      });
    });

    it('should not include computed fields in serialized output', () => {
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);
      const serialized = socialSecurity.serialize();

      expect(serialized).not.toHaveProperty('startDate');
      expect(serialized).not.toHaveProperty('birthDate');
      expect(serialized).not.toHaveProperty('startAge');
      expect(serialized).not.toHaveProperty('average35YearPayInflationAdjusted');
      expect(serialized).not.toHaveProperty('monthlyPay');
      expect(serialized).not.toHaveProperty('yearTurn60');
      expect(serialized).not.toHaveProperty('collectionAge');
    });

    it('should serialize data with empty income arrays', () => {
      const dataWithEmptyArrays = {
        ...mockSocialSecurityData,
        priorAnnualNetIncomes: [],
        priorAnnualNetIncomeYears: [],
      };

      const socialSecurity = new SocialSecurity(dataWithEmptyArrays);
      const serialized = socialSecurity.serialize();

      expect(serialized.priorAnnualNetIncomes).toEqual([]);
      expect(serialized.priorAnnualNetIncomeYears).toEqual([]);
    });

    it('should serialize data with multiple paycheck configurations', () => {
      const dataWithMultiplePaychecks = {
        ...mockSocialSecurityData,
        paycheckNames: ['SS Payment 1', 'SS Payment 2'],
        paycheckAccounts: ['account-1', 'account-2'],
        paycheckCategories: ['Income', 'Retirement Income'],
      };

      const socialSecurity = new SocialSecurity(dataWithMultiplePaychecks);
      const serialized = socialSecurity.serialize();

      expect(serialized.paycheckNames).toEqual(['SS Payment 1', 'SS Payment 2']);
      expect(serialized.paycheckAccounts).toEqual(['account-1', 'account-2']);
      expect(serialized.paycheckCategories).toEqual(['Income', 'Retirement Income']);
    });

    it('should reflect mutations made after construction', () => {
      const socialSecurity = new SocialSecurity(mockSocialSecurityData);
      socialSecurity.name = 'Updated Name';
      socialSecurity.priorAnnualNetIncomes = [60000, 65000];

      const serialized = socialSecurity.serialize();

      expect(serialized.name).toBe('Updated Name');
      expect(serialized.priorAnnualNetIncomes).toEqual([60000, 65000]);
    });
  });

  describe('age calculations', () => {
    it('should handle edge case where start date is before birthday in start year', () => {
      mockGetPersonSSStartDate.mockReturnValueOnce(new Date('2024-06-01T00:00:00Z'));
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-08-01T00:00:00Z'));

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      // Should be 63 because birthday hasn't occurred yet in 2024
      expect(Math.floor(socialSecurity.startAge)).toBe(63);
      expect(Math.floor(socialSecurity.collectionAge)).toBe(63);
    });

    it('should handle edge case where start date is after birthday in start year', () => {
      mockGetPersonSSStartDate.mockReturnValueOnce(new Date('2024-10-01T00:00:00Z'));
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-08-01T00:00:00Z'));

      const socialSecurity = new SocialSecurity(mockSocialSecurityData);

      // Should be 64 because birthday has occurred in 2024
      expect(Math.floor(socialSecurity.startAge)).toBe(64);
      expect(Math.floor(socialSecurity.collectionAge)).toBe(64);
    });
  });
});
