import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maxDate } from './maxDate';
import { loadData } from './accountsAndTransfers';

// Mock the dependencies
vi.mock('./accountsAndTransfers', () => ({
  loadData: vi.fn(),
}));

describe('maxDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return consistent results for same data', async () => {
    const mockData = {
      accounts: [
        {
          activity: [{ date: new Date('2025-12-31') }],
          bills: [],
          interests: [],
        },
      ],
      transfers: { activity: [], bills: [] },
    };
    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const firstResult = await maxDate();
    const secondResult = await maxDate();

    expect(firstResult).toEqual(secondResult);
  });

  it('should find maximum date from activities', async () => {
    const mockData = {
      accounts: [
        {
          activity: [{ date: new Date('2024-01-01') }, { date: new Date('2024-12-31') }],
          bills: [],
          interests: [],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should find maximum date from bills', async () => {
    const mockData = {
      accounts: [
        {
          activity: [],
          bills: [
            { startDate: new Date('2024-01-01'), endDate: new Date('2024-06-30') },
            { startDate: new Date('2024-02-01'), endDate: new Date('2024-12-31') },
          ],
          interests: [],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should handle bills with null endDate', async () => {
    const mockData = {
      accounts: [
        {
          activity: [],
          bills: [
            { startDate: new Date('2024-01-01'), endDate: null },
            { startDate: new Date('2024-06-30'), endDate: new Date('2024-12-31') },
          ],
          interests: [],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should find maximum date from interests', async () => {
    const mockData = {
      accounts: [
        {
          activity: [],
          bills: [],
          interests: [{ applicableDate: new Date('2024-01-01') }, { applicableDate: new Date('2024-12-31') }],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should find maximum date from transfer activities', async () => {
    const mockData = {
      accounts: [],
      transfers: {
        activity: [{ date: new Date('2024-01-01') }, { date: new Date('2024-12-31') }],
        bills: [],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should find maximum date from transfer bills', async () => {
    const mockData = {
      accounts: [],
      transfers: {
        activity: [],
        bills: [
          { startDate: new Date('2024-01-01'), endDate: new Date('2024-06-30') },
          { startDate: new Date('2024-02-01'), endDate: new Date('2024-12-31') },
        ],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should handle transfer bills with null endDate', async () => {
    const mockData = {
      accounts: [],
      transfers: {
        activity: [],
        bills: [
          { startDate: new Date('2024-01-01'), endDate: null },
          { startDate: new Date('2024-06-30'), endDate: new Date('2024-12-31') },
        ],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });

  it('should return current date if no data found', async () => {
    const mockData = {
      accounts: [],
      transfers: {
        activity: [],
        bills: [],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    // Should return a date close to now
    expect(result).toBeInstanceOf(Date);
  });

  it('should find maximum date across all data types', async () => {
    const mockData = {
      accounts: [
        {
          activity: [{ date: new Date('2024-03-01') }],
          bills: [{ startDate: new Date('2024-06-01'), endDate: new Date('2024-09-01') }],
          interests: [{ applicableDate: new Date('2024-02-01') }],
        },
      ],
      transfers: {
        activity: [{ date: new Date('2024-04-01') }],
        bills: [{ startDate: new Date('2024-07-01'), endDate: new Date('2024-12-31') }],
      },
    };

    vi.mocked(loadData).mockResolvedValue(mockData as any);

    const result = await maxDate();

    expect(result).toEqual(new Date('2024-12-31'));
  });
});
