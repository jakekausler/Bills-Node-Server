import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the io module before importing the module under test
vi.mock('./io', () => ({
  load: vi.fn(),
  save: vi.fn(),
  BASE_DATA_DIR: '/mock/data',
}));

// Mock the cache module
vi.mock('./cache', () => ({
  resetCache: vi.fn(),
}));

// Mock the calculation engine
vi.mock('../calculate-v3/engine', () => ({
  calculateAllActivity: vi.fn(),
}));

// Mock the Account, Activity, and Bill classes
vi.mock('../../data/account/account', () => ({
  Account: vi.fn().mockImplementation((data) => ({
    ...data,
    serialize: vi.fn().mockReturnValue(data),
  })),
}));

vi.mock('../../data/activity/activity', () => ({
  Activity: vi.fn().mockImplementation((data) => ({
    ...data,
    serialize: vi.fn().mockReturnValue(data),
  })),
}));

vi.mock('../../data/bill/bill', () => ({
  Bill: vi.fn().mockImplementation((data) => ({
    ...data,
    serialize: vi.fn().mockReturnValue(data),
  })),
}));

import { load, save } from './io';
import { resetCache } from './cache';
import { calculateAllActivity } from '../calculate-v3/engine';
import { Account } from '../../data/account/account';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { loadData, getAccountsAndTransfers, saveData, clearDataCache, FILE_NAME } from './accountsAndTransfers';

const mockAccountData = {
  id: 'account-1',
  name: 'Checking Account',
  interests: [],
  activity: [],
  bills: [],
  hidden: false,
  type: 'checking',
  defaultShowInGraph: true,
};

const mockActivityData = {
  id: 'activity-1',
  name: 'Transfer',
  amount: 500,
  date: '2024-01-15',
};

const mockBillData = {
  id: 'bill-1',
  name: 'Rent',
  amount: 1500,
  startDate: '2024-01-01',
};

const mockRawData = {
  accounts: [mockAccountData],
  transfers: {
    activity: [mockActivityData],
    bills: [mockBillData],
  },
};

