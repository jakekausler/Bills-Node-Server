import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getAccountBills, addBill } from './bills';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { Bill } from '../../../data/bill/bill';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');
vi.mock('../../../utils/io/accountsAndTransfers');
vi.mock('../../../data/bill/bill');

const mockGetData = vi.mocked(getData);
const mockGetById = vi.mocked(getById);
const mockSaveData = vi.mocked(saveData);
const mockBillConstructor = vi.mocked(Bill);

// Mock classes
const mockBillInstance = {
  id: 'bill-123',
  serialize: vi.fn(() => ({ id: 'bill-123', name: 'Test Bill' })),
};

const mockAccount = {
  bills: [mockBillInstance],
};

const mockData = {
  accountsAndTransfers: {
    accounts: [mockAccount],
    transfers: {
      bills: [],
    },
  },
  simulation: 'test-sim',
};

const mockRequest = {
  params: { accountId: 'account-123' },
} as unknown as Request;

describe('Bills API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetData.mockReturnValue(mockData);
    mockGetById.mockReturnValue(mockAccount);
  });

  describe('getAccountBills', () => {
    it('should return serialized bills for an account', () => {
      const result = getAccountBills(mockRequest);

      expect(mockGetData).toHaveBeenCalledWith(mockRequest);
      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockBillInstance.serialize).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'bill-123', name: 'Test Bill' }]);
    });

    it('should return empty array if account has no bills', () => {
      const emptyAccount = { bills: [] };
      mockGetById.mockReturnValue(emptyAccount);

      const result = getAccountBills(mockRequest);

      expect(result).toEqual([]);
    });
  });

  describe('addBill', () => {
    const mockBillData = {
      data: {
        name: 'New Bill',
        isTransfer: false,
      },
      accountsAndTransfers: mockData.accountsAndTransfers,
      simulation: 'test-sim',
    };

    beforeEach(() => {
      // Mock Bill constructor
      mockBillConstructor.mockImplementation(() => ({ id: 'new-bill-123' }) as any);
    });

    it('should add bill to account when not a transfer', () => {
      mockGetData.mockReturnValue(mockBillData);

      const result = addBill(mockRequest);

      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockAccount.bills).toHaveLength(2); // Original + new bill
      expect(mockSaveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('new-bill-123');
    });

    it('should add bill to transfers when isTransfer is true', () => {
      const transferBillData = {
        ...mockBillData,
        data: { ...mockBillData.data, isTransfer: true },
      };
      mockGetData.mockReturnValue(transferBillData);

      const result = addBill(mockRequest);

      expect(mockData.accountsAndTransfers.transfers.bills).toHaveLength(1);
      expect(mockSaveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('new-bill-123');
    });
  });
});
