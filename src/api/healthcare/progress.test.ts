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
      // Mock healthcare config (using new schema with coveredPersons array)
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
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
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
              copayAmount: null,
              coinsurancePercent: 20,
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

      // Verify structure - result is keyed by config ID
      expect(result).toHaveProperty('config-1');
      expect(result['config-1']).toMatchObject({
        configId: 'config-1',
        configName: 'Blue Cross PPO 2024',
        planYear: 2024,
        coveredPersons: ['John'],
      });

      // Check family-level aggregates
      expect(result['config-1']).toHaveProperty('familyDeductibleSpent');
      expect(result['config-1']).toHaveProperty('familyDeductibleRemaining');
      expect(result['config-1']).toHaveProperty('familyDeductibleMet');
      expect(result['config-1']).toHaveProperty('familyOOPSpent');
      expect(result['config-1']).toHaveProperty('familyOOPRemaining');
      expect(result['config-1']).toHaveProperty('familyOOPMet');

      // Check individual progress array
      expect(result['config-1'].individualProgress).toHaveLength(1);
      expect(result['config-1'].individualProgress[0]).toMatchObject({
        personName: 'John',
        deductibleSpent: 200,
        deductibleMet: false,
        oopSpent: 200,
        oopMet: false,
      });
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
        coveredPersons: ['John'],
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
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
              copayAmount: null,
              coinsurancePercent: 20,
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
      // - Family deductible spent: $500
      // - Family deductible remaining: $2500
      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress).toBeDefined();
      expect(johnProgress?.deductibleSpent).toBe(500);
      expect(result['config-1'].familyDeductibleSpent).toBe(500);
      expect(result['config-1'].familyDeductibleRemaining).toBe(2500);
    });
  });
});
