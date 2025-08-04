import { describe, it, expect } from 'vitest';
import { formatDate, parseDate, getMinDate, isBefore, isSame, isBeforeOrSame, isAfter, isAfterOrSame } from './date';
import { AccountsAndTransfers } from '../../data/account/types';
import { Account } from '../../data/account/account';

describe('Date utilities', () => {
  describe('formatDate', () => {
    it('should format date to YYYY-MM-DD string', () => {
      const date = new Date('2023-01-15T10:30:00Z');
      const result = formatDate(date);

      expect(result).toBe('2023-01-15');
    });

    it('should handle leap year dates', () => {
      const date = new Date('2024-02-29T00:00:00Z');
      const result = formatDate(date);

      expect(result).toBe('2024-02-29');
    });

    it('should handle end of year dates', () => {
      const date = new Date('2023-12-31T23:59:59Z');
      const result = formatDate(date);

      expect(result).toBe('2023-12-31');
    });
  });

  describe('parseDate', () => {
    it('should parse valid date strings', () => {
      const result = parseDate('2023-01-15');

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(0); // January is 0-indexed
      expect(result.getUTCDate()).toBe(15); // Use UTC to avoid timezone issues
    });

    it('should handle different date formats', () => {
      const result = parseDate('2023-12-25');

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(11); // December is 11
      expect(result.getUTCDate()).toBe(25); // Use UTC to avoid timezone issues
    });

    it('should throw error for invalid date strings', () => {
      expect(() => parseDate('invalid-date' as any)).toThrow("Invalid date 'invalid-date'");
    });

    it('should throw error for malformed date strings', () => {
      expect(() => parseDate('2023-13-45' as any)).toThrow("Invalid date '2023-13-45'");
    });
  });

  describe('getMinDate', () => {
    it('should return current date when no activities exist', () => {
      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = getMinDate(accountsAndTransfers);
      const now = new Date();

      // Should be very close to current time
      expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('should find minimum date from account activities (first element since sorted)', () => {
      const earliestDate = new Date('2023-01-01');
      const laterDate = new Date('2023-06-15');

      const mockAccount = {
        activity: [
          { date: earliestDate }, // First element (earliest since array is sorted)
          { date: laterDate },
        ],
        bills: [],
        interests: [],
      } as Account;

      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [mockAccount],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = getMinDate(accountsAndTransfers);

      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from account bills (first element since sorted)', () => {
      const earliestDate = new Date('2022-12-01');
      const laterDate = new Date('2023-03-15');

      const mockAccount = {
        activity: [],
        bills: [
          { startDate: earliestDate }, // First element (earliest since array is sorted)
          { startDate: laterDate },
        ],
        interests: [],
      } as Account;

      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [mockAccount],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = getMinDate(accountsAndTransfers);

      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from account interests (first element since sorted)', () => {
      const earliestDate = new Date('2022-11-15');
      const laterDate = new Date('2023-02-28');

      const mockAccount = {
        activity: [],
        bills: [],
        interests: [
          { applicableDate: earliestDate }, // First element (earliest since array is sorted)
          { applicableDate: laterDate },
        ],
      } as Account;

      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [mockAccount],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = getMinDate(accountsAndTransfers);

      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from transfer activities', () => {
      const earliestDate = new Date('2022-10-01');
      const laterDate = new Date('2023-01-15');

      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [],
        transfers: {
          activity: [{ date: laterDate }, { date: earliestDate }],
          bills: [],
        },
      };

      const result = getMinDate(accountsAndTransfers);

      expect(result).toBe(earliestDate);
    });

    it('should find minimum date from transfer bills', () => {
      const earliestDate = new Date('2022-09-15');
      const laterDate = new Date('2023-04-20');

      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [],
        transfers: {
          activity: [],
          bills: [{ startDate: laterDate }, { startDate: earliestDate }],
        },
      };

      const result = getMinDate(accountsAndTransfers);

      expect(result).toBe(earliestDate);
    });

    it('should find overall minimum date across all sources', () => {
      const globalMin = new Date('2022-01-01');
      const otherDate = new Date('2023-06-15');

      const mockAccount = {
        activity: [{ date: otherDate }],
        bills: [{ startDate: globalMin }], // This should be the minimum
        interests: [{ applicableDate: otherDate }],
      } as Account;

      const accountsAndTransfers: AccountsAndTransfers = {
        accounts: [mockAccount],
        transfers: {
          activity: [{ date: otherDate }],
          bills: [{ startDate: otherDate }],
        },
      };

      const result = getMinDate(accountsAndTransfers);

      expect(result).toBe(globalMin);
    });
  });

  describe('isBefore', () => {
    it('should return true when first date is before second', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-16');

      expect(isBefore(date1, date2)).toBe(true);
    });

    it('should return false when first date is after second', () => {
      const date1 = new Date('2023-01-16');
      const date2 = new Date('2023-01-15');

      expect(isBefore(date1, date2)).toBe(false);
    });

    it('should return false when dates are the same', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-15');

      expect(isBefore(date1, date2)).toBe(false);
    });

    it('should handle different times on same day', () => {
      const date1 = new Date('2023-01-15T09:00:00Z');
      const date2 = new Date('2023-01-15T15:00:00Z');

      expect(isBefore(date1, date2)).toBe(false); // Same day, so not before
    });
  });

  describe('isSame', () => {
    it('should return true when dates are the same day', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-15');

      expect(isSame(date1, date2)).toBe(true);
    });

    it('should return true for different times on same day', () => {
      const date1 = new Date('2023-01-15T09:00:00Z');
      const date2 = new Date('2023-01-15T18:00:00Z');

      expect(isSame(date1, date2)).toBe(true);
    });

    it('should return false when dates are different days', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-16');

      expect(isSame(date1, date2)).toBe(false);
    });
  });

  describe('isBeforeOrSame', () => {
    it('should return true when first date is before second', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-16');

      expect(isBeforeOrSame(date1, date2)).toBe(true);
    });

    it('should return true when dates are the same', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-15');

      expect(isBeforeOrSame(date1, date2)).toBe(true);
    });

    it('should return false when first date is after second', () => {
      const date1 = new Date('2023-01-16');
      const date2 = new Date('2023-01-15');

      expect(isBeforeOrSame(date1, date2)).toBe(false);
    });
  });

  describe('isAfter', () => {
    it('should return true when first date is after second', () => {
      const date1 = new Date('2023-01-16');
      const date2 = new Date('2023-01-15');

      expect(isAfter(date1, date2)).toBe(true);
    });

    it('should return false when first date is before second', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-16');

      expect(isAfter(date1, date2)).toBe(false);
    });

    it('should return false when dates are the same', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-15');

      expect(isAfter(date1, date2)).toBe(false);
    });
  });

  describe('isAfterOrSame', () => {
    it('should return true when first date is after second', () => {
      const date1 = new Date('2023-01-16');
      const date2 = new Date('2023-01-15');

      expect(isAfterOrSame(date1, date2)).toBe(true);
    });

    it('should return true when dates are the same', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-15');

      expect(isAfterOrSame(date1, date2)).toBe(true);
    });

    it('should return false when first date is before second', () => {
      const date1 = new Date('2023-01-15');
      const date2 = new Date('2023-01-16');

      expect(isAfterOrSame(date1, date2)).toBe(false);
    });
  });
});
