import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getAccountGraph, getGraphForAccounts } from './graph';
import { getData, getSelectedSimulations } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { loadGraph } from '../../utils/graph/graph';

// Mock dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/array/array');
vi.mock('../../utils/graph/graph');

const mockGetData = vi.mocked(getData);
const mockGetSelectedSimulations = vi.mocked(getSelectedSimulations);
const mockGetById = vi.mocked(getById);
const mockLoadGraph = vi.mocked(loadGraph);

const mockAccount = {
  id: 'account-123',
  name: 'Test Account',
  hidden: false,
};

const mockGraphData = {
  type: 'activity' as const,
  labels: ['2023-01-01', '2023-01-02'],
  datasets: [
    {
      label: 'Test Account',
      data: [1000, 1100],
      activity: [[], []],
    },
  ],
};

const mockRequestData = {
  accountsAndTransfers: {
    accounts: [mockAccount],
    transfers: { activity: [], bills: [] },
  },
  startDate: new Date('2023-01-01T00:00:00Z'),
  endDate: new Date('2023-12-31T23:59:59Z'),
  selectedAccounts: [],
};

describe('Graph API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetData.mockReturnValue(mockRequestData);
    mockGetById.mockReturnValue(mockAccount);
    mockLoadGraph.mockReturnValue(mockGraphData);
  });

  describe('getAccountGraph', () => {
    const mockRequest = {
      params: { accountId: 'account-123' },
      query: {},
    } as unknown as Request;

    it('should return graph data for a specific account', () => {
      const result = getAccountGraph(mockRequest);

      expect(mockGetData).toHaveBeenCalledWith(mockRequest);
      expect(mockGetById).toHaveBeenCalledWith(mockRequestData.accountsAndTransfers.accounts, 'account-123');
      expect(mockLoadGraph).toHaveBeenCalledWith(
        {
          accounts: [mockAccount],
          transfers: { activity: [], bills: [] },
        },
        mockRequestData.startDate,
        mockRequestData.endDate,
      );
      expect(result).toEqual(mockGraphData);
    });

    it('should handle different date ranges', () => {
      const customData = {
        ...mockRequestData,
        startDate: new Date('2023-06-01T00:00:00Z'),
        endDate: new Date('2023-08-31T23:59:59Z'),
      };
      mockGetData.mockReturnValue(customData);

      getAccountGraph(mockRequest);

      expect(mockLoadGraph).toHaveBeenCalledWith(expect.any(Object), customData.startDate, customData.endDate);
    });
  });

  describe('getGraphForAccounts', () => {
    const mockRequest = {
      query: {},
      params: {},
    } as unknown as Request;

    beforeEach(() => {
      mockGetSelectedSimulations.mockReturnValue(['Default']);
    });

    it('should return graph data for multiple simulations', () => {
      mockGetSelectedSimulations.mockReturnValue(['Default', 'Conservative']);

      const result = getGraphForAccounts(mockRequest);

      expect(mockGetSelectedSimulations).toHaveBeenCalledWith(mockRequest, ['Default']);
      expect(mockGetData).toHaveBeenCalledTimes(2); // Once for each simulation
      expect(mockLoadGraph).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        Default: mockGraphData,
        Conservative: mockGraphData,
      });
    });

    it('should use selected accounts when provided', () => {
      const dataWithSelectedAccounts = {
        ...mockRequestData,
        selectedAccounts: ['account-123', 'account-456'],
      };
      mockGetData.mockReturnValue(dataWithSelectedAccounts);
      mockGetById.mockReturnValueOnce(mockAccount).mockReturnValueOnce({ id: 'account-456', name: 'Second Account' });

      getGraphForAccounts(mockRequest);

      expect(mockGetById).toHaveBeenCalledTimes(2);
      expect(mockGetById).toHaveBeenCalledWith(mockRequestData.accountsAndTransfers.accounts, 'account-123');
      expect(mockGetById).toHaveBeenCalledWith(mockRequestData.accountsAndTransfers.accounts, 'account-456');
    });

    it('should filter out hidden accounts when no accounts selected', () => {
      const accountsWithHidden = [
        { id: 'account-1', name: 'Visible Account', hidden: false },
        { id: 'account-2', name: 'Hidden Account', hidden: true },
        { id: 'account-3', name: 'Another Visible', hidden: false },
      ];

      const dataWithHiddenAccounts = {
        ...mockRequestData,
        accountsAndTransfers: {
          ...mockRequestData.accountsAndTransfers,
          accounts: accountsWithHidden,
        },
        selectedAccounts: [],
      };
      mockGetData.mockReturnValue(dataWithHiddenAccounts);

      getGraphForAccounts(mockRequest);

      expect(mockLoadGraph).toHaveBeenCalledWith(
        {
          accounts: [
            { id: 'account-1', name: 'Visible Account', hidden: false },
            { id: 'account-3', name: 'Another Visible', hidden: false },
          ],
          transfers: { activity: [], bills: [] },
        },
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('should handle single simulation', () => {
      mockGetSelectedSimulations.mockReturnValue(['Custom']);

      const result = getGraphForAccounts(mockRequest);

      expect(result).toHaveProperty('Custom');
      expect(Object.keys(result)).toHaveLength(1);
    });

    it('should handle empty selected simulations with default', () => {
      mockGetSelectedSimulations.mockReturnValue(['Default']);

      const result = getGraphForAccounts(mockRequest);

      expect(result).toHaveProperty('Default');
      expect(Object.keys(result)).toHaveLength(1);
    });

    it('should modify request query simulation for each iteration', () => {
      mockGetSelectedSimulations.mockReturnValue(['Sim1', 'Sim2']);

      getGraphForAccounts(mockRequest);

      // The request.query.simulation should be set for each simulation
      expect(mockRequest.query.simulation).toBe('Sim2'); // Last one processed
    });

    it('should handle empty accounts array', () => {
      const dataWithNoAccounts = {
        ...mockRequestData,
        accountsAndTransfers: {
          ...mockRequestData.accountsAndTransfers,
          accounts: [],
        },
      };
      mockGetData.mockReturnValue(dataWithNoAccounts);

      const result = getGraphForAccounts(mockRequest);

      expect(mockLoadGraph).toHaveBeenCalledWith(
        {
          accounts: [],
          transfers: { activity: [], bills: [] },
        },
        expect.any(Date),
        expect.any(Date),
      );
      expect(result).toHaveProperty('Default');
    });
  });
});
