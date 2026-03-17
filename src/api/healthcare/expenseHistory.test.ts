// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() at top, then import mocked modules after
// - Async: async/await throughout
// - Structure: describe > describe > it, with beforeEach(() => vi.clearAllMocks())

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHealthcareExpenseHistory } from './expenseHistory';
import { Request } from 'express';

// Mock dependencies
vi.mock('./expenses', () => ({
  getHealthcareExpenses: vi.fn(),
}));

vi.mock('../../utils/io/virtualHealthcarePlans', () => ({
  loadAllHealthcareConfigs: vi.fn(),
}));

import { getHealthcareExpenses } from './expenses';
import { loadAllHealthcareConfigs } from '../../utils/io/virtualHealthcarePlans';

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

describe('Healthcare Expense History API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHealthcareExpenseHistory', () => {
    it('should throw when configId query parameter is missing', async () => {
      const requestWithoutConfigId = {
        query: { simulation: 'Default' },
      } as unknown as Request;

      await expect(getHealthcareExpenseHistory(requestWithoutConfigId)).rejects.toThrow(
        'configId query parameter is required'
      );
    });

    it('should throw when config is not found', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([]);

      await expect(getHealthcareExpenseHistory(mockRequest)).rejects.toThrow(
        'Healthcare config with id config-1 not found'
      );
    });

    it('should return empty array when no expenses exist for config', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([]);

      const result = await getHealthcareExpenseHistory(mockRequest);
      expect(result).toEqual([]);
    });

    it('should return empty array when expenses exist but none match config covered persons', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit',
          person: 'Alice', // Not in coveredPersons
          patientCost: 200,
          hsaReimbursed: 0,
          billAmount: 200,
          copay: null,
          coinsurance: null,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2800,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9800,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);
      expect(result).toEqual([]);
    });

    it('should aggregate single expense into family and person data points', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit',
          person: 'John',
          patientCost: 200,
          hsaReimbursed: 200,
          billAmount: 250,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: true,
          billId: 'bill-1',
          individualDeductibleRemaining: 1300,
          familyDeductibleRemaining: 2800,
          individualOOPRemaining: 4800,
          familyOOPRemaining: 9800,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      // Should produce 2 data points: family-level (null) and John
      expect(result).toHaveLength(2);

      // Family-level data point (personName: null)
      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint).toBeDefined();
      expect(familyPoint).toMatchObject({
        date: '2024-03-15',
        personName: null,
        totalPatientCost: 200,
        totalHsaReimbursed: 200,
        netCost: 0,
        expenseCount: 1,
      });

      // John's data point
      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toBeDefined();
      expect(johnPoint).toMatchObject({
        date: '2024-03-15',
        personName: 'John',
        totalPatientCost: 200,
        totalHsaReimbursed: 200,
        netCost: 0,
        expenseCount: 1,
      });
    });

    it('should accumulate multiple expenses on the same date for the same person', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit',
          person: 'John',
          patientCost: 100,
          hsaReimbursed: 0,
          billAmount: 100,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1400,
          familyDeductibleRemaining: 2900,
          individualOOPRemaining: 4900,
          familyOOPRemaining: 9900,
        },
        {
          id: 'exp-2',
          date: '2024-03-15',
          name: 'Pharmacy',
          person: 'John',
          patientCost: 30,
          hsaReimbursed: 30,
          billAmount: 30,
          copay: 30,
          coinsurance: null,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1370,
          familyDeductibleRemaining: 2870,
          individualOOPRemaining: 4870,
          familyOOPRemaining: 9870,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      // Still 2 data points (family + John), but with combined totals
      expect(result).toHaveLength(2);

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toMatchObject({
        date: '2024-03-15',
        personName: 'John',
        totalPatientCost: 130,
        totalHsaReimbursed: 30,
        netCost: 100,
        expenseCount: 2,
      });

      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint).toMatchObject({
        date: '2024-03-15',
        personName: null,
        totalPatientCost: 130,
        totalHsaReimbursed: 30,
        netCost: 100,
        expenseCount: 2,
      });
    });

    it('should aggregate expenses from multiple people on the same date', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit - John',
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
        },
        {
          id: 'exp-2',
          date: '2024-03-15',
          name: 'Doctor Visit - Jane',
          person: 'Jane',
          patientCost: 150,
          hsaReimbursed: 150,
          billAmount: 150,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1350,
          familyDeductibleRemaining: 2650,
          individualOOPRemaining: 4850,
          familyOOPRemaining: 9650,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      // 3 data points: family, John, Jane
      expect(result).toHaveLength(3);

      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint).toMatchObject({
        date: '2024-03-15',
        personName: null,
        totalPatientCost: 350,
        totalHsaReimbursed: 150,
        netCost: 200,
        expenseCount: 2,
      });

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toMatchObject({
        date: '2024-03-15',
        personName: 'John',
        totalPatientCost: 200,
        totalHsaReimbursed: 0,
        netCost: 200,
        expenseCount: 1,
      });

      const janePoint = result.find(p => p.personName === 'Jane');
      expect(janePoint).toMatchObject({
        date: '2024-03-15',
        personName: 'Jane',
        totalPatientCost: 150,
        totalHsaReimbursed: 150,
        netCost: 0,
        expenseCount: 1,
      });
    });

    it('should produce separate data points for different dates', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
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
        },
        {
          id: 'exp-2',
          date: '2024-06-01',
          name: 'Lab Work',
          person: 'John',
          patientCost: 75,
          hsaReimbursed: 0,
          billAmount: 75,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1225,
          familyDeductibleRemaining: 2725,
          individualOOPRemaining: 4725,
          familyOOPRemaining: 9725,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      // 4 data points: 2 dates x (family + John)
      expect(result).toHaveLength(4);

      const marchFamilyPoint = result.find(p => p.date === '2024-03-15' && p.personName === null);
      expect(marchFamilyPoint).toMatchObject({ totalPatientCost: 200, expenseCount: 1 });

      const marchJohnPoint = result.find(p => p.date === '2024-03-15' && p.personName === 'John');
      expect(marchJohnPoint).toMatchObject({ totalPatientCost: 200, expenseCount: 1 });

      const juneFamilyPoint = result.find(p => p.date === '2024-06-01' && p.personName === null);
      expect(juneFamilyPoint).toMatchObject({ totalPatientCost: 75, expenseCount: 1 });

      const juneJohnPoint = result.find(p => p.date === '2024-06-01' && p.personName === 'John');
      expect(juneJohnPoint).toMatchObject({ totalPatientCost: 75, expenseCount: 1 });
    });

    it('should sort results by date ascending, with family (null) before individuals', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-06-01',
          name: 'Lab Work',
          person: 'John',
          patientCost: 75,
          hsaReimbursed: 0,
          billAmount: 75,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1225,
          familyDeductibleRemaining: 2725,
          individualOOPRemaining: 4725,
          familyOOPRemaining: 9725,
        },
        {
          id: 'exp-2',
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
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      expect(result).toHaveLength(4);

      // First two entries should be for March 15, family before John
      expect(result[0].date).toBe('2024-03-15');
      expect(result[0].personName).toBeNull();
      expect(result[1].date).toBe('2024-03-15');
      expect(result[1].personName).toBe('John');

      // Last two entries should be for June 1, family before John
      expect(result[2].date).toBe('2024-06-01');
      expect(result[2].personName).toBeNull();
      expect(result[3].date).toBe('2024-06-01');
      expect(result[3].personName).toBe('John');
    });

    it('should sort individuals alphabetically on the same date', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit - John',
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
        },
        {
          id: 'exp-2',
          date: '2024-03-15',
          name: 'Doctor Visit - Jane',
          person: 'Jane',
          patientCost: 150,
          hsaReimbursed: 0,
          billAmount: 150,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1350,
          familyDeductibleRemaining: 2650,
          individualOOPRemaining: 4850,
          familyOOPRemaining: 9650,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      expect(result).toHaveLength(3);
      // Family (null) first, then Jane, then John (alphabetical)
      expect(result[0].personName).toBeNull();
      expect(result[1].personName).toBe('Jane');
      expect(result[2].personName).toBe('John');
    });

    it('should correctly compute netCost as totalPatientCost minus totalHsaReimbursed', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit',
          person: 'John',
          patientCost: 500,
          hsaReimbursed: 300,
          billAmount: 500,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1000,
          familyDeductibleRemaining: 2500,
          individualOOPRemaining: 4500,
          familyOOPRemaining: 9500,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint?.netCost).toBe(200);

      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint?.netCost).toBe(200);
    });

    it('should only include expenses for persons covered by the config', async () => {
      const singlePersonConfig = {
        ...baseConfig,
        coveredPersons: ['John'],
      };
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([singlePersonConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit - John',
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
        },
        {
          id: 'exp-2',
          date: '2024-03-15',
          name: 'Doctor Visit - Jane',
          person: 'Jane', // Not covered in singlePersonConfig
          patientCost: 150,
          hsaReimbursed: 0,
          billAmount: 150,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1350,
          familyDeductibleRemaining: 2650,
          individualOOPRemaining: 4850,
          familyOOPRemaining: 9650,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      // Only John and family, no Jane
      expect(result).toHaveLength(2);
      expect(result.every(p => p.personName === null || p.personName === 'John')).toBe(true);

      // Family total should only reflect John's expenses
      const familyPoint = result.find(p => p.personName === null);
      expect(familyPoint?.totalPatientCost).toBe(200);
    });

    it('should use the correct config when multiple configs exist', async () => {
      const config2 = {
        ...baseConfig,
        id: 'config-2',
        name: 'Other Plan',
        coveredPersons: ['Alice'],
      };
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig, config2]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
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
        },
      ]);

      // Request is for config-1, which covers John
      const result = await getHealthcareExpenseHistory(mockRequest);

      expect(result).toHaveLength(2); // family + John
      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint).toBeDefined();
    });

    it('should handle zero hsaReimbursed correctly', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit',
          person: 'John',
          patientCost: 100,
          hsaReimbursed: 0,
          billAmount: 100,
          copay: null,
          coinsurance: 20,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1400,
          familyDeductibleRemaining: 2900,
          individualOOPRemaining: 4900,
          familyOOPRemaining: 9900,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint?.totalHsaReimbursed).toBe(0);
      expect(johnPoint?.netCost).toBe(100);
    });

    it('should update netCost when accumulating multiple expenses on same date', async () => {
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([baseConfig]);
      vi.mocked(getHealthcareExpenses).mockResolvedValue([
        {
          id: 'exp-1',
          date: '2024-03-15',
          name: 'Doctor Visit',
          person: 'John',
          patientCost: 200,
          hsaReimbursed: 100,
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
        },
        {
          id: 'exp-2',
          date: '2024-03-15',
          name: 'Pharmacy',
          person: 'John',
          patientCost: 50,
          hsaReimbursed: 50,
          billAmount: 50,
          copay: 50,
          coinsurance: null,
          accountName: 'Checking',
          isBill: false,
          billId: null,
          individualDeductibleRemaining: 1250,
          familyDeductibleRemaining: 2750,
          individualOOPRemaining: 4750,
          familyOOPRemaining: 9750,
        },
      ]);

      const result = await getHealthcareExpenseHistory(mockRequest);

      const johnPoint = result.find(p => p.personName === 'John');
      expect(johnPoint?.totalPatientCost).toBe(250);
      expect(johnPoint?.totalHsaReimbursed).toBe(150);
      expect(johnPoint?.netCost).toBe(100);
      expect(johnPoint?.expenseCount).toBe(2);
    });
  });
});
