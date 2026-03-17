import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHealthcareProgress } from './progress';
import { Request } from 'express';

// Mock dependencies
vi.mock('../../utils/net/request', () => ({
  getData: vi.fn(),
}));

vi.mock('../../utils/io/virtualHealthcarePlans', () => ({
  loadAllHealthcareConfigs: vi.fn(),
}));

vi.mock('../../utils/calculate-v3/engine', () => ({
  calculateAllActivity: vi.fn(),
}));

import { getData } from '../../utils/net/request';
import { loadAllHealthcareConfigs } from '../../utils/io/virtualHealthcarePlans';
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

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

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
      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([]);
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

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

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

    it('should track copay-based expenses toward deductible and OOP', async () => {
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
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      // Copay-based expense: $50 copay, bill amount $250
      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          bills: [{ id: 'bill-1', amount: 250 }],
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-03-15',
              name: 'Specialist Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -50,
              billId: 'bill-1',
              copayAmount: 50,
              coinsurancePercent: null,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
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

      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress).toBeDefined();
      // Copay: bill amount $250 toward deductible, $50 copay toward OOP
      expect(johnProgress?.deductibleSpent).toBe(250);
      expect(johnProgress?.oopSpent).toBe(50);
    });

    it('should correctly handle bill-exceeds-deductible split calculation', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 100, // Low deductible to trigger split
        individualOutOfPocketMax: 5000,
        familyDeductible: 200,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      // Bill of $300 with 20% coinsurance; deductible is only $100
      // Expected: $100 to deductible, then 20% of remaining $200 = $40, total patient: $140
      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          bills: [{ id: 'bill-1', amount: 300 }],
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-03-15',
              name: 'Hospital Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -140, // Patient cost
              billId: 'bill-1',
              copayAmount: null,
              coinsurancePercent: 20,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
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

      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress).toBeDefined();
      // Deductible met ($100 out of $100)
      expect(johnProgress?.deductibleSpent).toBe(100);
      expect(johnProgress?.deductibleMet).toBe(true);
      // OOP: $100 deductible + $40 coinsurance = $140
      expect(johnProgress?.oopSpent).toBe(140);
    });

    it('should handle deductible-met-OOP-not-met path', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 200,
        individualOutOfPocketMax: 5000,
        familyDeductible: 400,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          bills: [
            { id: 'bill-1', amount: 200 }, // Exactly hits deductible
            { id: 'bill-2', amount: 300 }, // Post-deductible
          ],
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-02-01',
              name: 'First Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200,
              billId: 'bill-1',
              copayAmount: null,
              coinsurancePercent: 0,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
            },
            {
              id: 'activity-2',
              date: '2024-04-01',
              name: 'Second Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -60, // patient pays 20% coinsurance on $300
              billId: 'bill-2',
              copayAmount: null,
              coinsurancePercent: 20,
              countsTowardDeductible: false,
              countsTowardOutOfPocket: true,
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

      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress).toBeDefined();
      expect(johnProgress?.deductibleMet).toBe(true);
      // OOP: $200 from first visit + $60 from second visit
      expect(johnProgress?.oopSpent).toBe(260);
    });

    it('should skip config with empty coveredPersons array', async () => {
      const configWithEmptyPersons = {
        id: 'config-empty',
        name: 'Empty Config',
        coveredPersons: [],
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

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([configWithEmptyPersons]);

      vi.mocked(getData).mockResolvedValue({
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
      expect(result).not.toHaveProperty('config-empty');
    });

    it('should skip config with endDate before the query date', async () => {
      const expiredConfig = {
        id: 'config-expired',
        name: 'Expired Config',
        coveredPersons: ['John'],
        startDate: '2023-01-01',
        endDate: '2023-12-31', // expired before 2024-06-15
        individualDeductible: 1500,
        individualOutOfPocketMax: 5000,
        familyDeductible: 3000,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([expiredConfig]);

      vi.mocked(getData).mockResolvedValue({
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
      expect(result).not.toHaveProperty('config-expired');
    });

    it('should exclude activities after the query date', async () => {
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
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      // Activity on 2024-07-01 is after query date 2024-06-15 and should be excluded
      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-07-01',
              name: 'Future Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -500,
              billId: null,
              copayAmount: null,
              coinsurancePercent: 0,
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

      const result = await getHealthcareProgress(mockRequest);

      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress).toBeDefined();
      expect(johnProgress?.deductibleSpent).toBe(0);
      expect(johnProgress?.oopSpent).toBe(0);
    });

    it('should use default date (today) when date param not provided', async () => {
      const noDateRequest = {
        query: { simulation: 'Default' },
      } as unknown as Request;

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
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: [],
          transfers: { bills: [], activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2026-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: [],
        transfers: { bills: [], activity: [] },
      } as any);

      // Should not throw; just verify the call succeeds
      const result = await getHealthcareProgress(noDateRequest);
      expect(result).toBeDefined();
    });

    it('should track multiple covered persons independently', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Family Plan 2024',
        coveredPersons: ['John', 'Jane'],
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 1000,
        individualOutOfPocketMax: 3000,
        familyDeductible: 2000,
        familyOutOfPocketMax: 6000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'activity-john',
              date: '2024-03-01',
              name: 'John Doctor Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -300,
              billId: null,
              copayAmount: null,
              coinsurancePercent: 0,
            },
            {
              id: 'activity-jane',
              date: '2024-04-01',
              name: 'Jane Doctor Visit',
              isHealthcare: true,
              healthcarePerson: 'Jane',
              amount: -400,
              billId: null,
              copayAmount: null,
              coinsurancePercent: 0,
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

      const result = await getHealthcareProgress({
        query: { simulation: 'Default', date: '2024-12-31' },
      } as unknown as Request);

      expect(result['config-1']).toBeDefined();
      // Family total should be sum of both persons
      expect(result['config-1'].familyDeductibleSpent).toBe(700);

      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      const janeProgress = result['config-1'].individualProgress.find(p => p.personName === 'Jane');
      expect(johnProgress?.deductibleSpent).toBe(300);
      expect(janeProgress?.deductibleSpent).toBe(400);
    });

    it('should use bill lookup from transfers.bills when bill not in account', async () => {
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
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([mockConfig]);

      const mockTransferBills = [
        { id: 'transfer-bill-1', amount: 500 },
      ];

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          // no account-level bills
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-03-15',
              name: 'Doctor Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -500,
              billId: 'transfer-bill-1',
              copayAmount: null,
              coinsurancePercent: 0,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
            },
          ],
        },
      ];

      vi.mocked(getData).mockResolvedValue({
        simulation: 'Default',
        accountsAndTransfers: {
          accounts: mockAccounts as any,
          transfers: { bills: mockTransferBills as any, activity: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-15'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: mockTransferBills as any, activity: [] },
      } as any);

      const result = await getHealthcareProgress(mockRequest);

      const johnProgress = result['config-1'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress?.deductibleSpent).toBe(500);
    });

    it('should correctly calculate plan year for date before reset month', async () => {
      // A config with July 1 reset (resetMonth=6, resetDay=1)
      // Query date is May 15, 2024 - which is BEFORE July 1 in calendar year 2024
      // So plan year should be 2023 (the plan year that started July 1, 2023)
      const julyResetConfig = {
        id: 'config-july',
        name: 'July Reset Plan',
        coveredPersons: ['John'],
        startDate: '2023-07-01',
        endDate: null,
        individualDeductible: 1000,
        individualOutOfPocketMax: 3000,
        familyDeductible: 2000,
        familyOutOfPocketMax: 6000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 6, // July (0-indexed)
        resetDay: 1,
      };

      vi.mocked(loadAllHealthcareConfigs).mockReturnValue([julyResetConfig]);

      // Activity in the plan year (Oct 2023 - within the 2023 plan year that runs Jul 2023 - Jul 2024)
      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2023-10-15',
              name: 'Doctor Visit in Plan Year 2023',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: 0,
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
        startDate: new Date('2023-07-01'),
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      // Query on May 15, 2024 - before July reset, so plan year is 2023
      const mayRequest = {
        query: { simulation: 'Default', date: '2024-05-15' },
      } as unknown as Request;

      const result = await getHealthcareProgress(mayRequest);

      expect(result['config-july']).toBeDefined();
      expect(result['config-july'].planYear).toBe(2023);
      // The October 2023 activity should be counted
      const johnProgress = result['config-july'].individualProgress.find(p => p.personName === 'John');
      expect(johnProgress?.deductibleSpent).toBe(200);
    });
  });
});
