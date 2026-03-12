import { describe, it, expect } from 'vitest';
import { getFlow } from './flow';
import { createMockRequest } from '../../utils/test/mockData';

describe('getFlow', () => {
  it('should return empty object as placeholder', async () => {
    const mockRequest = createMockRequest();

    const result = await getFlow(mockRequest);

    expect(result).toEqual({});
  });

  it('should return empty object regardless of query parameters', async () => {
    const mockRequest = createMockRequest({
      query: {
        selectedAccounts: 'account-1',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      },
    });

    const result = await getFlow(mockRequest);

    expect(result).toEqual({});
  });

  it('should return empty object for different request configurations', async () => {
    const mockRequest = createMockRequest({
      query: {
        selectedAccounts: 'account-1',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        simulation: 'TestSim',
      },
    });

    const result = await getFlow(mockRequest);

    expect(result).toEqual({});
  });
});
