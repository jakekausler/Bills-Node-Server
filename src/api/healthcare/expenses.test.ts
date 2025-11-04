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
        {
          id: 'hsa-123',
          name: 'HSA',
          consolidatedActivity: [
            {
              id: 'hsa-transfer-1',
              date: '2024-03-15',
              name: 'Healthcare Reimbursement',
              isTransfer: true,
              from: 'hsa-123',
              to: 'checking-1',
              amount: -200, // Transfer out of HSA
            },
          ],
        },
      ];

      const mockBills = [
        {
          id: 'bill-123',
          name: 'Doctor Visit',
          amount: 250, // Original bill amount
        },
      ];

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: mockAccounts as any,
          transfers: {
            bills: mockBills as any,
            activity: [],
          },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: {
          bills: mockBills as any,
          activity: [],
        },
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
        billAmount: 250,
        patientCost: 200,
        copay: null,
        coinsurance: 20,
        hsaReimbursed: 200, // Matched HSA transfer
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

    it('should match HSA reimbursement when transfer occurs one day after expense', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Jane Health Plan 2025',
        personName: 'Jane',
        startDate: '2025-01-01',
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
          name: 'Kendall Checking',
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2026-01-14',
              name: 'Jane Doctor Visit Test',
              isHealthcare: true,
              healthcarePerson: 'Jane',
              amount: -20, // Patient cost $20
              billId: 'bill-123',
              copayAmount: 20,
              coinsurancePercent: 20,
            },
          ],
        },
        {
          id: 'hsa-123',
          name: 'Jane HSA',
          type: 'HSA',
          consolidatedActivity: [
            {
              id: 'hsa-transfer-1',
              date: '2026-01-15', // ONE DAY AFTER expense (14th)
              name: 'HSA Reimbursement',
              isTransfer: true,
              from: 'hsa-123',
              to: 'checking-1',
              amount: -20, // Transfer out of HSA
            },
          ],
        },
      ];

      const mockBills = [
        {
          id: 'bill-123',
          name: 'Jane Doctor Visit Test',
          amount: 100,
        },
      ];

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: mockAccounts as any,
          transfers: {
            bills: mockBills as any,
            activity: [],
          },
        },
        selectedAccounts: [],
        startDate: new Date('2025-01-01'),
        endDate: new Date('2026-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: {
          bills: mockBills as any,
          activity: [],
        },
      } as any);

      const requestWith2026Dates = {
        query: {
          simulation: 'Default',
          startDate: '2025-01-01',
          endDate: '2026-12-31',
        },
      } as unknown as Request;

      const result = await getHealthcareExpenses(requestWith2026Dates);

      // Should find the expense
      expect(result).toHaveLength(1);

      // Should match HSA reimbursement despite 1-day offset
      expect(result[0]).toMatchObject({
        id: 'activity-1',
        date: '2026-01-14',
        name: 'Jane Doctor Visit Test',
        person: 'Jane',
        billAmount: 100,
        patientCost: 20,
        copay: 20,
        coinsurance: 20,
        hsaReimbursed: 20, // Should match the transfer even though it's on 1/15
        accountName: 'Kendall Checking',
        isBill: true,
        billId: 'bill-123',
      });
    });
  });
});
