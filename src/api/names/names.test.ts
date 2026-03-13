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

  it('should get name categories from loaded data', async () => {
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

    const mockNameCategories = [
      { name: 'Bank Transfer', category: 'Transfer', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Electric Bill', category: 'Utilities', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Gas Station', category: 'Transportation', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Grocery Store', category: 'Food', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
    ];

    const mockRequest = createMockRequest({
      query: {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      },
    });

    vi.mocked(getData).mockResolvedValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue(mockNameCategories);

    const result = await getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual(mockNameCategories);
  });

  it('should handle empty accounts and transfers', async () => {
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

    vi.mocked(getData).mockResolvedValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue([]);

    const result = await getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual([]);
  });

  it('should pass through query parameters to getData', async () => {
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

    vi.mocked(getData).mockResolvedValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue([]);

    await getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
  });

  it('should handle accounts with multiple activities of same name', async () => {
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

    const mockNameCategories = [
      { name: 'Grocery Store', category: 'Food', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
    ];

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockResolvedValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue(mockNameCategories);

    const result = await getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual(mockNameCategories);
  });

  it('should handle complex data structures', async () => {
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

    const mockNameCategories = [
      { name: 'Auto Transfer', category: 'Transfer', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Interest Payment', category: 'Income', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Monthly Subscription', category: 'Subscriptions', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Movie Theater', category: 'Entertainment', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Restaurant', category: 'Food', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
      { name: 'Transfer to Savings', category: 'Transfer', isHealthcare: false, healthcarePerson: null, coinsurancePercent: null, isTransfer: false, from: null, to: null, spendingCategory: null },
    ];

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockResolvedValue(mockData as any);
    vi.mocked(loadNameCategories).mockReturnValue(mockNameCategories);

    const result = await getNameCategories(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(loadNameCategories).toHaveBeenCalledWith(mockAccountsAndTransfers);
    expect(result).toEqual(mockNameCategories);
  });
});
