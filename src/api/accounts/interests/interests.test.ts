import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getAccountInterests, addInterest, updateInterest, deleteInterest } from './interests';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { Interest } from '../../../data/interest/interest';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');
vi.mock('../../../utils/io/accountsAndTransfers');
vi.mock('../../../data/interest/interest');

const mockGetData = vi.mocked(getData);
const mockGetById = vi.mocked(getById);
const mockSaveData = vi.mocked(saveData);
const mockInterestConstructor = vi.mocked(Interest);

// Mock classes
const mockInterestInstance = {
  id: 'interest-123',
  serialize: vi.fn(() => ({ id: 'interest-123', rate: 0.05 }))
};

const mockAccount = {
  interests: [mockInterestInstance]
};

const mockData = {
  accountsAndTransfers: {
    accounts: [mockAccount]
  }
};

const mockRequest = {
  params: { accountId: 'account-123' }
} as unknown as Request;

describe('Interests API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetData.mockReturnValue(mockData);
    mockGetById.mockReturnValue(mockAccount);
  });

  describe('getAccountInterests', () => {
    it('should return serialized interests for an account', () => {
      const result = getAccountInterests(mockRequest);

      expect(mockGetData).toHaveBeenCalledWith(mockRequest);
      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockInterestInstance.serialize).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'interest-123', rate: 0.05 }]);
    });

    it('should return empty array if account has no interests', () => {
      const emptyAccount = { interests: [] };
      mockGetById.mockReturnValue(emptyAccount);

      const result = getAccountInterests(mockRequest);

      expect(result).toEqual([]);
    });
  });

  describe('addInterest', () => {
    const mockInterestData = {
      data: {
        rate: 0.03,
        frequency: 'monthly'
      },
      accountsAndTransfers: mockData.accountsAndTransfers
    };

    beforeEach(() => {
      // Mock Interest constructor
      mockInterestConstructor.mockImplementation(() => ({ id: 'new-interest-123' } as any));
    });

    it('should add interest to account', () => {
      mockGetData.mockReturnValue(mockInterestData);

      const result = addInterest(mockRequest);

      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockAccount.interests).toHaveLength(2); // Original + new interest
      expect(result).toBe('new-interest-123');
    });
  });

  describe('updateInterest', () => {
    const mockInterestDataArray = {
      data: [
        { rate: 0.04, frequency: 'annual' },
        { rate: 0.05, frequency: 'monthly' }
      ],
      accountsAndTransfers: mockData.accountsAndTransfers
    };

    beforeEach(() => {
      // Mock Interest constructor
      mockInterestConstructor.mockImplementation((data) => ({ 
        id: `interest-${data.rate}`,
        rate: data.rate 
      } as any));
    });

    it('should replace all account interests with new ones', () => {
      mockGetData.mockReturnValue(mockInterestDataArray);

      const result = updateInterest(mockRequest);

      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockAccount.interests).toHaveLength(2);
      expect(mockSaveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toEqual(['interest-0.04', 'interest-0.05']);
    });

    it('should handle empty interest array', () => {
      const emptyData = { ...mockInterestDataArray, data: [] };
      mockGetData.mockReturnValue(emptyData);

      const result = updateInterest(mockRequest);

      expect(mockAccount.interests).toHaveLength(0);
      expect(result).toEqual([]);
    });
  });

  describe('deleteInterest', () => {
    it('should clear all interests from account', () => {
      const result = deleteInterest(mockRequest);

      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockAccount.interests).toHaveLength(0);
      expect(mockSaveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBeNull();
    });
  });
});