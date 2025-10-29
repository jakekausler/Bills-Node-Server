import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHealthcareExpenses } from './expenses';
import { Request } from 'express';

// Mock dependencies
vi.mock('../../utils/net/request', () => ({
  getData: vi.fn(),
}));

vi.mock('../../utils/io/healthcareConfigs', () => ({
  loadHealthcareConfigs: vi.fn(),
}));

vi.mock('../../utils/calculate-v3/engine', () => ({
  calculateAllActivity: vi.fn(),
}));

import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';

describe('Healthcare Expenses API', () => {
  const mockRequest = {
    query: {
      simulation: 'Default',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    },
  } as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHealthcareExpenses', () => {
    it('should return healthcare expenses with cost breakdown', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        personName: 'John',
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

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-03-15',
              name: 'Doctor Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200, // Patient cost
              billId: 'bill-123',
              copayAmount: null,
              coinsurancePercent: 20,
            },
            {
              id: 'activity-2',
              date: '2024-03-15',
              name: 'Pharmacy - Prescription',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -30,
              billId: null,
              copayAmount: 30,
              coinsurancePercent: null,
            },
            {
              id: 'activity-3',
              date: '2024-04-01',
              name: 'Groceries',
              isHealthcare: false,
              amount: -150,
            },
          ],
        },
      ];

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: mockAccounts as any,
          transfers: { bills: [], activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareExpenses(mockRequest);

      // Should return only healthcare activities (2 out of 3)
      expect(result).toHaveLength(2);

      // Check first expense
      expect(result[0]).toMatchObject({
        id: 'activity-1',
        date: '2024-03-15',
        name: 'Doctor Visit',
        person: 'John',
        patientCost: 200, // Positive (expense amount)
        copay: null,
        coinsurance: 20,
        accountName: 'Checking',
        isBill: true,
        billId: 'bill-123',
      });

      // Check second expense
      expect(result[1]).toMatchObject({
        id: 'activity-2',
        date: '2024-03-15',
        name: 'Pharmacy - Prescription',
        person: 'John',
        patientCost: 30,
        copay: 30,
        coinsurance: null,
        accountName: 'Checking',
        isBill: false,
        billId: null,
      });
    });

    it('should filter by date range when provided', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        personName: 'John',
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 1500,
        individualOutOfPocketMax: 5000,
        familyDeductible: 3000,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-01-15',
              name: 'January Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
            },
            {
              id: 'activity-2',
              date: '2024-06-15',
              name: 'June Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -150,
            },
          ],
        },
      ];

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: mockAccounts as any,
          transfers: { bills: [], activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-03-01'),
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      const requestWithDateFilter = {
        query: {
          simulation: 'Default',
          startDate: '2024-03-01',
          endDate: '2024-12-31',
        },
      } as unknown as Request;

      const result = await getHealthcareExpenses(requestWithDateFilter);

      // Should only include June visit (after March 1)
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('June Visit');
    });

    it('should return empty array when no healthcare expenses exist', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([]);

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: [],
          transfers: { bills: [], activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: [],
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareExpenses(mockRequest);
      expect(result).toEqual([]);
    });
  });
});
