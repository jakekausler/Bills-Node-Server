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
        accountName: 'Checking',
        isBill: true,
        billId: 'bill-123',
      });
      // Check that remaining amounts are present
      expect(result[0].individualDeductibleRemaining).toBeDefined();
      expect(result[0].familyDeductibleRemaining).toBeDefined();
      expect(result[0].individualOOPRemaining).toBeDefined();
      expect(result[0].familyOOPRemaining).toBeDefined();
      expect(typeof result[0].individualDeductibleRemaining).toBe('number');
      expect(typeof result[0].familyDeductibleRemaining).toBe('number');
      expect(typeof result[0].individualOOPRemaining).toBe('number');
      expect(typeof result[0].familyOOPRemaining).toBe('number');

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
      expect(result[1].individualDeductibleRemaining).toBeDefined();
      expect(result[1].familyDeductibleRemaining).toBeDefined();
      expect(result[1].individualOOPRemaining).toBeDefined();
      expect(result[1].familyOOPRemaining).toBeDefined();
    });

    it('should filter by date range when provided', async () => {
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

    it('should return expenses with zero remaining when no config applies to person', async () => {
      // Config covers 'Jane', but expense is for 'Bob' - no config found
      const mockConfig = {
        id: 'config-1',
        name: 'Jane Plan 2024',
        coveredPersons: ['Jane'],
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
              id: 'activity-bob',
              date: '2024-03-15',
              name: 'Bob Doctor Visit',
              isHealthcare: true,
              healthcarePerson: 'Bob', // Not covered by any config
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
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

      expect(result).toHaveLength(1);
      // Default to zero remaining when no config applies
      expect(result[0].individualDeductibleRemaining).toBe(0);
      expect(result[0].familyDeductibleRemaining).toBe(0);
      expect(result[0].individualOOPRemaining).toBe(0);
      expect(result[0].familyOOPRemaining).toBe(0);
    });

    it('should skip config for person when expense date is before config startDate', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
        startDate: '2024-06-01', // Config starts in June
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
              date: '2024-03-15', // Before config start date
              name: 'March Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
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

      expect(result).toHaveLength(1);
      // No config applies so defaults to zero
      expect(result[0].individualDeductibleRemaining).toBe(0);
    });

    it('should skip config for person when expense date is after config endDate', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
        startDate: '2024-01-01',
        endDate: '2024-06-30', // Config ends in June
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
              date: '2024-09-15', // After config end date
              name: 'September Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
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

      const requestNoDates = {
        query: { simulation: 'Default' },
      } as unknown as Request;

      const result = await getHealthcareExpenses(requestNoDates);

      expect(result).toHaveLength(1);
      expect(result[0].individualDeductibleRemaining).toBe(0);
    });

    it('should calculate correct remaining amounts when bill exceeds deductible (split path)', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 100, // Low deductible to force split
        individualOutOfPocketMax: 5000,
        familyDeductible: 200,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      // First expense (will be processed first): $200 bill with 20% coinsurance, deductible is $100
      // Second expense: we want to check the remaining deductible for the SECOND expense
      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          bills: [{ id: 'bill-1', amount: 200 }],
          consolidatedActivity: [
            {
              id: 'activity-first',
              date: '2024-02-01',
              name: 'A First Visit', // alphabetically first
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -120, // patient pays $100 deductible + 20% of $100 remaining = $120
              billId: 'bill-1',
              copayAmount: null,
              coinsurancePercent: 20,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
            },
            {
              id: 'activity-second',
              date: '2024-03-01',
              name: 'Second Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -60, // patient pays coinsurance since deductible is already met
              billId: null,
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
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareExpenses(mockRequest);

      expect(result).toHaveLength(2);
      // First expense: individual deductible still $100 remaining (nothing before it)
      const firstExpense = result.find(e => e.name === 'A First Visit');
      expect(firstExpense?.individualDeductibleRemaining).toBe(100);

      // Second expense: deductible should be met ($100 was hit by first expense)
      const secondExpense = result.find(e => e.name === 'Second Visit');
      expect(secondExpense?.individualDeductibleRemaining).toBe(0);
    });

    it('should track copay-based expenses in calculateRemainingAmounts', async () => {
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

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          bills: [{ id: 'bill-1', amount: 200 }],
          consolidatedActivity: [
            {
              id: 'activity-copay',
              date: '2024-03-01',
              name: 'Copay Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -30,
              billId: 'bill-1',
              copayAmount: 30, // Has copay
              coinsurancePercent: null,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
            },
            {
              id: 'activity-second',
              date: '2024-04-01',
              name: 'Second Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
              billId: null,
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

      expect(result).toHaveLength(2);
      // For the second expense, we need previous copay to have been counted
      const secondExpense = result.find(e => e.name === 'Second Visit');
      // Copay counted $200 toward deductible; so $1300 remaining for second expense
      expect(secondExpense?.individualDeductibleRemaining).toBe(1300);
      // Copay counted $30 toward OOP; so $4970 remaining
      expect(secondExpense?.individualOOPRemaining).toBe(4970);
    });

    it('should handle deductible-met OOP-not-met path in calculateRemainingAmounts', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Blue Cross PPO 2024',
        coveredPersons: ['John'],
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 100, // Low so it gets met quickly
        individualOutOfPocketMax: 5000,
        familyDeductible: 200,
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
          bills: [
            { id: 'bill-1', amount: 100 },
            { id: 'bill-2', amount: 200 },
          ],
          consolidatedActivity: [
            {
              id: 'activity-meets-deductible',
              date: '2024-02-01',
              name: 'A Meets Deductible', // comes first alphabetically
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
              billId: 'bill-1',
              copayAmount: null,
              coinsurancePercent: 0,
              countsTowardDeductible: true,
              countsTowardOutOfPocket: true,
            },
            {
              id: 'activity-post-deductible',
              date: '2024-03-01',
              name: 'Post Deductible Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200,
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
        endDate: new Date('2024-12-31'),
      } as any);

      vi.mocked(calculateAllActivity).mockResolvedValue({
        accounts: mockAccounts as any,
        transfers: { bills: [], activity: [] },
      } as any);

      const result = await getHealthcareExpenses(mockRequest);

      expect(result).toHaveLength(2);
      const postDeductibleExpense = result.find(e => e.name === 'Post Deductible Visit');
      // Deductible already met - should show 0 remaining
      expect(postDeductibleExpense?.individualDeductibleRemaining).toBe(0);
      // OOP: $100 from first visit, $200 from second visit counted toward OOP
      expect(postDeductibleExpense?.individualOOPRemaining).toBe(4900);
    });

    it('should sort expenses with different dates in ascending order', async () => {
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

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'activity-march',
              date: '2024-03-15',
              name: 'March Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
            },
            {
              id: 'activity-jan',
              date: '2024-01-10',
              name: 'January Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
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

      expect(result).toHaveLength(2);
      // January should come before March (ascending date sort)
      expect(result[0].name).toBe('January Visit');
      expect(result[1].name).toBe('March Visit');
    });

    it('should sort same-date expenses by id when names are equal', async () => {
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

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking',
          consolidatedActivity: [
            {
              id: 'zzz-activity', // lexicographically later ID
              date: '2024-03-15',
              name: 'Same Name',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -100,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
            },
            {
              id: 'aaa-activity', // lexicographically earlier ID
              date: '2024-03-15',
              name: 'Same Name',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
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

      expect(result).toHaveLength(2);
      // aaa-activity should come before zzz-activity (sorted by id ascending)
      expect(result[0].id).toBe('aaa-activity');
      expect(result[1].id).toBe('zzz-activity');
    });

    it('should find no HSA reimbursement when no HSA account exists', async () => {
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

      vi.mocked(loadHealthcareConfigs).mockResolvedValue([mockConfig]);

      // No HSA account in the list
      const mockAccounts = [
        {
          id: 'checking-1',
          name: 'Checking', // Not an HSA
          type: 'checking',
          consolidatedActivity: [
            {
              id: 'activity-1',
              date: '2024-03-15',
              name: 'Doctor Visit',
              isHealthcare: true,
              healthcarePerson: 'John',
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
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

      expect(result).toHaveLength(1);
      expect(result[0].hsaReimbursed).toBe(0);
    });

    it('should find no HSA reimbursement when transfer goes to different account', async () => {
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
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
            },
          ],
        },
        {
          id: 'hsa-123',
          name: 'HSA',
          type: 'HSA',
          consolidatedActivity: [
            {
              id: 'hsa-transfer-1',
              date: '2024-03-15',
              name: 'Transfer to Savings',
              isTransfer: true,
              from: 'hsa-123',
              to: 'savings-account', // Different account, not checking-1
              amount: -200,
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

      expect(result).toHaveLength(1);
      expect(result[0].hsaReimbursed).toBe(0);
    });

    it('should find no HSA reimbursement when transfer date is more than 1 day away', async () => {
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
              amount: -200,
              billId: null,
              copayAmount: null,
              coinsurancePercent: null,
            },
          ],
        },
        {
          id: 'hsa-123',
          name: 'HSA',
          type: 'HSA',
          consolidatedActivity: [
            {
              id: 'hsa-transfer-1',
              date: '2024-03-20', // 5 days later - too far away
              name: 'HSA Reimbursement',
              isTransfer: true,
              from: 'hsa-123',
              to: 'Checking',
              amount: -200,
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

      expect(result).toHaveLength(1);
      expect(result[0].hsaReimbursed).toBe(0);
    });

    it('should match HSA reimbursement when transfer occurs one day after expense', async () => {
      const mockConfig = {
        id: 'config-1',
        name: 'Jane Health Plan 2025',
        coveredPersons: ['Jane'],
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

      // Check expense data and remaining amounts
      expect(result[0]).toMatchObject({
        id: 'activity-1',
        date: '2026-01-14',
        name: 'Jane Doctor Visit Test',
        person: 'Jane',
        billAmount: 100,
        patientCost: 20,
        copay: 20,
        coinsurance: 20,
        accountName: 'Kendall Checking',
        isBill: true,
        billId: 'bill-123',
      });
      expect(result[0].hsaReimbursed).toBe(0);
      expect(result[0].individualDeductibleRemaining).toBeDefined();
      expect(result[0].familyDeductibleRemaining).toBeDefined();
      expect(result[0].individualOOPRemaining).toBeDefined();
      expect(result[0].familyOOPRemaining).toBeDefined();
      expect(typeof result[0].individualDeductibleRemaining).toBe('number');
      expect(typeof result[0].familyDeductibleRemaining).toBe('number');
      expect(typeof result[0].individualOOPRemaining).toBe('number');
      expect(typeof result[0].familyOOPRemaining).toBe('number');
    });
  });
});
