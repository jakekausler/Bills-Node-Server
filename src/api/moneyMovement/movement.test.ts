import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMoneyMovementChart } from './movement';
import { getData } from '../../utils/net/request';
import { getMoneyMovement, getMoneyMovementChartData } from '../../utils/moneyMovement/movement';
import { createMockRequest } from '../../utils/test/mockData';

// Mock dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/moneyMovement/movement');

describe('getMoneyMovementChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get money movement chart data', () => {
    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'account-1',
          name: 'Checking',
          consolidatedActivity: [
            { date: new Date('2024-01-15'), amount: 100 },
            { date: new Date('2024-02-15'), amount: -50 },
          ],
        },
        {
          id: 'account-2',
          name: 'Savings',
          consolidatedActivity: [
            { date: new Date('2024-01-20'), amount: 200 },
            { date: new Date('2024-02-20'), amount: 150 },
          ],
        },
      ],
      transfers: { activity: [], bills: [] },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockMovement = {
      2024: {
        'Checking': 50,
        'Savings': 350,
      },
    };

    const mockChartData = {
      labels: ['2024'],
      datasets: [
        {
          label: 'Checking',
          data: [50],
        },
        {
          label: 'Savings',
          data: [350],
        },
      ],
    };

    const mockRequest = createMockRequest({
      query: {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getMoneyMovement).mockReturnValue(mockMovement);
    vi.mocked(getMoneyMovementChartData).mockReturnValue(mockChartData);

    const result = getMoneyMovementChart(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getMoneyMovement).toHaveBeenCalledWith(
      mockAccountsAndTransfers,
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );
    expect(getMoneyMovementChartData).toHaveBeenCalledWith(mockMovement);
    expect(result).toEqual(mockChartData);
  });

  it('should handle empty accounts and transfers', () => {
    const mockAccountsAndTransfers = {
      accounts: [],
      transfers: { activity: [], bills: [] },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockMovement = {};

    const mockChartData = {
      labels: [],
      datasets: [],
    };

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getMoneyMovement).mockReturnValue(mockMovement);
    vi.mocked(getMoneyMovementChartData).mockReturnValue(mockChartData);

    const result = getMoneyMovementChart(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getMoneyMovement).toHaveBeenCalledWith(
      mockAccountsAndTransfers,
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );
    expect(getMoneyMovementChartData).toHaveBeenCalledWith(mockMovement);
    expect(result).toEqual(mockChartData);
  });

  it('should handle multi-year date ranges', () => {
    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'account-1',
          name: 'Investment',
          consolidatedActivity: [
            { date: new Date('2023-12-31'), amount: 1000 },
            { date: new Date('2024-01-01'), amount: 500 },
            { date: new Date('2024-12-31'), amount: 250 },
          ],
        },
      ],
      transfers: { activity: [], bills: [] },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2023-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockMovement = {
      2023: {
        'Investment': 1000,
      },
      2024: {
        'Investment': 750,
      },
    };

    const mockChartData = {
      labels: ['2023', '2024'],
      datasets: [
        {
          label: 'Investment',
          data: [1000, 750],
        },
      ],
    };

    const mockRequest = createMockRequest({
      query: {
        startDate: '2023-01-01',
        endDate: '2024-12-31',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getMoneyMovement).mockReturnValue(mockMovement);
    vi.mocked(getMoneyMovementChartData).mockReturnValue(mockChartData);

    const result = getMoneyMovementChart(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getMoneyMovement).toHaveBeenCalledWith(
      mockAccountsAndTransfers,
      new Date('2023-01-01'),
      new Date('2024-12-31')
    );
    expect(getMoneyMovementChartData).toHaveBeenCalledWith(mockMovement);
    expect(result).toEqual(mockChartData);
  });

  it('should pass through query parameters to getData', () => {
    const mockAccountsAndTransfers = {
      accounts: [],
      transfers: { activity: [], bills: [] },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-30'),
    };

    const mockRequest = createMockRequest({
      query: {
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        simulation: 'TestSim',
        selectedAccounts: 'account-1,account-2',
      },
    });

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getMoneyMovement).mockReturnValue({});
    vi.mocked(getMoneyMovementChartData).mockReturnValue({ labels: [], datasets: [] });

    getMoneyMovementChart(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
  });

  it('should handle single account movements', () => {
    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'sole-account',
          name: 'Only Account',
          consolidatedActivity: [
            { date: new Date('2024-03-15'), amount: 100 },
            { date: new Date('2024-04-15'), amount: -25 },
            { date: new Date('2024-05-15'), amount: 200 },
          ],
        },
      ],
      transfers: { activity: [], bills: [] },
    };

    const mockData = {
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    const mockMovement = {
      2024: {
        'Only Account': 275,
      },
    };

    const mockChartData = {
      labels: ['2024'],
      datasets: [
        {
          label: 'Only Account',
          data: [275],
        },
      ],
    };

    const mockRequest = createMockRequest();

    vi.mocked(getData).mockReturnValue(mockData as any);
    vi.mocked(getMoneyMovement).mockReturnValue(mockMovement);
    vi.mocked(getMoneyMovementChartData).mockReturnValue(mockChartData);

    const result = getMoneyMovementChart(mockRequest);

    expect(getData).toHaveBeenCalledWith(mockRequest);
    expect(getMoneyMovement).toHaveBeenCalledWith(
      mockAccountsAndTransfers,
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );
    expect(getMoneyMovementChartData).toHaveBeenCalledWith(mockMovement);
    expect(result).toEqual(mockChartData);
  });
});