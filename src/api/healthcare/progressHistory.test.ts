// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() at top, import mocked modules after
// - Async: async/await throughout
// - Structure: describe > describe > it, with beforeEach(() => vi.clearAllMocks())

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHealthcareProgressHistory } from './progressHistory';
import { Request } from 'express';

// Mock dependencies
vi.mock('./expenses', () => ({
  getHealthcareExpenses: vi.fn(),
}));

vi.mock('../../utils/io/healthcareConfigs', () => ({
  loadHealthcareConfigs: vi.fn(),
}));

import { getHealthcareExpenses } from './expenses';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';

const mockRequest = {
  query: {
    simulation: 'Default',
    configId: 'config-1',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
  },
} as unknown as Request;

const baseConfig = {
  id: 'config-1',
  name: 'Blue Cross PPO 2024',
  coveredPersons: ['John', 'Jane'],
  startDate: '2024-01-01',
  endDate: null,
  individualDeductible: 1500,
  individualOutOfPocketMax: 5000,
  familyDeductible: 3000,
  familyOutOfPocketMax: 10000,
  hsaAccountId: 'hsa-123',
  hsaReimbursementEnabled: true,
  resetMonth: 0,
  resetDay: 1,
};

function makeExpense(overrides: Record<string, any> = {}): any {
  return {
    id: 'exp-1',
    date: '2024-03-15',
    name: 'Doctor Visit',
    person: 'John',
    patientCost: 200,
    hsaReimbursed: 0,
    billAmount: 200,
    copay: null,
    coinsurance: 20,
    accountName: 'Checking',
    isBill: false,
    billId: null,
    individualDeductibleRemaining: 1300,
    familyDeductibleRemaining: 2800,
    individualOOPRemaining: 4800,
    familyOOPRemaining: 9800,
    ...overrides,
  };
}

