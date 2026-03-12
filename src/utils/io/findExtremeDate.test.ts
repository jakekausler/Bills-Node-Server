import { describe, it, expect } from 'vitest';
import { findExtremeDate } from './findExtremeDate';
import { AccountsAndTransfers } from '../../data/account/types';

describe('findExtremeDate', () => {
  const makeAccountsAndTransfers = (overrides: Partial<AccountsAndTransfers> = {}): AccountsAndTransfers => {
    return {
      accounts: [],
      transfers: {
        activity: [],
        bills: [],
      },
      ...overrides,
    };
  };

  describe('finding minimum date', () => {
    const minComparator = (a: Date, b: Date) => a < b;
    const defaultDate = new Date(Date.UTC(2025, 0, 1));

    it('should return default date when no data exists', () => {
      const data = makeAccountsAndTransfers();
      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(defaultDate);
    });

    it('should find minimum date from account activities', () => {
      const earliestDate = new Date(Date.UTC(2023, 5, 15));
      const laterDate = new Date(Date.UTC(2024, 3, 20));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [
              { date: laterDate } as any,
              { date: earliestDate } as any,
            ],
            bills: [],
            interests: [],
          } as any,
        ],
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from account bills', () => {
      const earliestDate = new Date(Date.UTC(2023, 2, 1));
      const laterDate = new Date(Date.UTC(2024, 7, 15));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [],
            bills: [
              { startDate: laterDate } as any,
              { startDate: earliestDate } as any,
            ],
            interests: [],
          } as any,
        ],
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(earliestDate);
    });

    it('should check bill endDate as well as startDate', () => {
      const earliestDate = new Date(Date.UTC(2022, 11, 31));
      const startDate = new Date(Date.UTC(2023, 0, 1));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [],
            bills: [
              { startDate, endDate: earliestDate } as any,
            ],
            interests: [],
          } as any,
        ],
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from account interests', () => {
      const earliestDate = new Date(Date.UTC(2023, 0, 1));
      const laterDate = new Date(Date.UTC(2024, 0, 1));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [],
            bills: [],
            interests: [
              { applicableDate: laterDate } as any,
              { applicableDate: earliestDate } as any,
            ],
          } as any,
        ],
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from transfer activities', () => {
      const earliestDate = new Date(Date.UTC(2023, 8, 15));
      const laterDate = new Date(Date.UTC(2024, 2, 20));

      const data = makeAccountsAndTransfers({
        transfers: {
          activity: [
            { date: laterDate } as any,
            { date: earliestDate } as any,
          ],
          bills: [],
        },
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from transfer bills', () => {
      const earliestDate = new Date(Date.UTC(2023, 1, 1));
      const laterDate = new Date(Date.UTC(2024, 6, 1));

      const data = makeAccountsAndTransfers({
        transfers: {
          activity: [],
          bills: [
            { startDate: laterDate } as any,
            { startDate: earliestDate } as any,
          ],
        },
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(earliestDate);
    });

    it('should find global minimum across all data sources', () => {
      const globalMin = new Date(Date.UTC(2022, 0, 1));
      const otherDate = new Date(Date.UTC(2023, 6, 15));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [{ date: otherDate } as any],
            bills: [{ startDate: globalMin } as any],
            interests: [{ applicableDate: otherDate } as any],
          } as any,
        ],
        transfers: {
          activity: [{ date: otherDate } as any],
          bills: [{ startDate: otherDate } as any],
        },
      });

      const result = findExtremeDate(data, minComparator, defaultDate);
      expect(result).toBe(globalMin);
    });
  });

  describe('finding maximum date', () => {
    const maxComparator = (a: Date, b: Date) => a > b;
    const defaultDate = new Date(Date.UTC(2025, 0, 1));

    it('should return default date when no data exists', () => {
      const data = makeAccountsAndTransfers();
      const result = findExtremeDate(data, maxComparator, defaultDate);
      expect(result).toBe(defaultDate);
    });

    it('should find maximum date from account activities', () => {
      const earlierDate = new Date(Date.UTC(2023, 5, 15));
      const latestDate = new Date(Date.UTC(2026, 3, 20));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [
              { date: earlierDate } as any,
              { date: latestDate } as any,
            ],
            bills: [],
            interests: [],
          } as any,
        ],
      });

      const result = findExtremeDate(data, maxComparator, defaultDate);
      expect(result).toBe(latestDate);
    });

    it('should find global maximum across all data sources', () => {
      const globalMax = new Date(Date.UTC(2030, 11, 31));
      const otherDate = new Date(Date.UTC(2026, 6, 15));

      const data = makeAccountsAndTransfers({
        accounts: [
          {
            activity: [{ date: otherDate } as any],
            bills: [{ startDate: otherDate, endDate: globalMax } as any],
            interests: [{ applicableDate: otherDate } as any],
          } as any,
        ],
        transfers: {
          activity: [{ date: otherDate } as any],
          bills: [{ startDate: otherDate } as any],
        },
      });

      const result = findExtremeDate(data, maxComparator, defaultDate);
      expect(result).toBe(globalMax);
    });
  });
});
