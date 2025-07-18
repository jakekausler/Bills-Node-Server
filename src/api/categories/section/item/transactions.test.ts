import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCategorySectionItemTransactions } from './transactions';
import { getData } from '../../../../utils/net/request';
import { createMockRequest } from '../../../../utils/test/mockData';

// Mock dependencies
vi.mock('../../../../utils/net/request');

describe('getCategorySectionItemTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return transactions for a specific category item', () => {
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
                category: 'Food.Groceries',
                amount: -25,
                name: 'Another Store',
                date: '2024-01-17',
                serialize: () => ({
                  id: 'activity-3',
                  category: 'Food.Groceries',
                  amount: -25,
                  name: 'Another Store',
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

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
        id: 'activity-3',
        category: 'Food.Groceries',
        amount: -25,
        name: 'Another Store',
        date: '2024-01-17',
      },
    ]);
  });

  it('should handle selected accounts filtering', () => {
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
                category: 'Food.Groceries',
                amount: -50,
                name: 'Another Store',
                serialize: () => ({
                  id: 'activity-2',
                  category: 'Food.Groceries',
                  amount: -50,
                  name: 'Another Store',
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(result).toEqual([
      {
        id: 'activity-1',
        category: 'Food.Groceries',
        amount: -100,
        name: 'Supermarket',
      },
    ]);
  });

  it('should handle hidden accounts filtering', () => {
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
                category: 'Food.Groceries',
                amount: -50,
                name: 'Hidden Store',
                serialize: () => ({
                  id: 'activity-2',
                  category: 'Food.Groceries',
                  amount: -50,
                  name: 'Hidden Store',
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(result).toEqual([
      {
        id: 'activity-1',
        category: 'Food.Groceries',
        amount: -100,
        name: 'Supermarket',
      },
    ]);
  });

  it('should deduplicate transactions by ID', () => {
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('activity-1');
  });

  it('should exclude transactions from other category items', () => {
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
              {
                id: 'activity-3',
                category: 'Transportation.Gas',
                amount: -30,
                name: 'Gas Station',
                serialize: () => ({
                  id: 'activity-3',
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(result).toEqual([
      {
        id: 'activity-1',
        category: 'Food.Groceries',
        amount: -100,
        name: 'Supermarket',
      },
    ]);
  });

  it('should return empty array for non-matching category item', () => {
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
                category: 'Food.Restaurants',
                amount: -50,
                name: 'Restaurant',
                serialize: () => ({
                  id: 'activity-1',
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(result).toEqual([]);
  });

  it('should handle empty accounts', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(result).toEqual([]);
  });

  it('should serialize activities before returning', () => {
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
      params: { section: 'Food', item: 'Groceries' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionItemTransactions(mockRequest);

    expect(mockActivity.serialize).toHaveBeenCalled();
    expect(result).toEqual([mockSerializedData]);
  });
});