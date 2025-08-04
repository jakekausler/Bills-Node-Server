import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNameCategories } from './names';
import { getData } from '../../utils/net/request';
import { loadNameCategories } from '../../utils/names/names';
import { createMockRequest } from '../../utils/test/mockData';

// Mock dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/names/names');

describe('getNameCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get name categories from loaded data', () => {
    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'account-1',
          activity: [
            { name: 'Grocery Store', category: 'Food' },
            { name: 'Gas Station', category: 'Transportation' },
          ],
          bills: [{ name: 'Electric Bill', category: 'Utilities' }],
        },
      ],
      transfers: {
        activity: [{ name: 'Bank Transfer', category: 'Transfer' }],
        bills: [],
      },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockNameCategories = {
      'Grocery Store': 'Food',
      'Gas Station': 'Transportation',
      'Electric Bill': 'Utilities',
      'Bank Transfer': 'Transfer',
    };

    const mockRequest = createMockRequest({
      query: {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue(mockNameCategories);

    const result = getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual(mockNameCategories);
  });

  it('should handle empty accounts and transfers', () => {
    const mockAccountsAndTransfers = {
      accounts: [],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue({});

    const result = getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual({});
  });

  it('should pass through query parameters to getData', () => {
    const mockAccountsAndTransfers = {
      accounts: [],
      transfers: { activity: [], bills: [] },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
    };

    const mockRequest = createMockRequest({
      query: {
        simulation: 'TestSim',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue({});

    getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
  });

  it('should handle accounts with multiple activities of same name', () => {
    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'account-1',
          activity: [
            { name: 'Grocery Store', category: 'Food' },
            { name: 'Grocery Store', category: 'Food' },
            { name: 'Grocery Store', category: 'Household' },
          ],
          bills: [],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
    };

    const mockNameCategories = {
      'Grocery Store': 'Food', // Most frequent category
    };

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue(mockNameCategories);

    const result = getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual(mockNameCategories);
  });

  it('should handle complex data structures', () => {
    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'checking',
          activity: [
            { name: 'Restaurant', category: 'Food' },
            { name: 'Movie Theater', category: 'Entertainment' },
          ],
          bills: [{ name: 'Monthly Subscription', category: 'Subscriptions' }],
        },
        {
          id: 'savings',
          activity: [{ name: 'Interest Payment', category: 'Income' }],
          bills: [],
        },
      ],
      transfers: {
        activity: [{ name: 'Transfer to Savings', category: 'Transfer' }],
        bills: [{ name: 'Auto Transfer', category: 'Transfer' }],
      },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
    };

    const mockNameCategories = {
      Restaurant: 'Food',
      'Movie Theater': 'Entertainment',
      'Monthly Subscription': 'Subscriptions',
      'Interest Payment': 'Income',
      'Transfer to Savings': 'Transfer',
      'Auto Transfer': 'Transfer',
    };

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue(mockNameCategories);

    const result = getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual(mockNameCategories);
  });
});
