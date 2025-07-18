import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTodayBalance } from './todayBalance';
import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { todayBalance } from '../../data/account/account';
import { createMockRequest } from '../../utils/test/mockData';

// Mock dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/array/array');
vi.mock('../../data/account/account');

describe('getTodayBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get today balance for specified account', () => {
    const mockAccount = {
      id: 'account-1',
      name: 'Test Account',
      balance: 1000,
      activity: [],
    };

    const mockData = {
      accountsAndTransfers: {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      },
    };

    const mockRequest = createMockRequest({
      params: { accountId: 'account-1' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getById).mockReturnValue(mockAccount as any);
    vi.mocked(todayBalance).mockReturnValue(1250.50);

    const result = getTodayBalance(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
    expect(todayBalance).toHaveBeenCalledWith(mockAccount);
    expect(result).toBe(1250.50);
  });

  it('should handle different account types', () => {
    const mockAccount = {
      id: 'savings-1',
      name: 'Savings Account',
      type: 'Savings',
      balance: 5000,
      activity: [],
    };

    const mockData = {
      accountsAndTransfers: {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      },
    };

    const mockRequest = createMockRequest({
      params: { accountId: 'savings-1' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getById).mockReturnValue(mockAccount as any);
    vi.mocked(todayBalance).mockReturnValue(5123.75);

    const result = getTodayBalance(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'savings-1');
    expect(todayBalance).toHaveBeenCalledWith(mockAccount);
    expect(result).toBe(5123.75);
  });

  it('should handle zero balance accounts', () => {
    const mockAccount = {
      id: 'empty-account',
      name: 'Empty Account',
      balance: 0,
      activity: [],
    };

    const mockData = {
      accountsAndTransfers: {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      },
    };

    const mockRequest = createMockRequest({
      params: { accountId: 'empty-account' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getById).mockReturnValue(mockAccount as any);
    vi.mocked(todayBalance).mockReturnValue(0);

    const result = getTodayBalance(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'empty-account');
    expect(todayBalance).toHaveBeenCalledWith(mockAccount);
    expect(result).toBe(0);
  });

  it('should handle negative balance accounts', () => {
    const mockAccount = {
      id: 'overdraft-account',
      name: 'Overdraft Account',
      balance: -250,
      activity: [],
    };

    const mockData = {
      accountsAndTransfers: {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      },
    };

    const mockRequest = createMockRequest({
      params: { accountId: 'overdraft-account' },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getById).mockReturnValue(mockAccount as any);
    vi.mocked(todayBalance).mockReturnValue(-275.25);

    const result = getTodayBalance(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'overdraft-account');
    expect(todayBalance).toHaveBeenCalledWith(mockAccount);
    expect(result).toBe(-275.25);
  });

  it('should pass through query parameters to getData', () => {
    const mockAccount = {
      id: 'account-1',
      name: 'Test Account',
      balance: 1000,
      activity: [],
    };

    const mockData = {
      accountsAndTransfers: {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      },
    };

    const mockRequest = createMockRequest({
      params: { accountId: 'account-1' },
      query: { 
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        simulation: 'TestSim'
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getById).mockReturnValue(mockAccount as any);
    vi.mocked(todayBalance).mockReturnValue(1000);

    getTodayBalance(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
  });
});