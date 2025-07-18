import { describe, it, expect, vi, beforeEach } from 'vitest';
import { minDate } from './minDate';
import { resetCache } from './cache';
import { loadData } from './accountsAndTransfers';

// Mock the dependencies
vi.mock('./accountsAndTransfers', () => ({
  loadData: vi.fn(),
}));

describe('minDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCache(); // Reset cache instead of mocking
  });

  it('should return cached MIN_DATE if available', () => {
    // First call will set the cache
    const mockData = {
      accounts: [{
        activity: [{ date: new Date('2020-01-01') }],
        bills: [],
        interests: [],
      }],
      transfers: { activity: [], bills: [] },
    };
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const firstResult = minDate();
    const secondResult = minDate();
    
    expect(firstResult).toEqual(secondResult);
    expect(loadData).toHaveBeenCalledTimes(1); // Should only call loadData once
  });

  it('should find minimum date from activities', () => {
    const mockData = {
      accounts: [
        {
          activity: [
            { date: new Date('2024-01-01') },
            { date: new Date('2024-12-31') },
          ],
          bills: [],
          interests: [],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should find minimum date from bills', () => {
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
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should handle bills with null endDate', () => {
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
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should find minimum date from interests', () => {
    const mockData = {
      accounts: [
        {
          activity: [],
          bills: [],
          interests: [
            { applicableDate: new Date('2024-01-01') },
            { applicableDate: new Date('2024-12-31') },
          ],
        },
      ],
      transfers: {
        activity: [],
        bills: [],
      },
    };
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should find minimum date from transfer activities', () => {
    const mockData = {
      accounts: [],
      transfers: {
        activity: [
          { date: new Date('2024-01-01') },
          { date: new Date('2024-12-31') },
        ],
        bills: [],
      },
    };
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should find minimum date from transfer bills', () => {
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
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should handle transfer bills with null endDate', () => {
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
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });

  it('should return current date if no data found', () => {
    const mockData = {
      accounts: [],
      transfers: {
        activity: [],
        bills: [],
      },
    };
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    // Should return a date close to now
    expect(result).toBeInstanceOf(Date);
  });

  it('should find minimum date across all data types', () => {
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
        bills: [{ startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') }],
      },
    };
    
    vi.mocked(loadData).mockReturnValue(mockData as any);
    
    const result = minDate();
    
    expect(result).toEqual(new Date('2024-01-01'));
  });
});