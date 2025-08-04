import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getCalendarBills } from './bills';
import { getData } from '../../utils/net/request';
import { formatDate } from '../../utils/date/date';
import { CalendarBill } from '../../data/bill/types';

// Mock the dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/date/date');

const mockGetData = vi.mocked(getData);
const mockFormatDate = vi.mocked(formatDate);

describe('Calendar Bills API', () => {
  const mockRequest = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatDate.mockImplementation((date) => date.toISOString().split('T')[0]);
  });

  describe('getCalendarBills', () => {
    it('should return calendar bills for accounts within date range', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Checking Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({
                    id: 'bill-1',
                    name: 'Rent',
                    category: 'Housing',
                  })),
                },
              ],
            },
          ],
          transfers: {
            bills: [],
          },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        account: 'Checking Account',
        accountId: 'account-1',
        date: '2024-01-15',
        id: 'bill-1',
        name: 'Rent',
        category: 'Housing',
        amount: -500,
      });
    });

    it('should filter out bills outside date range', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Checking Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2023-12-31'), // Before start date
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
                {
                  date: new Date('2024-01-15'), // Within range
                  billId: 'bill-2',
                  amount: -300,
                  isTransfer: false,
                },
                {
                  date: new Date('2024-02-01'), // After end date
                  billId: 'bill-3',
                  amount: -200,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({ id: 'bill-1', name: 'Old Bill' })),
                },
                {
                  id: 'bill-2',
                  serialize: vi.fn(() => ({ id: 'bill-2', name: 'Current Bill' })),
                },
                {
                  id: 'bill-3',
                  serialize: vi.fn(() => ({ id: 'bill-3', name: 'Future Bill' })),
                },
              ],
            },
          ],
          transfers: { bills: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Current Bill');
    });

    it('should filter out non-selected accounts when selectedAccounts is specified', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Selected Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({ id: 'bill-1', name: 'Selected Bill' })),
                },
              ],
            },
            {
              id: 'account-2',
              name: 'Non-Selected Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-2',
                  amount: -300,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-2',
                  serialize: vi.fn(() => ({ id: 'bill-2', name: 'Non-Selected Bill' })),
                },
              ],
            },
          ],
          transfers: { bills: [] },
        },
        selectedAccounts: ['account-1'],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Selected Bill');
    });

    it('should filter out hidden accounts when no accounts are selected', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Visible Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({ id: 'bill-1', name: 'Visible Bill' })),
                },
              ],
            },
            {
              id: 'account-2',
              name: 'Hidden Account',
              hidden: true,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-2',
                  amount: -300,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-2',
                  serialize: vi.fn(() => ({ id: 'bill-2', name: 'Hidden Bill' })),
                },
              ],
            },
          ],
          transfers: { bills: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Visible Bill');
    });

    it('should handle transfer bills correctly', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Source Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'transfer-bill-1',
                  amount: -500, // Negative transfer (outgoing)
                  isTransfer: true,
                },
              ],
              bills: [],
            },
            {
              id: 'account-2',
              name: 'Destination Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'transfer-bill-1',
                  amount: 500, // Positive transfer (incoming)
                  isTransfer: true,
                },
              ],
              bills: [],
            },
          ],
          transfers: {
            bills: [
              {
                id: 'transfer-bill-1',
                serialize: vi.fn(() => ({
                  id: 'transfer-bill-1',
                  name: 'Monthly Transfer',
                  category: 'Transfer',
                })),
              },
            ],
          },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      // Should only show the negative transfer to avoid double-counting
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        account: 'Source Account',
        accountId: 'account-1',
        date: '2024-01-15',
        id: 'transfer-bill-1',
        name: 'Monthly Transfer',
        category: 'Transfer',
        amount: -500,
      });
    });

    it('should skip activities without billId', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Checking Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: null, // No bill ID
                  amount: -100,
                  isTransfer: false,
                },
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({ id: 'bill-1', name: 'Valid Bill' })),
                },
              ],
            },
          ],
          transfers: { bills: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Valid Bill');
    });

    it('should return empty array when no bills match criteria', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Checking Account',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2023-12-31'), // Outside date range
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({ id: 'bill-1', name: 'Old Bill' })),
                },
              ],
            },
          ],
          transfers: { bills: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(0);
    });

    it('should handle multiple accounts and bills', () => {
      const mockData = {
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              name: 'Checking',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-15'),
                  billId: 'bill-1',
                  amount: -500,
                  isTransfer: false,
                },
                {
                  date: new Date('2024-01-20'),
                  billId: 'bill-2',
                  amount: -300,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-1',
                  serialize: vi.fn(() => ({ id: 'bill-1', name: 'Rent' })),
                },
                {
                  id: 'bill-2',
                  serialize: vi.fn(() => ({ id: 'bill-2', name: 'Utilities' })),
                },
              ],
            },
            {
              id: 'account-2',
              name: 'Savings',
              hidden: false,
              consolidatedActivity: [
                {
                  date: new Date('2024-01-25'),
                  billId: 'bill-3',
                  amount: 1000,
                  isTransfer: false,
                },
              ],
              bills: [
                {
                  id: 'bill-3',
                  serialize: vi.fn(() => ({ id: 'bill-3', name: 'Salary' })),
                },
              ],
            },
          ],
          transfers: { bills: [] },
        },
        selectedAccounts: [],
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      mockGetData.mockReturnValue(mockData);

      const result = getCalendarBills(mockRequest);

      expect(result).toHaveLength(3);
      expect(result.map((bill) => bill.name)).toEqual(['Rent', 'Utilities', 'Salary']);
    });
  });
});
