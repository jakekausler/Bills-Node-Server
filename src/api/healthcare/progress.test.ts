import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHealthcareProgress } from './progress';
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

describe('Healthcare Progress API', () => {
  const mockRequest = {
    query: {
      simulation: 'Default',
      date: '2024-06-15',
    },
  } as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHealthcareProgress', () => {
    it('should return progress for person with active config', async () => {
      // Mock healthcare config
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

      // Mock getData to return mock accounts with healthcare activities
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
              amount: -200, // Patient cost after calculation
            },
          ],
        },
      ];

      vi.mocked(getData).mockReturnValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: mockAccounts as any,
          transfers: { bills: [], activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-15'),
      } as any);

      // Mock calculation engine
      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareProgress(mockRequest);

      // Verify structure
      expect(result).toHaveProperty('John');
      expect(result.John).toMatchObject({
        configId: 'config-1',
        configName: 'Blue Cross PPO 2024',
        planYear: 2024,
      });
      expect(result.John).toHaveProperty('individualDeductibleSpent');
      expect(result.John).toHaveProperty('individualDeductibleRemaining');
      expect(result.John).toHaveProperty('individualDeductibleMet');
    });

    it('should return empty object when no configs exist', async () => {
      vi.mocked(loadHealthcareConfigs).mockResolvedValue([]);
      vi.mocked(getData).mockReturnValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: [],
          transfers: { bills: [], activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-15'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: [],
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareProgress(mockRequest);
      expect(result).toEqual({});
    });

    it('should correctly track spending after processing activities', async () => {
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
              amount: -500, // $500 patient cost
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
        endDate: new Date('2024-06-15'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareProgress(mockRequest);

      // After spending $500, should show:
      // - Individual deductible spent: $500
      // - Individual deductible remaining: $1000
      expect(result.John.individualDeductibleSpent).toBe(500);
      expect(result.John.individualDeductibleRemaining).toBe(1000);
    });
  });
});
