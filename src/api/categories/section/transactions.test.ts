import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCategorySectionTransactions } from './transactions';
import { getData } from '../../../utils/net/request';
import { createMockRequest } from '../../../utils/test/mockData';

// Mock dependencies
vi.mock('../../../utils/net/request');

describe('getCategorySectionTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return transactions for a specific category section', async () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                id: 'activity-1',
                category: 'Food.Groceries',
                amount: -100,
                name: 'Supermarket',
                date: '2024-01-15',
                serialize: () => ({
                  id: 'activity-1',
                  category: 'Food.Groceries',
                  amount: -100,
                  name: 'Supermarket',
                  date: '2024-01-15',
                }),
              },
              {
                id: 'activity-2',
                category: 'Food.Restaurants',
                amount: -50,
                name: 'Restaurant',
                date: '2024-01-16',
                serialize: () => ({
                  id: 'activity-2',
                  category: 'Food.Restaurants',
                  amount: -50,
                  name: 'Restaurant',
                  date: '2024-01-16',
                }),
              },
              {
                id: 'activity-3',
                category: 'Transportation.Gas',
                amount: -30,
                name: 'Gas Station',
                date: '2024-01-17',
                serialize: () => ({
                  id: 'activity-3',
                  category: 'Transportation.Gas',
                  amount: -30,
                  name: 'Gas Station',
                  date: '2024-01-17',
                }),
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(result).toEqual([
      {
        id: 'activity-1',
        category: 'Food.Groceries',
        amount: -100,
        name: 'Supermarket',
        date: '2024-01-15',
      },
      {
        id: 'activity-2',
        category: 'Food.Restaurants',
        amount: -50,
        name: 'Restaurant',
        date: '2024-01-16',
      },
    ]);
  });

  it('should handle selected accounts filtering', async () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                id: 'activity-1',
                category: 'Food.Groceries',
                amount: -100,
                name: 'Supermarket',
                serialize: () => ({
                  id: 'activity-1',
                  category: 'Food.Groceries',
                  amount: -100,
                  name: 'Supermarket',
                }),
              },
            ],
          },
          {
            id: 'account-2',
            name: 'Savings',
            hidden: false,
            consolidatedActivity: [
              {
                id: 'activity-2',
                category: 'Food.Restaurants',
                amount: -50,
                name: 'Restaurant',
                serialize: () => ({
                  id: 'activity-2',
                  category: 'Food.Restaurants',
                  amount: -50,
                  name: 'Restaurant',
                }),
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: ['account-1'],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(result).toEqual([
      {
        id: 'activity-1',
        category: 'Food.Groceries',
        amount: -100,
        name: 'Supermarket',
      },
    ]);
  });

  it('should handle hidden accounts filtering', async () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                id: 'activity-1',
                category: 'Food.Groceries',
                amount: -100,
                name: 'Supermarket',
                serialize: () => ({
                  id: 'activity-1',
                  category: 'Food.Groceries',
                  amount: -100,
                  name: 'Supermarket',
                }),
              },
            ],
          },
          {
            id: 'account-2',
            name: 'Hidden Account',
            hidden: true,
            consolidatedActivity: [
              {
                id: 'activity-2',
                category: 'Food.Restaurants',
                amount: -50,
                name: 'Restaurant',
                serialize: () => ({
                  id: 'activity-2',
                  category: 'Food.Restaurants',
                  amount: -50,
                  name: 'Restaurant',
                }),
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(result).toEqual([
      {
        id: 'activity-1',
        category: 'Food.Groceries',
        amount: -100,
        name: 'Supermarket',
      },
    ]);
  });

  it('should deduplicate transactions by ID', async () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                id: 'activity-1',
                category: 'Food.Groceries',
                amount: -100,
                name: 'Supermarket',
                serialize: () => ({
                  id: 'activity-1',
                  category: 'Food.Groceries',
                  amount: -100,
                  name: 'Supermarket',
                }),
              },
              {
                id: 'activity-1', // Same ID
                category: 'Food.Groceries',
                amount: -100,
                name: 'Supermarket',
                serialize: () => ({
                  id: 'activity-1',
                  category: 'Food.Groceries',
                  amount: -100,
                  name: 'Supermarket',
                }),
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('activity-1');
  });

  it('should return empty array for non-matching section', async () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                id: 'activity-1',
                category: 'Transportation.Gas',
                amount: -30,
                name: 'Gas Station',
                serialize: () => ({
                  id: 'activity-1',
                  category: 'Transportation.Gas',
                  amount: -30,
                  name: 'Gas Station',
                }),
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(result).toEqual([]);
  });

  it('should handle empty accounts', async () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(result).toEqual([]);
  });

  it('should serialize activities before returning', async () => {
    const mockSerializedData = {
      id: 'activity-1',
      category: 'Food.Groceries',
      amount: -100,
      name: 'Supermarket',
      serialized: true,
    };

    const mockActivity = {
      id: 'activity-1',
      category: 'Food.Groceries',
      amount: -100,
      name: 'Supermarket',
      serialize: vi.fn().mockReturnValue(mockSerializedData),
    };

    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [mockActivity],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);

    const result = await getCategorySectionTransactions(mockRequest);

    expect(mockActivity.serialize).toHaveBeenCalled();
    expect(result).toEqual([mockSerializedData]);
  });
});
