import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getSpecificConsolidatedActivity } from './specificConsolidatedActivity';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';

// Mock dependencies
vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');

const mockGetData = vi.mocked(getData);
const mockGetById = vi.mocked(getById);

const mockSerializedActivity = {
  id: 'ca-42',
  amount: -200,
  description: 'Mortgage Payment',
  balance: 5800,
  billId: 'bill-99',
  firstBill: false,
  interestId: null,
  firstInterest: false,
  spendingTrackerId: null,
  firstSpendingTracker: false,
};

const mockConsolidatedActivity = {
  id: 'ca-42',
  serialize: vi.fn(() => mockSerializedActivity),
};

const mockAccount = {
  id: 'account-123',
  consolidatedActivity: [mockConsolidatedActivity],
};

const mockData = {
  accountsAndTransfers: {
    accounts: [mockAccount],
  },
  simulation: 'test-sim',
};

const mockRequest = {
  params: { accountId: 'account-123', activityId: 'ca-42' },
} as unknown as Request;

describe('getSpecificConsolidatedActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetData.mockResolvedValue(mockData);
    // First call returns the account, second returns the specific activity
    mockGetById.mockReturnValueOnce(mockAccount).mockReturnValueOnce(mockConsolidatedActivity);
  });

  it('should call getData with the request', async () => {
    await getSpecificConsolidatedActivity(mockRequest);

    expect(mockGetData).toHaveBeenCalledWith(mockRequest);
  });

  it('should look up the account by accountId param', async () => {
    await getSpecificConsolidatedActivity(mockRequest);

    expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-123');
  });

  it('should look up the specific activity by activityId param within the account', async () => {
    await getSpecificConsolidatedActivity(mockRequest);

    expect(mockGetById).toHaveBeenCalledWith(mockAccount.consolidatedActivity, 'ca-42');
  });

  it('should return the serialized consolidated activity', async () => {
    const result = await getSpecificConsolidatedActivity(mockRequest);

    expect(mockConsolidatedActivity.serialize).toHaveBeenCalled();
    expect(result).toEqual(mockSerializedActivity);
  });

  it('should use the correct accountId and activityId from request params', async () => {
    const differentRequest = {
      params: { accountId: 'account-999', activityId: 'ca-007' },
    } as unknown as Request;

    const differentAccount = {
      id: 'account-999',
      consolidatedActivity: [mockConsolidatedActivity],
    };
    mockGetById.mockReset();
    mockGetById.mockReturnValueOnce(differentAccount).mockReturnValueOnce(mockConsolidatedActivity);

    await getSpecificConsolidatedActivity(differentRequest);

    expect(mockGetById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-999');
    expect(mockGetById).toHaveBeenCalledWith(differentAccount.consolidatedActivity, 'ca-007');
  });
});
