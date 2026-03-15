import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pension } from './pension';
import { PensionData, BenefitRequirement } from './types';
import { loadVariable } from '../../../utils/simulation/variable';

// Mock dependencies
vi.mock('../../../utils/simulation/variable');

const mockLoadVariable = vi.mocked(loadVariable);

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
    birthDateVariable: 'birthDate',
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
  });

  describe('constructor', () => {
    it('should create a Pension instance with provided data', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.name).toBe('Test Pension Plan');
      expect(pension.payToAccount).toBe('retirement-account');
      expect(pension.paycheckNames).toEqual(['Pension Payment']);
      expect(pension.paycheckAccounts).toEqual(['retirement-account']);
      expect(pension.paycheckCategories).toEqual(['Retirement Income']);
      expect(pension.startDateVariable).toBe('retirementDate');
      expect(pension.birthDateVariable).toBe('birthDate');
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
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      new Pension(mockPensionData, 'CustomSimulation');

      expect(mockLoadVariable).toHaveBeenCalledWith('retirementDate', 'CustomSimulation');
      expect(mockLoadVariable).toHaveBeenCalledWith('birthDate', 'CustomSimulation');
      expect(mockLoadVariable).toHaveBeenCalledWith('careerStartDate', 'CustomSimulation');
    });

    it('should use default simulation when none provided', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      new Pension(mockPensionData);

      expect(mockLoadVariable).toHaveBeenCalledWith('retirementDate', 'Default');
      expect(mockLoadVariable).toHaveBeenCalledWith('birthDate', 'Default');
      expect(mockLoadVariable).toHaveBeenCalledWith('careerStartDate', 'Default');
    });

    it('should calculate startAge correctly', () => {
      // Birth: 1960-01-01, Start: 2024-01-01 = 64 years
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.startAge).toBe(64);
    });

    it('should calculate yearsWorked correctly', () => {
      // Work start: 1990-01-01, Retirement: 2024-01-01 = 34 years
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.yearsWorked).toBe(34);
    });

    it('should convert reducedRateByAgeThenYearsOfService to numbers', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.reducedRateByAgeThenYearsOfService).toEqual({
        55: { 25: 0.8, 30: 0.9 },
        60: { 25: 0.85, 30: 0.95 },
      });
      // Verify keys are actually numbers
      expect(typeof Object.keys(pension.reducedRateByAgeThenYearsOfService)[0]).toBe('string');
      expect(typeof Object.keys(pension.reducedRateByAgeThenYearsOfService[55])[0]).toBe('string');
    });

    it('should initialize calculated properties correctly', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.highestCompensationAverage).toBeNull();
      expect(pension.monthlyPay).toBeNull();
      expect(pension.reductionFactor).toBeDefined();
    });
  });

  describe('calculateReductionFactor', () => {
    it('should return 1 for unreduced benefits when age and years requirements are met', () => {
      // Setup for 65 years old with 35 years of service
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2025-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.startAge).toBe(65);
      expect(pension.yearsWorked).toBe(35);
      expect(pension.reductionFactor).toBe(1); // Should meet unreduced requirements
    });

    it('should return reduced rate when only reduced requirements are met', () => {
      // Setup for 57 years old with 30 years of service
      const dataWithAge57 = {
        ...mockPensionData,
        reducedRateByAgeThenYearsOfService: {
          55: { 25: 0.8, 30: 0.9 },
          57: { 25: 0.85, 30: 0.95 },
          60: { 25: 0.85, 30: 0.95 },
        },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2017-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1987-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWithAge57);

      expect(pension.startAge).toBe(57);
      expect(pension.yearsWorked).toBe(30);
      // Should use age 57, years 30 = 0.95
      expect(pension.reductionFactor).toBe(0.95);
    });

    it('should return 0 when no requirements are met', () => {
      // Setup for 50 years old with 20 years of service (below all requirements)
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2010-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.startAge).toBe(50);
      expect(pension.yearsWorked).toBe(20);
      expect(pension.reductionFactor).toBe(0);
    });

    it('should handle age requirements without years worked requirement', () => {
      const dataWithAgeOnlyRequirement = {
        ...mockPensionData,
        unreducedRequirements: [{ age: 65, yearsWorked: 0 }], // Only age requirement
        reducedRequirements: [{ age: 55, yearsWorked: 0 }],
        reducedRateByAgeThenYearsOfService: {
          55: { 0: 0.8 },
          65: { 0: 1.0 },
        },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2025-01-01T00:00:00Z')) // startDate (age 65)
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('2000-01-01T00:00:00Z')); // workStartDate (25 years)

      const pension = new Pension(dataWithAgeOnlyRequirement);

      expect(pension.reductionFactor).toBe(1); // Should meet unreduced (age 65, any years)
    });

    it('should handle requirements without age limits', () => {
      const dataWithYearsOnlyRequirement = {
        ...mockPensionData,
        unreducedRequirements: [{ yearsWorked: 35 }], // Only years requirement
        reducedRequirements: [{ yearsWorked: 25 }],
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2025-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1970-01-01T00:00:00Z')) // birthDate (age 55)
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate (35 years)

      const pension = new Pension(dataWithYearsOnlyRequirement);

      expect(pension.reductionFactor).toBe(1); // Should meet unreduced (any age, 35 years)
    });

    it('should use minimum age key when start age is below range', () => {
      const dataWithHigherAgeRange = {
        ...mockPensionData,
        reducedRequirements: [{ age: 55, yearsWorked: 25 }],
        reducedRateByAgeThenYearsOfService: {
          60: { 25: 0.8, 30: 0.9 },
          65: { 25: 0.85, 30: 0.95 },
        },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2015-01-01T00:00:00Z')) // startDate (age 55)
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1985-01-01T00:00:00Z')); // workStartDate (30 years)

      const pension = new Pension(dataWithHigherAgeRange);

      // Age 55 < 60 (min), so should use age 60, years 30 = 0.9
      expect(pension.reductionFactor).toBe(0.9);
    });

    it('should return 1 when start age exceeds maximum age range', () => {
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2030-01-01T00:00:00Z')) // startDate (age 70)
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1985-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      // Age 70 > 60 (max), so should return 1
      expect(pension.reductionFactor).toBe(1);
    });
  });

  describe('serialize', () => {
    it('should serialize pension data correctly', () => {
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // startDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);
      const serialized = pension.serialize();

      expect(serialized).toEqual({
        name: 'Test Pension Plan',
        payToAccount: 'retirement-account',
        paycheckNames: ['Pension Payment'],
        paycheckAccounts: ['retirement-account'],
        paycheckCategories: ['Retirement Income'],
        startDateVariable: 'retirementDate',
        birthDateVariable: 'birthDate',
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
      // Work from 2022 to 2025 (3 years), but pension starts in 2060 (would be 38 years without cap)
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2060-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('2022-01-01T00:00:00Z')) // workStartDate
        .mockReturnValueOnce(new Date('2025-01-01T00:00:00Z')); // workEndDate

      const dataWithWorkEndDate = {
        ...mockPensionData,
        workEndDateVariable: 'workEndDate',
      };

      const pension = new Pension(dataWithWorkEndDate);

      expect(pension.yearsWorked).toBeCloseTo(3, 0); // Should be ~3 years, not 38
      expect(pension.startAge).toBe(100); // Born 1960, pension starts 2060
    });

    it('should use pensionStartDate when no workEndDate is provided', () => {
      // Work from 1990 to pension start in 2024 (34 years)
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.yearsWorked).toBe(34);
    });

    it('should ignore workEndDate when it is after pensionStartDate', () => {
      // Work starts 1990, pension starts 2024, workEndDate 2070 (future)
      // Should use pension start date (2024) as the effective end
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')) // workStartDate
        .mockReturnValueOnce(new Date('2070-01-01T00:00:00Z')); // workEndDate (future)

      const dataWithWorkEndDate = {
        ...mockPensionData,
        workEndDateVariable: 'workEndDate',
      };

      const pension = new Pension(dataWithWorkEndDate);

      expect(pension.yearsWorked).toBe(34); // Should be based on pensionStartDate
    });

    it('should handle workEndDate exactly equal to pensionStartDate', () => {
      // Both dates are the same
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')) // workStartDate
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')); // workEndDate (same as start)

      const dataWithWorkEndDate = {
        ...mockPensionData,
        workEndDateVariable: 'workEndDate',
      };

      const pension = new Pension(dataWithWorkEndDate);

      expect(pension.yearsWorked).toBe(34);
    });
  });

  describe('vesting checks', () => {
    it('should return reductionFactor of 0 when not vested (below minimum requirement)', () => {
      // Setup for someone with 20 years worked, but minimum is 25
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2010-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.yearsWorked).toBe(20);
      expect(pension.reductionFactor).toBe(0); // Not vested
    });

    it('should be vested when exactly meeting minimum requirement', () => {
      // Setup for exactly 25 years (minimum reduced requirement)
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2015-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.yearsWorked).toBe(25);
      expect(pension.reductionFactor).toBeGreaterThan(0); // Should be vested with reduced benefits
    });

    it('should be vested when exceeding all requirements', () => {
      // Setup for 35 years, meeting unreduced requirements
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2025-01-01T00:00:00Z')) // pensionStartDate (age 65)
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.yearsWorked).toBe(35);
      expect(pension.startAge).toBe(65);
      expect(pension.reductionFactor).toBe(1); // Full benefits
    });
  });

  describe('configurable average years', () => {
    it('should use configured number of years for compensation average', () => {
      // Test with 3 years instead of default 5
      const dataWith3Years = {
        ...mockPensionData,
        highestCompensationConsecutiveYearsToAverage: 3,
        priorAnnualNetIncomes: [60000, 65000, 70000],
        priorAnnualNetIncomeYears: [2021, 2022, 2023],
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWith3Years);

      expect(pension.highestCompensationConsecutiveYearsToAverage).toBe(3);
    });

    it('should use configured number of years with 4-year average', () => {
      // Test with 4 years (common for some pension plans)
      const dataWith4Years = {
        ...mockPensionData,
        highestCompensationConsecutiveYearsToAverage: 4,
        priorAnnualNetIncomes: [60000, 65000, 70000, 75000],
        priorAnnualNetIncomeYears: [2020, 2021, 2022, 2023],
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWith4Years);

      expect(pension.highestCompensationConsecutiveYearsToAverage).toBe(4);
    });
  });

  describe('COLA configuration', () => {
    it('should default to COLA type none when not specified', () => {
      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(mockPensionData);

      expect(pension.cola.type).toBe('none');
    });

    it('should store fixed COLA configuration', () => {
      const dataWithFixedCOLA = {
        ...mockPensionData,
        cola: { type: 'fixed' as const, fixedRate: 0.02 },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWithFixedCOLA);

      expect(pension.cola.type).toBe('fixed');
      expect(pension.cola.fixedRate).toBe(0.02);
    });

    it('should store CPI-linked COLA configuration', () => {
      const dataWithCPICOLA = {
        ...mockPensionData,
        cola: { type: 'cpiLinked' as const, cpiCap: 0.03 },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWithCPICOLA);

      expect(pension.cola.type).toBe('cpiLinked');
      expect(pension.cola.cpiCap).toBe(0.03);
    });

    it('should serialize COLA configuration when present', () => {
      const dataWithCOLA = {
        ...mockPensionData,
        cola: { type: 'fixed' as const, fixedRate: 0.025 },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWithCOLA);
      const serialized = pension.serialize();

      expect(serialized.cola).toEqual({ type: 'fixed', fixedRate: 0.025 });
    });

    it('should not serialize COLA when type is none', () => {
      const dataWithNoCOLA = {
        ...mockPensionData,
        cola: { type: 'none' as const },
      };

      vi.clearAllMocks();
      mockLoadVariable
        .mockReturnValueOnce(new Date('2024-01-01T00:00:00Z')) // pensionStartDate
        .mockReturnValueOnce(new Date('1960-01-01T00:00:00Z')) // birthDate
        .mockReturnValueOnce(new Date('1990-01-01T00:00:00Z')); // workStartDate

      const pension = new Pension(dataWithNoCOLA);
      const serialized = pension.serialize();

      expect(serialized.cola).toBeUndefined();
    });
  });
});