describe('Healthcare Progress History API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHealthcareProgressHistory', () => {
    // -----------------------------------------------------------------------
    // Error / validation cases
    // -----------------------------------------------------------------------

    it('should throw when configId query parameter is missing', async () => {
      const requestWithoutConfigId = {
        query: { simulation: 'Default' },
      } as unknown as Request;

      await expect(getHealthcareProgressHistory(requestWithoutConfigId)).rejects.toThrow(
        'configId query parameter is required'
      );
    });

    it('should throw when config is not found', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([]);

      await expect(getHealthcareProgressHistory(mockRequest)).rejects.toThrow(
        'Healthcare config with id config-1 not found'
      );
    });

    // -----------------------------------------------------------------------
    // Empty / no-data cases
    // -----------------------------------------------------------------------

    it('should return empty array when getHealthcareExpenses returns no expenses', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([]);

      const result = await getHealthcareProgressHistory(mockRequest);
      expect(result).toEqual([]);
    });

    it('should return empty array when no expenses match config covered persons', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({ person: 'Alice' }), // not in coveredPersons
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);
      expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Single expense — basic structure
    // -----------------------------------------------------------------------

    it('should produce family and per-person data points for a single expense', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2800,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9800,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // Should produce 2 data points: family-level (null) and John
      expect(result).toHaveLength(2);

      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint).toBeDefined();
      expect(familyPoint).toMatchObject({
        date: '2024-03-15',
        personName: null,
        deductibleSpent: baseConfig.familyDeductible - 2800, // 3000 - 2800 = 200
        oopSpent: baseConfig.familyOutOfPocketMax - 9800, // 10000 - 9800 = 200
      });

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toBeDefined();
      expect(johnPoint).toMatchObject({
        date: '2024-03-15',
        personName: 'John',
        deductibleSpent: baseConfig.individualDeductible - 1300, // 1500 - 1300 = 200
        oopSpent: baseConfig.individualOutOfPocketMax - 4800, // 5000 - 4800 = 200
      });
    });

    // -----------------------------------------------------------------------
    // deductibleSpent / oopSpent calculation accuracy
    // -----------------------------------------------------------------------

    it('should compute deductibleSpent as config limit minus remaining', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          individualDeductibleRemaining: 500,
          familyDeductibleRemaining: 1000,
          individualOOPRemaining: 4500,
          familyOOPRemaining: 9000,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint?.deductibleSpent).toBe(3000 - 1000); // 2000
      expect(familyPoint?.oopSpent).toBe(10000 - 9000); // 1000

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint?.deductibleSpent).toBe(1500 - 500); // 1000
      expect(johnPoint?.oopSpent).toBe(5000 - 4500); // 500
    });

    it('should compute deductibleSpent as zero when nothing has been spent', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          individualDeductibleRemaining: 1500, // full remaining = no spend
          familyDeductibleRemaining: 3000,
          individualOOPRemaining: 5000,
          familyOOPRemaining: 10000,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint?.deductibleSpent).toBe(0);
      expect(familyPoint?.oopSpent).toBe(0);

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint?.deductibleSpent).toBe(0);
      expect(johnPoint?.oopSpent).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Multiple people on the same date
    // -----------------------------------------------------------------------

    it('should produce separate per-person data points for different people on the same date', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          id: 'exp-1',
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2600,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9600,
        }),
        makeExpense({
          id: 'exp-2',
          person: 'Jane',
          date: '2024-03-15',
          individualDeductibleRemaining: 1350,
          familyDeductibleRemaining: 2600,
          individualOOPRemaining: 4850,
          familyOOPRemaining: 9600,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // family + John + Jane = 3 data points
      expect(result).toHaveLength(3);

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toMatchObject({
        date: '2024-03-15',
        personName: 'John',
        deductibleSpent: 1500 - 1300, // 200
        oopSpent: 5000 - 4800, // 200
      });

      const janePoint = result.find(p => p.personName === 'Jane');
      expect(janePoint).toMatchObject({
        date: '2024-03-15',
        personName: 'Jane',
        deductibleSpent: 1500 - 1350, // 150
        oopSpent: 5000 - 4850, // 150
      });
    });

    // -----------------------------------------------------------------------
    // Multiple dates — only the last expense per (date, person) pair is used
    // -----------------------------------------------------------------------

    it('should use the last expense when multiple expenses share the same date and person', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          id: 'exp-early',
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2800,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9800,
        }),
        makeExpense({
          id: 'exp-later',
          person: 'John',
          date: '2024-03-15',
          // "later" expense has less remaining (more has been spent)
          individualDeductibleRemaining: 1100,
          familyDeductibleRemaining: 2600,
          individualOOPRemaining: 4600,
          familyOOPRemaining: 9600,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // The Map overwrites with the last entry (exp-later)
      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint?.deductibleSpent).toBe(1500 - 1100); // 400 from last expense
    });

    it('should use the last expense per date for family-level data points', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          id: 'exp-1',
          person: 'John',
          date: '2024-03-15',
          familyDeductibleRemaining: 2800,
          familyOOPRemaining: 9800,
          individualDeductibleRemaining: 1300,
          individualOOPRemaining: 4800,
        }),
        makeExpense({
          id: 'exp-2',
          person: 'John',
          date: '2024-03-15',
          familyDeductibleRemaining: 2600,
          familyOOPRemaining: 9600,
          individualDeductibleRemaining: 1100,
          individualOOPRemaining: 4600,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // The byDate map overwrites with the last entry
      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint?.deductibleSpent).toBe(3000 - 2600); // 400 from last expense
      expect(familyPoint?.oopSpent).toBe(10000 - 9600); // 400 from last expense
    });

    // -----------------------------------------------------------------------
    // Separate dates produce separate data points
    // -----------------------------------------------------------------------

    it('should produce separate data points for different dates', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          id: 'exp-march',
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2800,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9800,
        }),
        makeExpense({
          id: 'exp-june',
          person: 'John',
          date: '2024-06-01',
          individualDeductibleRemaining: 1100,
          familyDeductibleRemaining: 2600,
          individualOOPRemaining: 4600,
          familyOOPRemaining: 9600,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // 4 data points: 2 dates x (family + John)
      expect(result).toHaveLength(4);

      const marchFamilyPoint = result.find(p => p.date === '2024-03-15' && p.personName === null);
      expect(marchFamilyPoint?.deductibleSpent).toBe(3000 - 2800);

      const marchJohnPoint = result.find(p => p.date === '2024-03-15' && p.personName === 'John');
      expect(marchJohnPoint?.deductibleSpent).toBe(1500 - 1300);

      const juneFamilyPoint = result.find(p => p.date === '2024-06-01' && p.personName === null);
      expect(juneFamilyPoint?.deductibleSpent).toBe(3000 - 2600);

      const juneJohnPoint = result.find(p => p.date === '2024-06-01' && p.personName === 'John');
      expect(juneJohnPoint?.deductibleSpent).toBe(1500 - 1100);
    });

    // -----------------------------------------------------------------------
    // Sorting: date ascending, null (family) before individuals, alphabetical
    // -----------------------------------------------------------------------

    it('should sort results by date ascending', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          id: 'exp-june',
          person: 'John',
          date: '2024-06-01',
          individualDeductibleRemaining: 1100,
          familyDeductibleRemaining: 2600,
          individualOOPRemaining: 4600,
          familyOOPRemaining: 9600,
        }),
        makeExpense({
          id: 'exp-march',
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2800,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9800,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      expect(result[0].date).toBe('2024-03-15');
      expect(result[1].date).toBe('2024-03-15');
      expect(result[2].date).toBe('2024-06-01');
      expect(result[3].date).toBe('2024-06-01');
    });

    it('should place family (null personName) before individuals on the same date', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({ person: 'John', date: '2024-03-15' }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // First entry on the date should be the family (null)
      const firstEntry = result.find(p => p.date === '2024-03-15');
      expect(firstEntry?.personName).toBeNull();
    });

    it('should sort individuals alphabetically on the same date', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          id: 'exp-john',
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2650,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9650,
        }),
        makeExpense({
          id: 'exp-jane',
          person: 'Jane',
          date: '2024-03-15',
          individualDeductibleRemaining: 1350,
          familyDeductibleRemaining: 2650,
          individualOOPRemaining: 4850,
          familyOOPRemaining: 9650,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      expect(result).toHaveLength(3); // family + Jane + John
      expect(result[0].personName).toBeNull(); // family first
      expect(result[1].personName).toBe('Jane'); // J-a before J-o alphabetically
      expect(result[2].personName).toBe('John');
    });

    // -----------------------------------------------------------------------
    // Only expenses for config covered persons are included
    // -----------------------------------------------------------------------

    it('should filter out expenses for people not in config coveredPersons', async () => {
      const singlePersonConfig = {
        ...baseConfig,
        coveredPersons: ['John'],
      };
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([singlePersonConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({ id: 'exp-john', person: 'John', date: '2024-03-15' }),
        makeExpense({ id: 'exp-alice', person: 'Alice', date: '2024-03-15' }), // not covered
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // Only family + John (Alice is excluded)
      expect(result).toHaveLength(2);
      expect(result.every(p => p.personName === null || p.personName === 'John')).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Selects the correct config when multiple configs exist
    // -----------------------------------------------------------------------

    it('should use config-1 when multiple configs are available', async () => {
      const config2 = {
        ...baseConfig,
        id: 'config-2',
        name: 'Other Plan',
        coveredPersons: ['Alice'],
      };
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig, config2]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({ person: 'John' }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // config-1 covers John, so data should appear
      expect(result).toHaveLength(2); // family + John
      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // Full data structure validation
    // -----------------------------------------------------------------------

    it('should return data points with date, personName, deductibleSpent, and oopSpent fields', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({
          person: 'John',
          date: '2024-03-15',
          individualDeductibleRemaining: 1000,
          familyDeductibleRemaining: 2000,
          individualOOPRemaining: 4000,
          familyOOPRemaining: 8000,
        }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      for (const point of result) {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('personName');
        expect(point).toHaveProperty('deductibleSpent');
        expect(point).toHaveProperty('oopSpent');
        expect(typeof point.date).toBe('string');
        expect(typeof point.deductibleSpent).toBe('number');
        expect(typeof point.oopSpent).toBe('number');
      }
    });

    // -----------------------------------------------------------------------
    // Two-null-personName tie-breaking (both family level entries — shouldn't
    // arise in practice but verifies the sort is stable)
    // -----------------------------------------------------------------------

    it('should handle two family-level points on different dates correctly', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        makeExpense({ id: 'e1', person: 'John', date: '2024-01-10' }),
        makeExpense({ id: 'e2', person: 'John', date: '2024-02-10' }),
      ]);

      const result = await getHealthcareProgressHistory(mockRequest);

      // Both dates should appear, sorted chronologically
      const familyPoints = result.filter(p => p.personName === null);
      expect(familyPoints).toHaveLength(2);
      expect(familyPoints[0].date).toBe('2024-01-10');
      expect(familyPoints[1].date).toBe('2024-02-10');
    });
  });
});
