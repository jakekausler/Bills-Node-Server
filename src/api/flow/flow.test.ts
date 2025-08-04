import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFlow } from './flow';
import { getData } from '../../utils/net/request';
import { createMockRequest } from '../../utils/test/mockData';

// Mock dependencies
vi.mock('../../utils/net/request');

describe('getFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty object as placeholder', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getFlow(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(result).toEqual({});
  });

  it('should pass through query parameters to getData', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: ['account-1'],
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockRequest = createMockRequest({
      query: {
        selectedAccounts: 'account-1',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getFlow(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(result).toEqual({});
  });

  it('should handle different request configurations', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [{ id: 'account-1', name: 'Test Account' }],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: ['account-1'],
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-30'),
    };

    const mockRequest = createMockRequest({
      query: {
        selectedAccounts: 'account-1',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        simulation: 'TestSim',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getFlow(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(result).toEqual({});
  });
});
