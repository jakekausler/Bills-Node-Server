import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCategorySectionBreakdown } from './breakdown';
import { getData } from '../../../utils/net/request';
import { createMockRequest } from '../../../utils/test/mockData';

// Mock dependencies
vi.mock('../../../utils/net/request');

describe('getCategorySectionBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should calculate category breakdown for a section', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Groceries',
                amount: -100,
                isTransfer: false,
              },
              {
                category: 'Food.Restaurants',
                amount: -50,
                isTransfer: false,
              },
              {
                category: 'Food.Groceries',
                amount: -25,
                isTransfer: false,
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(result).toEqual({
      'Groceries': 125,
      'Restaurants': 50,
    });
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
                category: 'Food.Groceries',
                amount: -100,
                isTransfer: false,
              },
            ],
          },
          {
            id: 'account-2',
            name: 'Savings',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Restaurants',
                amount: -50,
                isTransfer: false,
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Groceries': 100,
    });
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
                category: 'Food.Groceries',
                amount: -100,
                isTransfer: false,
              },
            ],
          },
          {
            id: 'account-2',
            name: 'Hidden Account',
            hidden: true,
            consolidatedActivity: [
              {
                category: 'Food.Restaurants',
                amount: -50,
                isTransfer: false,
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Groceries': 100,
    });
  });

  it('should handle transfer activities with half amount adjustment', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Transfer',
                amount: -200,
                isTransfer: true,
                to: 'account-2',
                fro: 'account-1',
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: ['account-1', 'account-2'],
    };

    const mockRequest = createMockRequest({
      params: { section: 'Food' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Transfer': 100, // Half of 200
    });
  });

  it('should handle transfer activities with full amount when other account not selected', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Transfer',
                amount: -200,
                isTransfer: true,
                to: 'account-2',
                fro: 'account-1',
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Transfer': 200, // Full amount
    });
  });

  it('should exclude activities that do not match section', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Groceries',
                amount: -100,
                isTransfer: false,
              },
              {
                category: 'Transportation.Gas',
                amount: -50,
                isTransfer: false,
              },
              {
                category: 'Food.Restaurants',
                amount: -25,
                isTransfer: false,
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Groceries': 100,
      'Restaurants': 25,
    });
  });

  it('should exclude positive amounts (credits) from breakdown', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Groceries',
                amount: -100,
                isTransfer: false,
              },
              {
                category: 'Food.Refund',
                amount: 50,
                isTransfer: false,
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Groceries': 100,
      // 'Refund' should be excluded because it's positive
    });
  });

  it('should handle empty section', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: 'Food.Groceries',
                amount: -100,
                isTransfer: false,
              },
            ],
          },
        ],
        transfers: { activity: [], bills: [] },
      },
      selectedAccounts: [],
    };

    const mockRequest = createMockRequest({
      params: { section: 'NonExistent' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({});
  });

  it('should handle activities with null or undefined category', () => {
    const mockData = {
      accountsAndTransfers: {
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            hidden: false,
            consolidatedActivity: [
              {
                category: null,
                amount: -100,
                isTransfer: false,
              },
              {
                category: undefined,
                amount: -50,
                isTransfer: false,
              },
              {
                category: 'Food.Groceries',
                amount: -25,
                isTransfer: false,
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

    vi.mocked(getData).mockReturnValue(mockData as any);

    const result = getCategorySectionBreakdown(mockRequest);

    expect(result).toEqual({
      'Groceries': 25,
    });
  });
});