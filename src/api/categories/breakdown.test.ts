import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getCategoryBreakdown } from './breakdown';
import { getData } from '../../utils/net/request';

// Mock the dependencies
vi.mock('../../utils/net/request');

const mockGetData = vi.mocked(getData);

describe('Category Breakdown API', () => {
  const mockRequest = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCategoryBreakdown', () => {
    it('should calculate category breakdown for all accounts when none selected', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: false,
                },
                {
                  category: 'Food.Groceries',
                  amount: -300,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1500,
        Food: 300,
      });
    });

    it('should filter out hidden accounts when no accounts selected', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: false,
                },
              ],
            },
            {
              id: 'account-2',
              hidden: true,
              consolidatedActivity: [
                {
                  category: 'Food.Groceries',
                  amount: -300,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1500,
      });
    });

    it('should only include selected accounts when specified', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: false,
                },
              ],
            },
            {
              id: 'account-2',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Food.Groceries',
                  amount: -300,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: ['account-1'],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1500,
      });
    });

    it('should skip activities with empty categories', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: '',
                  amount: -1500,
                  isTransfer: false,
                },
                {
                  category: 'Housing.Rent',
                  amount: -1000,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1000,
      });
    });

    it('should skip Ignore and Income categories', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Ignore.SomeItem',
                  amount: -500,
                  isTransfer: false,
                },
                {
                  category: 'Income.Salary',
                  amount: 5000,
                  isTransfer: false,
                },
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1500,
      });
    });

    it('should handle transfers with half amount calculation', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: true,
                  to: 'account-2',
                  fro: 'account-1',
                },
              ],
            },
            {
              id: 'account-2',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: 1500,
                  isTransfer: true,
                  to: 'account-2',
                  fro: 'account-1',
                },
              ],
            },
          ],
        },
        selectedAccounts: ['account-1', 'account-2'],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      // For transfers, both sides are processed:
      // account-1: -1500 * 0.5 = -750 (subtracted from Housing)
      // account-2: 1500 * 0.5 = 750 (added to Housing)
      // Net result: -750 + 750 = 0, which gets filtered out
      expect(result).toEqual({});
    });

    it('should handle transfers with full amount when other account not selected', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: true,
                  to: 'account-2',
                  fro: 'account-1',
                },
              ],
            },
          ],
        },
        selectedAccounts: ['account-1'], // Only account-1 selected
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      // Transfer logic: ret[section] -= (-1500) = ret[section] += 1500
      // But positive values are filtered out because they're not expenses
      // This is correct behavior - transfers shouldn't count as spending
      expect(result).toEqual({});
    });

    it('should remove positive category totals', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: false,
                },
                {
                  category: 'Income.Salary',
                  amount: 5000,
                  isTransfer: false,
                },
                {
                  category: 'Refund.Tax',
                  amount: 200,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1500,
      });
      // Income and Refund should be filtered out (Income by skip logic, Refund by positive amount)
    });

    it('should handle multiple items in same category', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500,
                  isTransfer: false,
                },
                {
                  category: 'Housing.Utilities',
                  amount: -200,
                  isTransfer: false,
                },
                {
                  category: 'Housing.Insurance',
                  amount: -100,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1800, // Sum of all Housing expenses
      });
    });

    it('should handle rounding correctly', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Housing.Rent',
                  amount: -1500.999,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({
        Housing: 1501, // Rounded to nearest cent
      });
    });

    it('should return empty object when no expenses match criteria', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              hidden: false,
              consolidatedActivity: [
                {
                  category: 'Income.Salary',
                  amount: 5000,
                  isTransfer: false,
                },
                {
                  category: 'Ignore.Transfer',
                  amount: -100,
                  isTransfer: false,
                },
              ],
            },
          ],
        },
        selectedAccounts: [],
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCategoryBreakdown(mockRequest);

      expect(result).toEqual({});
    });
  });
});
