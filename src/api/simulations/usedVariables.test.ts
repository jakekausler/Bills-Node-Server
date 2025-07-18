import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getUsedVariables } from './usedVariables';
import { getData } from '../../utils/net/request';
import { loadUsedVariables } from '../../utils/simulation/loadUsedVariables';

// Mock the dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/simulation/loadUsedVariables');

const mockGetData = vi.mocked(getData);
const mockLoadUsedVariables = vi.mocked(loadUsedVariables);

describe('Used Variables API', () => {
  const mockRequest = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUsedVariables', () => {
    it('should return used variables from loadUsedVariables', () => {
      const mockAccountsAndTransfers = {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            startDateVariable: 'retirementDate',
            endDateVariable: 'endDate'
          }
        ],
        transfers: {
          bills: []
        }
      };

      const mockSocialSecurities = [
        {
          id: 'ss-1',
          name: 'Social Security',
          startDateVariable: 'retirementDate',
          birthDateVariable: 'birthDate'
        }
      ];

      const mockPensions = [
        {
          id: 'pension-1',
          name: 'Company Pension',
          startDateVariable: 'retirementDate',
          birthDateVariable: 'birthDate',
          workStartDateVariable: 'careerStartDate'
        }
      ];

      const mockUsedVariables = [
        'retirementDate',
        'endDate',
        'birthDate',
        'careerStartDate'
      ];

      mockGetData.mockReturnValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockGetData).toHaveBeenCalledWith(mockRequest);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(
        mockAccountsAndTransfers,
        mockSocialSecurities,
        mockPensions
      );
    });

    it('should handle empty data structures', () => {
      const mockAccountsAndTransfers = {
        accounts: [],
        transfers: {
          bills: []
        }
      };

      const mockSocialSecurities = [];
      const mockPensions = [];
      const mockUsedVariables = [];

      mockGetData.mockReturnValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = getUsedVariables(mockRequest);

      expect(result).toEqual([]);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(
        mockAccountsAndTransfers,
        mockSocialSecurities,
        mockPensions
      );
    });

    it('should handle complex data with multiple accounts and retirement plans', () => {
      const mockAccountsAndTransfers = {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            startDateVariable: 'retirementDate',
            endDateVariable: 'simulationEndDate'
          },
          {
            id: 'account-2',
            name: 'Savings',
            startDateVariable: 'retirementDate',
            endDateVariable: 'simulationEndDate'
          },
          {
            id: 'account-3',
            name: '401k',
            startDateVariable: 'retirementDate',
            endDateVariable: 'simulationEndDate'
          }
        ],
        transfers: {
          bills: [
            {
              id: 'transfer-1',
              startDateVariable: 'retirementDate',
              endDateVariable: 'simulationEndDate'
            }
          ]
        }
      };

      const mockSocialSecurities = [
        {
          id: 'ss-1',
          name: 'Primary SS',
          startDateVariable: 'retirementDate',
          birthDateVariable: 'birthDate'
        },
        {
          id: 'ss-2',
          name: 'Spouse SS',
          startDateVariable: 'spouseRetirementDate',
          birthDateVariable: 'spouseBirthDate'
        }
      ];

      const mockPensions = [
        {
          id: 'pension-1',
          name: 'Company Pension',
          startDateVariable: 'retirementDate',
          birthDateVariable: 'birthDate',
          workStartDateVariable: 'careerStartDate'
        },
        {
          id: 'pension-2',
          name: 'Military Pension',
          startDateVariable: 'militaryRetirementDate',
          birthDateVariable: 'birthDate',
          workStartDateVariable: 'militaryStartDate'
        }
      ];

      const mockUsedVariables = [
        'retirementDate',
        'simulationEndDate',
        'birthDate',
        'careerStartDate',
        'spouseRetirementDate',
        'spouseBirthDate',
        'militaryRetirementDate',
        'militaryStartDate'
      ];

      mockGetData.mockReturnValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(
        mockAccountsAndTransfers,
        mockSocialSecurities,
        mockPensions
      );
    });

    it('should handle data with only accounts and no retirement plans', () => {
      const mockAccountsAndTransfers = {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            startDateVariable: 'startDate',
            endDateVariable: 'endDate'
          }
        ],
        transfers: {
          bills: []
        }
      };

      const mockSocialSecurities = [];
      const mockPensions = [];
      const mockUsedVariables = ['startDate', 'endDate'];

      mockGetData.mockReturnValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(
        mockAccountsAndTransfers,
        mockSocialSecurities,
        mockPensions
      );
    });

    it('should handle data with only retirement plans and no accounts', () => {
      const mockAccountsAndTransfers = {
        accounts: [],
        transfers: {
          bills: []
        }
      };

      const mockSocialSecurities = [
        {
          id: 'ss-1',
          name: 'Social Security',
          startDateVariable: 'retirementDate',
          birthDateVariable: 'birthDate'
        }
      ];

      const mockPensions = [
        {
          id: 'pension-1',
          name: 'Pension',
          startDateVariable: 'retirementDate',
          birthDateVariable: 'birthDate',
          workStartDateVariable: 'careerStartDate'
        }
      ];

      const mockUsedVariables = ['retirementDate', 'birthDate', 'careerStartDate'];

      mockGetData.mockReturnValue({
        accountsAndTransfers: mockAccountsAndTransfers,
        socialSecurities: mockSocialSecurities,
        pensions: mockPensions
      });

      mockLoadUsedVariables.mockReturnValue(mockUsedVariables);

      const result = getUsedVariables(mockRequest);

      expect(result).toEqual(mockUsedVariables);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(
        mockAccountsAndTransfers,
        mockSocialSecurities,
        mockPensions
      );
    });

    it('should handle null or undefined data gracefully', () => {
      mockGetData.mockReturnValue({
        accountsAndTransfers: null,
        socialSecurities: null,
        pensions: null
      });

      mockLoadUsedVariables.mockReturnValue([]);

      const result = getUsedVariables(mockRequest);

      expect(result).toEqual([]);
      expect(mockLoadUsedVariables).toHaveBeenCalledWith(null, null, null);
    });
  });
});