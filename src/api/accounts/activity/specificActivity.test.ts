import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getSpecificActivity, 
  updateSpecificActivity, 
  deleteSpecificActivity, 
  changeAccountForActivity 
} from './specificActivity';
import { getData } from '../../../utils/net/request';
import { getById, getByIdWithIdx } from '../../../utils/array/array';
import { parseDate } from '../../../utils/date/date';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { createMockRequest } from '../../../utils/test/mockData';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');
vi.mock('../../../utils/date/date');
vi.mock('../../../utils/io/accountsAndTransfers');

describe('Specific Activity API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSpecificActivity', () => {
    it('should return transfer activity when isTransfer is true', () => {
      const mockActivity = {
        id: 'activity-1',
        name: 'Transfer Activity',
        isTransfer: true,
      };

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          transfers: {
            activity: [mockActivity],
          },
        },
      };

      const mockRequest = createMockRequest({
        params: { activityId: 'activity-1' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockActivity as any);

      const result = getSpecificActivity(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.transfers.activity, 'activity-1');
      expect(result).toBe(mockActivity);
    });

    it('should return account activity when isTransfer is false', () => {
      const mockActivity = {
        id: 'activity-2',
        name: 'Regular Activity',
        isTransfer: false,
      };

      const mockAccount = {
        id: 'account-1',
        activity: [mockActivity],
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1', activityId: 'activity-2' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValueOnce(mockAccount as any).mockReturnValueOnce(mockActivity as any);

      const result = getSpecificActivity(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
      expect(getById).toHaveBeenNthCalledWith(2, mockAccount.activity, 'activity-2');
      expect(result).toBe(mockActivity);
    });
  });

  describe('updateSpecificActivity', () => {
    it('should update transfer activity', () => {
      const mockActivity = {
        id: 'activity-1',
        name: 'Old Name',
        isTransfer: true,
      };

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          transfers: {
            activity: [mockActivity],
          },
        },
        data: {
          name: 'New Name',
          date: '2024-01-15',
          dateIsVariable: false,
          dateVariable: '',
          category: 'Food.Groceries',
          amountIsVariable: false,
          amount: -100,
          amountVariable: '',
          flag: '',
          flagColor: '',
          isTransfer: true,
          from: 'account-1',
          to: 'account-2',
        },
      };

      const mockRequest = createMockRequest({
        params: { activityId: 'activity-1' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockActivity, idx: 0 } as any);
      vi.mocked(parseDate).mockReturnValue(new Date('2024-01-15'));

      const result = updateSpecificActivity(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getByIdWithIdx).toHaveBeenCalledWith(mockData.accountsAndTransfers.transfers.activity, 'activity-1');
      expect(parseDate).toHaveBeenCalledWith('2024-01-15');
      expect(mockActivity.name).toBe('New Name');
      expect(mockActivity.isTransfer).toBe(true);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-1');
    });

    it('should update regular activity', () => {
      const mockActivity = {
        id: 'activity-2',
        name: 'Old Name',
        isTransfer: false,
      };

      const mockAccount = {
        id: 'account-1',
        activity: [mockActivity],
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
        data: {
          name: 'Updated Name',
          date: '2024-01-16',
          dateIsVariable: false,
          dateVariable: '',
          category: 'Food.Restaurants',
          amountIsVariable: false,
          amount: -50,
          amountVariable: '',
          flag: '',
          flagColor: '',
          isTransfer: false,
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1', activityId: 'activity-2' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockActivity, idx: 0 } as any);
      vi.mocked(parseDate).mockReturnValue(new Date('2024-01-16'));

      const result = updateSpecificActivity(mockRequest);

      expect(mockActivity.name).toBe('Updated Name');
      expect(mockActivity.isTransfer).toBe(false);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-2');
    });

    it('should handle converting transfer to regular activity', () => {
      const mockActivity = {
        id: 'activity-3',
        name: 'Transfer Activity',
        isTransfer: true,
      };

      const mockAccount = {
        id: 'account-1',
        activity: [],
      };

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          accounts: [mockAccount],
          transfers: {
            activity: [mockActivity],
          },
        },
        data: {
          name: 'Regular Activity',
          date: '2024-01-17',
          dateIsVariable: false,
          dateVariable: '',
          category: 'Food.Groceries',
          amountIsVariable: false,
          amount: -75,
          amountVariable: '',
          flag: '',
          flagColor: '',
          isTransfer: false,
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1', activityId: 'activity-3' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockActivity, idx: 0 } as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);
      vi.mocked(parseDate).mockReturnValue(new Date('2024-01-17'));

      const result = updateSpecificActivity(mockRequest);

      expect(mockActivity.isTransfer).toBe(false);
      expect(mockAccount.activity).toContain(mockActivity);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-3');
    });

    it('should handle converting regular activity to transfer', () => {
      const mockActivity = {
        id: 'activity-4',
        name: 'Regular Activity',
        isTransfer: false,
      };

      const mockAccount = {
        id: 'account-1',
        activity: [mockActivity],
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockAccount],
          transfers: {
            activity: [],
          },
        },
        data: {
          name: 'Transfer Activity',
          date: '2024-01-18',
          dateIsVariable: false,
          dateVariable: '',
          category: 'Transfer',
          amountIsVariable: false,
          amount: -200,
          amountVariable: '',
          flag: '',
          flagColor: '',
          isTransfer: true,
          from: 'account-1',
          to: 'account-2',
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1', activityId: 'activity-4' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockActivity, idx: 0 } as any);
      vi.mocked(parseDate).mockReturnValue(new Date('2024-01-18'));

      const result = updateSpecificActivity(mockRequest);

      expect(mockActivity.isTransfer).toBe(true);
      expect(mockData.accountsAndTransfers.transfers.activity).toContain(mockActivity);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-4');
    });
  });

  describe('deleteSpecificActivity', () => {
    it('should delete transfer activity', () => {
      const mockActivity = {
        id: 'activity-1',
        name: 'Transfer Activity',
        isTransfer: true,
      };

      const mockTransferActivity = [mockActivity];
      const mockSplice = vi.fn();
      mockTransferActivity.splice = mockSplice;

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          transfers: {
            activity: mockTransferActivity,
          },
        },
      };

      const mockRequest = createMockRequest({
        params: { activityId: 'activity-1' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockActivity, idx: 0 } as any);

      const result = deleteSpecificActivity(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getByIdWithIdx).toHaveBeenCalledWith(mockData.accountsAndTransfers.transfers.activity, 'activity-1');
      expect(mockSplice).toHaveBeenCalledWith(0, 1);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-1');
    });

    it('should delete regular activity', () => {
      const mockActivity = {
        id: 'activity-2',
        name: 'Regular Activity',
        isTransfer: false,
      };

      const mockAccountActivity = [mockActivity];
      const mockSplice = vi.fn();
      mockAccountActivity.splice = mockSplice;

      const mockAccount = {
        id: 'account-1',
        activity: mockAccountActivity,
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1', activityId: 'activity-2' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockActivity, idx: 0 } as any);

      const result = deleteSpecificActivity(mockRequest);

      expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
      expect(getByIdWithIdx).toHaveBeenCalledWith(mockAccount.activity, 'activity-2');
      expect(mockSplice).toHaveBeenCalledWith(0, 1);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-2');
    });
  });

  describe('changeAccountForActivity', () => {
    it('should change account for transfer activity', () => {
      const mockActivity = {
        id: 'activity-1',
        name: 'Transfer Activity',
        isTransfer: true,
        fro: 'Old Account',
      };

      const mockOldAccount = {
        id: 'account-1',
        name: 'Old Account',
        activity: [],
      };

      const mockNewAccount = {
        id: 'account-2',
        name: 'New Account',
        activity: [],
      };

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          accounts: [mockOldAccount, mockNewAccount],
          transfers: {
            activity: [mockActivity],
          },
        },
      };

      const mockRequest = createMockRequest({
        params: { 
          accountId: 'account-1', 
          activityId: 'activity-1',
          newAccountId: 'account-2',
        },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById)
        .mockReturnValueOnce(mockOldAccount as any)
        .mockReturnValueOnce(mockActivity as any)
        .mockReturnValueOnce(mockNewAccount as any);

      const result = changeAccountForActivity(mockRequest);

      expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
      expect(getById).toHaveBeenNthCalledWith(2, mockData.accountsAndTransfers.transfers.activity, 'activity-1');
      expect(getById).toHaveBeenNthCalledWith(3, mockData.accountsAndTransfers.accounts, 'account-2');
      expect(mockActivity.fro).toBe('New Account');
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-1');
    });

    it('should change account for regular activity', () => {
      const mockActivity = {
        id: 'activity-2',
        name: 'Regular Activity',
        isTransfer: false,
      };

      const mockOldAccount = {
        id: 'account-1',
        name: 'Old Account',
        activity: [mockActivity],
      };

      const mockNewAccount = {
        id: 'account-2',
        name: 'New Account',
        activity: [],
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockOldAccount, mockNewAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { 
          accountId: 'account-1', 
          activityId: 'activity-2',
          newAccountId: 'account-2',
        },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById)
        .mockReturnValueOnce(mockOldAccount as any)
        .mockReturnValueOnce(mockActivity as any)
        .mockReturnValueOnce(mockNewAccount as any);

      const result = changeAccountForActivity(mockRequest);

      expect(mockOldAccount.activity).toEqual([]);
      expect(mockNewAccount.activity).toContain(mockActivity);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('activity-2');
    });
  });
});