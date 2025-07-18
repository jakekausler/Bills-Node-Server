import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getAccountActivity, addActivity } from './activity';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { Activity } from '../../../data/activity/activity';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');
vi.mock('../../../utils/io/accountsAndTransfers');
vi.mock('../../../data/activity/activity');

const mockGetData = vi.mocked(getData);
const mockGetById = vi.mocked(getById);
const mockSaveData = vi.mocked(saveData);
const mockActivityConstructor = vi.mocked(Activity);

// Mock classes
const mockActivityInstance = {
  id: 'activity-123',
  serialize: vi.fn(() => ({ id: 'activity-123', amount: 100, description: 'Test Activity' }))
};

const mockAccount = {
  activity: [mockActivityInstance]
};

const mockData = {
  accountsAndTransfers: {
    accounts: [mockAccount],
    transfers: {
      activity: []
    }
  },
  simulation: 'test-sim'
};

const mockRequest = {
  params: { accountId: 'account-123' }
} as unknown as Request;

describe('Activity API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetData.mockReturnValue(mockData);
    mockGetById.mockReturnValue(mockAccount);
  });

  describe('getAccountActivity', () => {
    it('should return serialized activities for an account', () => {
      const result = getAccountActivity(mockRequest);

      expect(mockGetData).toHaveBeenCalledWith(mockRequest);
      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockActivityInstance.serialize).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'activity-123', amount: 100, description: 'Test Activity' }]);
    });

    it('should return empty array if account has no activities', () => {
      const emptyAccount = { activity: [] };
      mockGetById.mockReturnValue(emptyAccount);

      const result = getAccountActivity(mockRequest);

      expect(result).toEqual([]);
    });
  });

  describe('addActivity', () => {
    const mockActivityData = {
      data: {
        amount: 250,
        description: 'New Activity',
        isTransfer: false
      },
      accountsAndTransfers: mockData.accountsAndTransfers,
      simulation: 'test-sim'
    };

    beforeEach(() => {
      // Mock Activity constructor
      mockActivityConstructor.mockImplementation(() => ({ id: 'new-activity-123' } as any));
    });

    it('should add activity to account when not a transfer', () => {
      mockGetData.mockReturnValue(mockActivityData);

      const result = addActivity(mockRequest);

      expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
      expect(mockAccount.activity).toHaveLength(2); // Original + new activity
      expect(mockSaveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('new-activity-123');
    });

    it('should add activity to transfers when isTransfer is true', () => {
      const transferActivityData = {
        ...mockActivityData,
        data: { ...mockActivityData.data, isTransfer: true }
      };
      mockGetData.mockReturnValue(transferActivityData);

      const result = addActivity(mockRequest);

      expect(mockData.accountsAndTransfers.transfers.activity).toHaveLength(1);
      expect(mockSaveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('new-activity-123');
    });
  });
});