describe('accountsAndTransfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDataCache();
  });

  describe('FILE_NAME', () => {
    it('should be "data"', () => {
      expect(FILE_NAME).toBe('data');
    });
  });

  describe('getAccountsAndTransfers', () => {
    it('should load data from the correct file', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      getAccountsAndTransfers('Default');

      expect(load).toHaveBeenCalledWith('data.json');
    });

    it('should construct Account instances for each account in data', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      getAccountsAndTransfers('Default');

      expect(Account).toHaveBeenCalledWith(mockAccountData, 'Default');
      expect(Account).toHaveBeenCalledTimes(1);
    });

    it('should construct Activity instances for each transfer activity', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      getAccountsAndTransfers('Default');

      expect(Activity).toHaveBeenCalledWith(mockActivityData, 'Default');
      expect(Activity).toHaveBeenCalledTimes(1);
    });

    it('should construct Bill instances for each transfer bill', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      getAccountsAndTransfers('Default');

      expect(Bill).toHaveBeenCalledWith(mockBillData, 'Default');
      expect(Bill).toHaveBeenCalledTimes(1);
    });

    it('should pass the simulation name to all constructors', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      getAccountsAndTransfers('MySimulation');

      expect(Account).toHaveBeenCalledWith(mockAccountData, 'MySimulation');
      expect(Activity).toHaveBeenCalledWith(mockActivityData, 'MySimulation');
      expect(Bill).toHaveBeenCalledWith(mockBillData, 'MySimulation');
    });

    it('should return an object with accounts, transfers.activity, and transfers.bills arrays', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      const result = getAccountsAndTransfers('Default');

      expect(result).toHaveProperty('accounts');
      expect(result).toHaveProperty('transfers');
      expect(result).toHaveProperty('transfers.activity');
      expect(result).toHaveProperty('transfers.bills');
      expect(Array.isArray(result.accounts)).toBe(true);
      expect(Array.isArray(result.transfers.activity)).toBe(true);
      expect(Array.isArray(result.transfers.bills)).toBe(true);
    });

    it('should return correct counts for accounts and transfers', () => {
      vi.mocked(load).mockReturnValue(mockRawData);

      const result = getAccountsAndTransfers('Default');

      expect(result.accounts).toHaveLength(1);
      expect(result.transfers.activity).toHaveLength(1);
      expect(result.transfers.bills).toHaveLength(1);
    });

    it('should handle empty arrays gracefully', () => {
      vi.mocked(load).mockReturnValue({
        accounts: [],
        transfers: { activity: [], bills: [] },
      });

      const result = getAccountsAndTransfers('Default');

      expect(result.accounts).toHaveLength(0);
      expect(result.transfers.activity).toHaveLength(0);
      expect(result.transfers.bills).toHaveLength(0);
      expect(Account).not.toHaveBeenCalled();
      expect(Activity).not.toHaveBeenCalled();
      expect(Bill).not.toHaveBeenCalled();
    });

    it('should handle multiple accounts and transfers', () => {
      const multipleData = {
        accounts: [mockAccountData, { ...mockAccountData, id: 'account-2', name: 'Savings' }],
        transfers: {
          activity: [mockActivityData, { ...mockActivityData, id: 'activity-2' }],
          bills: [mockBillData, { ...mockBillData, id: 'bill-2' }],
        },
      };
      vi.mocked(load).mockReturnValue(multipleData);

      const result = getAccountsAndTransfers('Default');

      expect(result.accounts).toHaveLength(2);
      expect(result.transfers.activity).toHaveLength(2);
      expect(result.transfers.bills).toHaveLength(2);
    });
  });

  describe('loadData', () => {
    it('should call calculateAllActivity with the loaded data', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await loadData(startDate, endDate);

      expect(calculateAllActivity).toHaveBeenCalledTimes(1);
    });

    it('should pass startDate and endDate to calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await loadData(startDate, endDate);

      expect(calculateAllActivity).toHaveBeenCalledWith(
        expect.anything(),
        startDate,
        endDate,
        'Default',
        false,
        0,
        0,
        false,
        false,
        {},
      );
    });

    it('should use Default simulation when none provided', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await loadData(startDate, endDate);

      expect(calculateAllActivity).toHaveBeenCalledWith(
        expect.anything(),
        startDate,
        endDate,
        'Default',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should pass custom simulation name to calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await loadData(startDate, endDate, 'MySimulation');

      expect(calculateAllActivity).toHaveBeenCalledWith(
        expect.anything(),
        startDate,
        endDate,
        'MySimulation',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should pass monteCarlo option to calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await loadData(startDate, endDate, 'Default', {}, { monteCarlo: true, simulationNumber: 3, totalSimulations: 10 });

      expect(calculateAllActivity).toHaveBeenCalledWith(
        expect.anything(),
        startDate,
        endDate,
        'Default',
        true,
        3,
        10,
        false,
        false,
        {},
      );
    });

    it('should pass forceRecalculation option to calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await loadData(startDate, endDate, 'Default', {}, { forceRecalculation: true });

      expect(calculateAllActivity).toHaveBeenCalledWith(
        expect.anything(),
        startDate,
        endDate,
        'Default',
        false,
        0,
        0,
        true,
        false,
        {},
      );
    });

    it('should return the result from calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = {
        accounts: [{ id: 'acc-1', name: 'Savings' }],
        transfers: { activity: [], bills: [] },
      };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const result = await loadData(startDate, endDate);

      expect(result).toBe(mockResult);
    });

    it('should pass calculationConfig to calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const calcConfig = { someOption: true };

      await loadData(startDate, endDate, 'Default', calcConfig as any);

      expect(calculateAllActivity).toHaveBeenCalledWith(
        expect.anything(),
        startDate,
        endDate,
        'Default',
        false,
        0,
        0,
        false,
        false,
        calcConfig,
      );
    });

    it('should cache results from calculateAllActivity', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // First call should call calculateAllActivity
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(1);

      // Second call with same parameters should use cache and not call calculateAllActivity
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(1);
    });

    it('should use different cache entries for different simulations', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // Load with different simulations
      await loadData(startDate, endDate, 'Default');
      await loadData(startDate, endDate, 'MySimulation');

      // Both should call calculateAllActivity separately
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);
    });

    it('should use different cache entries for different date ranges', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate1 = new Date('2024-01-01');
      const endDate1 = new Date('2024-12-31');
      const startDate2 = new Date('2024-06-01');
      const endDate2 = new Date('2024-06-30');

      // Load with different date ranges
      await loadData(startDate1, endDate1, 'Default');
      await loadData(startDate2, endDate2, 'Default');

      // Both should call calculateAllActivity separately
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);
    });

    it('should return cached result on subsequent calls', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [{ id: 'acc-1' }], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const result1 = await loadData(startDate, endDate, 'Default');
      const result2 = await loadData(startDate, endDate, 'Default');

      expect(result1).toBe(result2);
    });

    it('should skip cache when monteCarlo option is true', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // First call with monteCarlo: false should cache
      await loadData(startDate, endDate, 'Default', {}, { monteCarlo: false });
      expect(calculateAllActivity).toHaveBeenCalledTimes(1);

      // Second call with monteCarlo: true should skip cache and recalculate
      await loadData(startDate, endDate, 'Default', {}, { monteCarlo: true, simulationNumber: 0, totalSimulations: 1 });
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);
    });

    it('should skip cache when forceRecalculation option is true', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // First call should cache
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(1);

      // Second call with forceRecalculation: true should skip cache
      await loadData(startDate, endDate, 'Default', {}, { forceRecalculation: true });
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);
    });

    it('should invalidate cache when saveData is called', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // First call populates cache
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(1);

      // Save data (should invalidate cache)
      saveData({ accounts: [], transfers: { activity: [], bills: [] } });

      // Second call should not use cache
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);
    });
  });

  describe('saveData', () => {
    it('should serialize all accounts before saving', () => {
      const mockSerialize = vi.fn().mockReturnValue(mockAccountData);
      const mockActivitySerialize = vi.fn().mockReturnValue(mockActivityData);
      const mockBillSerialize = vi.fn().mockReturnValue(mockBillData);

      const data = {
        accounts: [{ serialize: mockSerialize } as any],
        transfers: {
          activity: [{ serialize: mockActivitySerialize } as any],
          bills: [{ serialize: mockBillSerialize } as any],
        },
      };

      saveData(data);

      expect(mockSerialize).toHaveBeenCalledTimes(1);
      expect(mockActivitySerialize).toHaveBeenCalledTimes(1);
      expect(mockBillSerialize).toHaveBeenCalledTimes(1);
    });

    it('should call save with serialized data and correct filename', () => {
      const mockSerialize = vi.fn().mockReturnValue(mockAccountData);
      const mockActivitySerialize = vi.fn().mockReturnValue(mockActivityData);
      const mockBillSerialize = vi.fn().mockReturnValue(mockBillData);

      const data = {
        accounts: [{ serialize: mockSerialize } as any],
        transfers: {
          activity: [{ serialize: mockActivitySerialize } as any],
          bills: [{ serialize: mockBillSerialize } as any],
        },
      };

      saveData(data);

      expect(save).toHaveBeenCalledWith(
        {
          accounts: [mockAccountData],
          transfers: {
            activity: [mockActivityData],
            bills: [mockBillData],
          },
        },
        'data.json',
      );
    });

    it('should call resetCache after saving', () => {
      const data = {
        accounts: [],
        transfers: { activity: [], bills: [] },
      };

      saveData(data);

      expect(resetCache).toHaveBeenCalledTimes(1);
    });

    it('should handle empty data gracefully', () => {
      const data = {
        accounts: [],
        transfers: { activity: [], bills: [] },
      };

      saveData(data);

      expect(save).toHaveBeenCalledWith(
        { accounts: [], transfers: { activity: [], bills: [] } },
        'data.json',
      );
      expect(resetCache).toHaveBeenCalledTimes(1);
    });

    it('should reset cache even if save succeeds', () => {
      const data = {
        accounts: [],
        transfers: { activity: [], bills: [] },
      };

      saveData(data);

      expect(resetCache).toHaveBeenCalled();
    });
  });

  describe('clearDataCache', () => {
    it('should clear the in-memory cache', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // Load data to populate cache
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(1);

      // Clear cache
      clearDataCache();

      // Load again with same parameters - should call calculateAllActivity again
      await loadData(startDate, endDate, 'Default');
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);
    });

    it('should clear cache for all simulations', async () => {
      vi.mocked(load).mockReturnValue(mockRawData);
      const mockResult = { accounts: [], transfers: { activity: [], bills: [] } };
      vi.mocked(calculateAllActivity).mockResolvedValue(mockResult);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // Load with different simulations to populate cache
      await loadData(startDate, endDate, 'Default');
      await loadData(startDate, endDate, 'MySimulation');
      expect(calculateAllActivity).toHaveBeenCalledTimes(2);

      // Clear cache
      clearDataCache();

      // Load again - both should call calculateAllActivity
      await loadData(startDate, endDate, 'Default');
      await loadData(startDate, endDate, 'MySimulation');
      expect(calculateAllActivity).toHaveBeenCalledTimes(4);
    });
  });
});
