import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getUsedVariables } from './usedVariables';
import { getData } from '../../utils/net/request';
import { loadUsedVariables } from '../../utils/simulation/loadUsedVariables';

// Mock the dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/simulation/loadUsedVariables');
vi.mock('../../utils/io/spendingTracker', () => ({
  loadSpendingTrackerCategories: vi.fn(() => []),
}));

const mockGetData = vi.mocked(getData);
const mockLoadUsedVariables = vi.mocked(loadUsedVariables);

describe('Used Variables API', () => {
  const mockRequest = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUsedVariables', () => {
    it('should return used variables from loadUsedVariables', async () => {
      const mockAccountsAndTransfers = {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
              endDateVariable: 'endDate',
          },
        ],
        transfers: {
          bills: [],
        },
      };

      const mockSocialSecurities = [
        {
          id: 'ss-1',
          name: 'Social Security',
        },
      ];

      const mockPensions = [
        {
          id: 'pension-1',
          name: 'Company Pension',
          retirementOffset: { years: 0, months: 0 },
          workStartDateVariable: 'careerStartDate',
        },
      ];

      const mockUsedVariables = ['retirementDate', 'endDate', 'birthDate', 'careerStartDate'];

      mockGetData.mockResolvedValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions,
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = await getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockGetData).toHaveBeenCalledWith(mockRequest);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(mockAccountsAndTransfers, mockSocialSecurities, mockPensions, []);
    });

    it('should handle empty data structures', async () => {
      const mockAccountsAndTransfers = {
        accounts: [],
        transfers: {
          bills: [],
        },
      };

      const mockSocialSecurities = [];
      const mockPensions = [];
      const mockUsedVariables = [];

      mockGetData.mockResolvedValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions,
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = await getUsedVariables(mockRequest);

      expect(result).toEqual([]);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(mockAccountsAndTransfers, mockSocialSecurities, mockPensions, []);
    });

    it('should handle complex data with multiple accounts and retirement plans', async () => {
      const mockAccountsAndTransfers = {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
              endDateVariable: 'simulationEndDate',
          },
          {
            id: 'account-2',
            name: 'Savings',
              endDateVariable: 'simulationEndDate',
          },
          {
            id: 'account-3',
            name: '401k',
              endDateVariable: 'simulationEndDate',
          },
        ],
        transfers: {
          bills: [
            {
              id: 'transfer-1',
                  endDateVariable: 'simulationEndDate',
            },
          ],
        },
      };

      const mockSocialSecurities = [
        {
          id: 'ss-1',
          name: 'Primary SS',
        },
        {
          id: 'ss-2',
          name: 'Spouse SS',
        },
      ];

      const mockPensions = [
        {
          id: 'pension-1',
          name: 'Company Pension',
          workStartDateVariable: 'careerStartDate',
        },
        {
          id: 'pension-2',
          name: 'Military Pension',
          workStartDateVariable: 'militaryStartDate',
        },
      ];

      const mockUsedVariables = [
        'retirementDate',
        'simulationEndDate',
        'birthDate',
        'careerStartDate',
        'spouseRetirementDate',
        'spouseBirthDate',
        'militaryRetirementDate',
        'militaryStartDate',
      ];

      mockGetData.mockResolvedValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions,
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = await getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(mockAccountsAndTransfers, mockSocialSecurities, mockPensions, []);
    });

    it('should handle data with only accounts and no retirement plans', async () => {
      const mockAccountsAndTransfers = {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
              endDateVariable: 'endDate',
          },
        ],
        transfers: {
          bills: [],
        },
      };

      const mockSocialSecurities = [];
      const mockPensions = [];
      const mockUsedVariables = ['startDate', 'endDate'];

      mockGetData.mockResolvedValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions,
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = await getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(mockAccountsAndTransfers, mockSocialSecurities, mockPensions, []);
    });

    it('should handle data with only retirement plans and no accounts', async () => {
      const mockAccountsAndTransfers = {
        accounts: [],
        transfers: {
          bills: [],
        },
      };

      const mockSocialSecurities = [
        {
          id: 'ss-1',
          name: 'Social Security',
        },
      ];

      const mockPensions = [
        {
          id: 'pension-1',
          name: 'Pension',
          workStartDateVariable: 'careerStartDate',
        },
      ];

      const mockUsedVariables = ['retirementDate', 'birthDate', 'careerStartDate'];

      mockGetData.mockResolvedValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions,
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = await getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(mockAccountsAndTransfers, mockSocialSecurities, mockPensions, []);
    });

    it('should handle null or undefined data gracefully', async () => {
      mockGetData.mockResolvedValue({
        accountsAndTransfers: null,
        socialSecurities: null,
        pensions: null,
      });

      mockLoadUsedVariables.mockReturnValue([]);

      const result = await getUsedVariables(mockRequest);

      expect(result).toEqual([]);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(null, null, null, []);
    });
  });
});
