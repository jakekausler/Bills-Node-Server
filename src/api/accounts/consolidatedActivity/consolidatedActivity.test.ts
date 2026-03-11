import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getConsolidatedActivity } from './consolidatedActivity';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');

const mockGetData = vi.mocked(getData);
const mockGetById = vi.mocked(getById);

const mockConsolidatedActivityA = {
  serialize: vi.fn(() => ({
    id: 'ca-1',
    amount: 100,
    description: 'Bill Payment',
    balance: 900,
    billId: 'bill-1',
    firstBill: true,
    interestId: null,
    firstInterest: false,
    spendingTrackerId: null,
    firstSpendingTracker: false,
  })),
};

const mockConsolidatedActivityB = {
  serialize: vi.fn(() => ({
    id: 'ca-2',
    amount: -50,
    description: 'Interest',
    balance: 950,
    billId: null,
    firstBill: false,
    interestId: 'interest-1',
    firstInterest: true,
    spendingTrackerId: null,
    firstSpendingTracker: false,
  })),
};

const mockAccount = {
  id: 'account-123',
  consolidatedActivity: [mockConsolidatedActivityA, mockConsolidatedActivityB],
};

const mockData = {
  accountsAndTransfers: {
    accounts: [mockAccount],
  },
  simulation: 'test-sim',
};

const mockRequest = {
  params: { accountId: 'account-123' },
} as unknown as Request;

describe('getConsolidatedActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetData.mockResolvedValue(mockData);
    mockGetById.mockReturnValue(mockAccount);
  });

  it('should call getData with the request', async () => {
    await getConsolidatedActivity(mockRequest);

    expect(mockGetData).toHaveBeenCalledWith(mockRequest);
  });

  it('should look up the account by the accountId param', async () => {
    await getConsolidatedActivity(mockRequest);

    expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
  });

  it('should return serialized consolidated activities for the account', async () => {
    const result = await getConsolidatedActivity(mockRequest);

    expect(mockConsolidatedActivityA.serialize).toHaveBeenCalled();
    expect(mockConsolidatedActivityB.serialize).toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: 'ca-1',
        amount: 100,
        description: 'Bill Payment',
        balance: 900,
        billId: 'bill-1',
        firstBill: true,
        interestId: null,
        firstInterest: false,
        spendingTrackerId: null,
        firstSpendingTracker: false,
      },
      {
        id: 'ca-2',
        amount: -50,
        description: 'Interest',
        balance: 950,
        billId: null,
        firstBill: false,
        interestId: 'interest-1',
        firstInterest: true,
        spendingTrackerId: null,
        firstSpendingTracker: false,
      },
    ]);
  });

  it('should return an empty array when the account has no consolidated activities', async () => {
    const emptyAccount = { id: 'account-123', consolidatedActivity: [] };
    mockGetById.mockReturnValue(emptyAccount);

    const result = await getConsolidatedActivity(mockRequest);

    expect(result).toEqual([]);
  });

  it('should handle a different accountId param', async () => {
    const differentRequest = {
      params: { accountId: 'account-456' },
    } as unknown as Request;

    await getConsolidatedActivity(differentRequest);

    expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-456');
  });
});
