import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccount, updateAccount, removeAccount } from './account';
import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { createMockRequest } from '../../utils/test/mockData';

// Mock dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/array/array');
vi.mock('../../utils/io/accountsAndTransfers');

describe('Account API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAccount', () => {
    it('should return a simplified account object', () => {
      const mockAccount = {
        id: 'account-1',
        name: 'Test Account',
        simpleAccount: vi.fn().mockReturnValue({
          id: 'account-1',
          name: 'Test Account',
          balance: 1000,
        }),
      };

      const mockData = {
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);

      const result = getAccount(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
      expect(mockAccount.simpleAccount).toHaveBeenCalled();
      expect(result).toEqual({
        id: 'account-1',
        name: 'Test Account',
        balance: 1000,
      });
    });

    it('should handle account lookup correctly', () => {
      const mockAccount = {
        id: 'account-2',
        name: 'Another Account',
        simpleAccount: vi.fn().mockReturnValue({
          id: 'account-2',
          name: 'Another Account',
          balance: 2500,
        }),
      };

      const mockData = {
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-2' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);

      const result = getAccount(mockRequest);

      expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-2');
      expect(result).toEqual({
        id: 'account-2',
        name: 'Another Account',
        balance: 2500,
      });
    });
  });

  describe('updateAccount', () => {
    it('should update account name and save data', () => {
      const mockAccount = {
        id: 'account-1',
        name: 'Old Name',
        simpleAccount: vi.fn().mockReturnValue({
          id: 'account-1',
          name: 'New Name',
          balance: 1000,
        }),
      };

      const mockData = {
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
        data: {
          name: 'New Name',
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);

      const result = updateAccount(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
      expect(mockAccount.name).toBe('New Name');
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(mockAccount.simpleAccount).toHaveBeenCalled();
      expect(result).toEqual({
        id: 'account-1',
        name: 'New Name',
        balance: 1000,
      });
    });

    it('should handle account update with different data', () => {
      const mockAccount = {
        id: 'account-3',
        name: 'Original Name',
        simpleAccount: vi.fn().mockReturnValue({
          id: 'account-3',
          name: 'Updated Name',
          balance: 750,
        }),
      };

      const mockData = {
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
        data: {
          name: 'Updated Name',
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-3' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);

      const result = updateAccount(mockRequest);

      expect(mockAccount.name).toBe('Updated Name');
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toEqual({
        id: 'account-3',
        name: 'Updated Name',
        balance: 750,
      });
    });
  });

  describe('removeAccount', () => {
    it('should remove account and save data', () => {
      const mockAccounts = [
        { id: 'account-1', name: 'Account 1' },
        { id: 'account-2', name: 'Account 2' },
        { id: 'account-3', name: 'Account 3' },
      ];

      const mockData = {
        accountsAndTransfers: {
          accounts: mockAccounts,
        },
        data: {},
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-2' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);

      const result = removeAccount(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(mockData.accountsAndTransfers.accounts).toEqual([
        { id: 'account-1', name: 'Account 1' },
        { id: 'account-3', name: 'Account 3' },
      ]);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('account-2');
    });

    it('should handle removing non-existent account', () => {
      const mockAccounts = [
        { id: 'account-1', name: 'Account 1' },
        { id: 'account-2', name: 'Account 2' },
      ];

      const mockData = {
        accountsAndTransfers: {
          accounts: mockAccounts,
        },
        data: {},
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'non-existent' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);

      const result = removeAccount(mockRequest);

      expect(mockData.accountsAndTransfers.accounts).toEqual([
        { id: 'account-1', name: 'Account 1' },
        { id: 'account-2', name: 'Account 2' },
      ]);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('non-existent');
    });

    it('should handle removing last account', () => {
      const mockAccounts = [
        { id: 'account-1', name: 'Only Account' },
      ];

      const mockData = {
        accountsAndTransfers: {
          accounts: mockAccounts,
        },
        data: {},
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1' },
      });

      vi.mocked(getData).mockReturnValue(mockData as any);

      const result = removeAccount(mockRequest);

      expect(mockData.accountsAndTransfers.accounts).toEqual([]);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('account-1');
    });
  });
});