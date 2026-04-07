import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pension } from './pension';
import { PensionData, BenefitRequirement } from './types';
import { loadVariable } from '../../../utils/simulation/variable';
import { getPersonBirthDate } from '../../../api/person-config/person-config';

// Mock dependencies
vi.mock('../../../utils/simulation/variable');
vi.mock('../../../api/person-config/person-config');

const mockLoadVariable = vi.mocked(loadVariable);
const mockGetPersonBirthDate = vi.mocked(getPersonBirthDate);

describe('Pension', () => {
  const mockBenefitRequirements: BenefitRequirement[] = [
    { age: 65, yearsWorked: 30 },
    { age: 60, yearsWorked: 35 },
  ];

  const mockReducedRequirements: BenefitRequirement[] = [{ age: 55, yearsWorked: 25 }];

  const mockPensionData: PensionData = {
    name: 'Test Pension Plan',
    payToAccount: 'retirement-account',
    paycheckNames: ['Pension Payment'],
    paycheckAccounts: ['retirement-account'],
    paycheckCategories: ['Retirement Income'],
    startDateVariable: 'retirementDate',
    person: 'TestPerson',
    workStartDateVariable: 'careerStartDate',
    priorAnnualNetIncomes: [60000, 65000, 70000, 75000, 80000],
    priorAnnualNetIncomeYears: [2019, 2020, 2021, 2022, 2023],
    unreducedRequirements: mockBenefitRequirements,
    reducedRequirements: mockReducedRequirements,
    highestCompensationConsecutiveYearsToAverage: 5,
    accrualFactor: 0.02,
    reducedRateByAgeThenYearsOfService: {
      55: { 25: 0.8, 30: 0.9 },
      60: { 25: 0.85, 30: 0.95 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for getPersonBirthDate
    mockGetPersonBirthDate.mockReturnValue(new Date('1960-01-01T00:00:00Z'));
  });

  describe('constructor', () => {
    it('should create a Pension instance with provided data', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(mockPensionData);

      expect(pension.name).toBe('Test Pension Plan');
      expect(pension.payToAccount).toBe('retirement-account');
      expect(pension.paycheckNames).toEqual(['Pension Payment']);
      expect(pension.paycheckAccounts).toEqual(['retirement-account']);
      expect(pension.paycheckCategories).toEqual(['Retirement Income']);
      expect(pension.startDateVariable).toBe('retirementDate');
      expect(pension.person).toBe('TestPerson');
      expect(pension.workStartDateVariable).toBe('careerStartDate');
      expect(pension.priorAnnualNetIncomes).toEqual([60000, 65000, 70000, 75000, 80000]);
      expect(pension.priorAnnualNetIncomeYears).toEqual([2019, 2020, 2021, 2022, 2023]);
      expect(pension.unreducedRequirements).toEqual(mockBenefitRequirements);
      expect(pension.reducedRequirements).toEqual(mockReducedRequirements);
      expect(pension.highestCompensationConsecutiveYearsToAverage).toBe(5);
      expect(pension.accrualFactor).toBe(0.02);
    });

    it('should load variables using the simulation parameter', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      new Pension(mockPensionData, 'CustomSimulation');

      expect(mockLoadVariable).toHaveBeenCalledWith('retirementDate', 'CustomSimulation');
      expect(mockLoadVariable).toHaveBeenCalledWith('careerStartDate', 'CustomSimulation');
    });

    it('should use default simulation when none provided', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      new Pension(mockPensionData);

      expect(mockLoadVariable).toHaveBeenCalledWith('retirementDate', 'Default');
      expect(mockLoadVariable).toHaveBeenCalledWith('careerStartDate', 'Default');
    });

    it('should calculate startAge correctly', () => {
      // Birth: 1960-01-01, Start: 2024-01-01 = 64 years
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(mockPensionData);

      expect(pension.startAge).toBe(64);
    });

    it('should calculate yearsWorked correctly', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(mockPensionData);

      expect(pension.yearsWorked).toBe(34);
    });
  });

  describe('serialize', () => {
    it('should serialize pension data correctly', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(mockPensionData);
      const serialized = pension.serialize();

      expect(serialized).toEqual({
        name: 'Test Pension Plan',
        payToAccount: 'retirement-account',
        paycheckNames: ['Pension Payment'],
        paycheckAccounts: ['retirement-account'],
        paycheckCategories: ['Retirement Income'],
        startDateVariable: 'retirementDate',
        person: 'TestPerson',
        workStartDateVariable: 'careerStartDate',
        priorAnnualNetIncomes: [60000, 65000, 70000, 75000, 80000],
        priorAnnualNetIncomeYears: [2019, 2020, 2021, 2022, 2023],
        unreducedRequirements: mockBenefitRequirements,
        reducedRequirements: mockReducedRequirements,
        highestCompensationConsecutiveYearsToAverage: 5,
        accrualFactor: 0.02,
        reducedRateByAgeThenYearsOfService: {
          55: { 25: 0.8, 30: 0.9 },
          60: { 25: 0.85, 30: 0.95 },
        },
      });
    });
  });

  describe('workEndDate calculations', () => {
    it('should cap yearsWorked when workEndDate is before pensionStartDate', () => {
      const dataWithWorkEnd = {
        ...mockPensionData,
        workEndDateVariable: 'workEndDate',
      };

      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')) // workStartDate
        .mockReturnValueOnce(new Date('2020-01-01T00:00:00Z')); // workEndDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(dataWithWorkEnd);

      expect(pension.yearsWorked).toBe(30); // 2020 - 1990 = 30
    });
  });

  describe('reduction factor calculation', () => {
    it('should return 1 when unreduced requirements are met', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(mockPensionData);

      expect(pension.reductionFactor).toBe(1);
    });

    it('should return 0 when reduced requirements are not met', () => {
      const dataWithRestrictedRequirements = {
        ...mockPensionData,
        unreducedRequirements: [{ age: 70, yearsWorked: 40 }],
        reducedRequirements: [{ age: 65, yearsWorked: 40 }],
      };

      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate
      mockGetPersonBirthDate.mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')); // birthDate

      const pension = new Pension(dataWithRestrictedRequirements);

      expect(pension.reductionFactor).toBe(0);
    });
  });
});
