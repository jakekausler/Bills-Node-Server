import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSpecificInterest, updateSpecificInterest, deleteSpecificInterest } from './interest';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { insertInterest } from '../../../data/interest/interest';
import { parseDate } from '../../../utils/date/date';
import { createMockRequest } from '../../../utils/test/mockData';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');
vi.mock('../../../utils/io/accountsAndTransfers');
vi.mock('../../../data/interest/interest');
vi.mock('../../../utils/date/date');

describe('Specific Interest API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSpecificInterest', () => {
    describe('when asActivity is true', () => {
      it('should return serialized consolidated activity matching interestId', async () => {
        const mockActivity = {
          interestId: 'interest-123',
          flag: true,
          flagColor: 'red',
          serialize: vi.fn(() => ({ id: 'activity-1', amount: 50, interestId: 'interest-123' })),
        };

        const mockAccount = {
          consolidatedActivity: [mockActivity],
          interests: [],
        };

        const mockData = {
          asActivity: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);

        const result = await getSpecificInterest(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
        expect(mockActivity.flag).toBe(false);
        expect(mockActivity.flagColor).toBeNull();
        expect(mockActivity.serialize).toHaveBeenCalled();
        expect(result).toEqual({ id: 'activity-1', amount: 50, interestId: 'interest-123' });
      });

      it('should return null when no consolidated activity matches the interestId', async () => {
        const mockActivity = {
          interestId: 'other-interest',
          serialize: vi.fn(),
        };

        const mockAccount = {
          consolidatedActivity: [mockActivity],
          interests: [],
        };

        const mockData = {
          asActivity: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);

        const result = await getSpecificInterest(mockRequest);

        expect(mockActivity.serialize).not.toHaveBeenCalled();
        expect(result).toBeNull();
      });

      it('should return null when account has no consolidated activity', async () => {
        const mockAccount = {
          consolidatedActivity: [],
          interests: [],
        };

        const mockData = {
          asActivity: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);

        const result = await getSpecificInterest(mockRequest);

        expect(result).toBeNull();
      });
    });

    describe('when asActivity is false', () => {
      it('should return serialized interest', async () => {
        const mockInterest = {
          id: 'interest-123',
          serialize: vi.fn(() => ({ id: 'interest-123', apr: 0.05, compounded: 'month' })),
        };

        const mockAccount = {
          interests: [mockInterest],
        };

        const mockData = {
          asActivity: false,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockInterest as any);

        const result = await getSpecificInterest(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-123');
        expect(getById).toHaveBeenNthCalledWith(2, mockAccount.interests, 'interest-123');
        expect(mockInterest.serialize).toHaveBeenCalled();
        expect(result).toEqual({ id: 'interest-123', apr: 0.05, compounded: 'month' });
      });
    });
  });

  describe('updateSpecificInterest', () => {
    describe('when asActivity is true', () => {
      it('should call insertInterest, save data, and return the interest id', async () => {
        const mockInterest = {
          id: 'interest-123',
        };

        const mockAccount = {
          interests: [mockInterest],
          activity: [],
        };

        const mockActivityData = {
          id: 'activity-data-1',
          date: '2024-01-15',
          dateIsVariable: false,
          dateVariable: null,
          name: 'Interest',
          category: 'Banking.Interest',
          amount: 50,
          amountIsVariable: false,
          amountVariable: null,
          flag: false,
          flagColor: null,
          isTransfer: false,
          from: null,
          to: null,
        };

        const mockData = {
          asActivity: true,
          simulation: 'Default',
          data: mockActivityData,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockInterest as any);

        const result = await updateSpecificInterest(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-123');
        expect(getById).toHaveBeenNthCalledWith(2, mockAccount.interests, 'interest-123');
        expect(insertInterest).toHaveBeenCalledWith(mockAccount, mockInterest, mockActivityData, 'Default');
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('interest-123');
      });
    });

    describe('when asActivity is false', () => {
      it('should update interest fields, sort interests, save data, and return the interest id', async () => {
        const earlyInterest = {
          id: 'interest-early',
          apr: 0.03,
          compounded: 'month' as const,
          applicableDate: new Date('2024-06-01'),
        };

        const mockInterest = {
          id: 'interest-123',
          apr: 0.05,
          compounded: 'year' as const,
          applicableDate: new Date('2024-01-01'),
        };

        const mockAccount = {
          interests: [mockInterest, earlyInterest],
        };

        const mockInterestData = {
          apr: 0.07,
          compounded: 'month' as const,
          applicableDate: '2024-03-01',
        };

        const mockData = {
          asActivity: false,
          data: mockInterestData,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        const parsedDate = new Date('2024-03-01');
        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockInterest as any);
        vi.mocked(parseDate).mockReturnValue(parsedDate);

        const result = await updateSpecificInterest(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-123');
        expect(getById).toHaveBeenNthCalledWith(2, mockAccount.interests, 'interest-123');
        expect(mockInterest.apr).toBe(0.07);
        expect(mockInterest.compounded).toBe('month');
        expect(mockInterest.applicableDate).toBe(parsedDate);
        expect(parseDate).toHaveBeenCalledWith('2024-03-01');
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('interest-123');
      });

      it('should sort account interests by applicableDate after update', async () => {
        const laterInterest = {
          id: 'interest-later',
          apr: 0.03,
          compounded: 'month' as const,
          applicableDate: new Date('2024-12-01'),
        };

        const mockInterest = {
          id: 'interest-123',
          apr: 0.05,
          compounded: 'year' as const,
          applicableDate: new Date('2024-01-01'),
        };

        const mockAccount = {
          interests: [laterInterest, mockInterest],
        };

        const mockInterestData = {
          apr: 0.06,
          compounded: 'year' as const,
          applicableDate: '2024-02-01',
        };

        const mockData = {
          asActivity: false,
          data: mockInterestData,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-123', interestId: 'interest-123' },
        });

        const parsedDate = new Date('2024-02-01');
        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockInterest as any);
        vi.mocked(parseDate).mockReturnValue(parsedDate);

        await updateSpecificInterest(mockRequest);

        // After update, mockInterest.applicableDate is 2024-02-01, laterInterest stays 2024-12-01
        // Sort should put mockInterest (Feb) before laterInterest (Dec)
        expect(mockAccount.interests[0].id).toBe('interest-123');
        expect(mockAccount.interests[1].id).toBe('interest-later');
      });
    });
  });

  describe('deleteSpecificInterest', () => {
    it('should remove the interest from the account, save data, and return the interest id', async () => {
      const mockInterest = {
        id: 'interest-123',
        apr: 0.05,
        compounded: 'month' as const,
        applicableDate: new Date('2024-01-01'),
      };

      const otherInterest = {
        id: 'interest-other',
        apr: 0.03,
        compounded: 'year' as const,
        applicableDate: new Date('2024-06-01'),
      };

      const mockAccount = {
        interests: [mockInterest, otherInterest],
      };

      const mockData = {
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-123', interestId: 'interest-123' },
      });

      vi.mocked(getData).mockResolvedValue(mockData as any);
      vi.mocked(getById)
        .mockReturnValueOnce(mockAccount as any)
        .mockReturnValueOnce(mockInterest as any);

      // Capture the original interests array before the call mutates the reference
      const originalInterests = mockAccount.interests;

      const result = await deleteSpecificInterest(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-123');
      expect(getById).toHaveBeenNthCalledWith(2, originalInterests, 'interest-123');
      expect(mockAccount.interests).not.toContain(mockInterest);
      expect(mockAccount.interests).toContain(otherInterest);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('interest-123');
    });

    it('should return the deleted interest id when it is the only interest', async () => {
      const mockInterest = {
        id: 'interest-only',
        apr: 0.05,
        compounded: 'month' as const,
        applicableDate: new Date('2024-01-01'),
      };

      const mockAccount = {
        interests: [mockInterest],
      };

      const mockData = {
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-123', interestId: 'interest-only' },
      });

      vi.mocked(getData).mockResolvedValue(mockData as any);
      vi.mocked(getById)
        .mockReturnValueOnce(mockAccount as any)
        .mockReturnValueOnce(mockInterest as any);

      const result = await deleteSpecificInterest(mockRequest);

      expect(mockAccount.interests).toHaveLength(0);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('interest-only');
    });
  });
});
