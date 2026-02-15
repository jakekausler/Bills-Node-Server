import { describe, it, expect } from 'vitest';
import { computePeriodBoundaries } from './period-utils';

/** Helper to create a UTC date */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Helper to extract YYYY-MM-DD from a Date for readable assertions */
function fmt(date: Date): string {
  return date.toISOString().split('T')[0];
}

describe('computePeriodBoundaries', () => {
  describe('weekly', () => {
    it('should generate weekly periods starting Saturday with periodEnd on Friday', () => {
      // Saturday Jan 4, 2025 through Friday Jan 31, 2025
      const results = computePeriodBoundaries(
        'weekly',
        'Saturday',
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      expect(results.length).toBe(4);

      // First period: Sat Jan 4 - Fri Jan 10
      expect(fmt(results[0].periodStart)).toBe('2025-01-04');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-10');

      // Second period: Sat Jan 11 - Fri Jan 17
      expect(fmt(results[1].periodStart)).toBe('2025-01-11');
      expect(fmt(results[1].periodEnd)).toBe('2025-01-17');

      // Third period: Sat Jan 18 - Fri Jan 24
      expect(fmt(results[2].periodStart)).toBe('2025-01-18');
      expect(fmt(results[2].periodEnd)).toBe('2025-01-24');

      // Fourth period: Sat Jan 25 - Fri Jan 31
      expect(fmt(results[3].periodStart)).toBe('2025-01-25');
      expect(fmt(results[3].periodEnd)).toBe('2025-01-31');
    });

    it('should generate weekly periods starting Monday with periodEnd on Sunday', () => {
      // Mon Jan 6, 2025 through Sun Jan 26, 2025
      const results = computePeriodBoundaries(
        'weekly',
        'Monday',
        utcDate(2025, 1, 6),
        utcDate(2025, 1, 26),
      );

      expect(results.length).toBe(3);

      expect(fmt(results[0].periodStart)).toBe('2025-01-06');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-12');

      expect(fmt(results[1].periodStart)).toBe('2025-01-13');
      expect(fmt(results[1].periodEnd)).toBe('2025-01-19');

      expect(fmt(results[2].periodStart)).toBe('2025-01-20');
      expect(fmt(results[2].periodEnd)).toBe('2025-01-26');
    });

    it('should include partial first week when startDate falls mid-period', () => {
      // Start on Wednesday Jan 8 (mid-week for a Saturday start)
      const results = computePeriodBoundaries(
        'weekly',
        'Saturday',
        utcDate(2025, 1, 8),
        utcDate(2025, 1, 17),
      );

      // Period Sat Jan 4 - Fri Jan 10 overlaps with startDate Jan 8, so included
      // Period Sat Jan 11 - Fri Jan 17 also included
      expect(results.length).toBe(2);

      expect(fmt(results[0].periodStart)).toBe('2025-01-04');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-10');

      expect(fmt(results[1].periodStart)).toBe('2025-01-11');
      expect(fmt(results[1].periodEnd)).toBe('2025-01-17');
    });

    it('should handle period that starts before startDate but ends within range', () => {
      // Start on Thursday Jan 9 with Saturday interval
      // The period Sat Jan 4 - Fri Jan 10 has periodEnd (Jan 10) >= startDate (Jan 9)
      const results = computePeriodBoundaries(
        'weekly',
        'Saturday',
        utcDate(2025, 1, 9),
        utcDate(2025, 1, 10),
      );

      expect(results.length).toBe(1);
      expect(fmt(results[0].periodStart)).toBe('2025-01-04');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-10');
    });

    it('should return correct number of weeks for a multi-week range', () => {
      // 4 full weeks: Jan 6 (Mon) to Feb 2 (Sun)
      const results = computePeriodBoundaries(
        'weekly',
        'Monday',
        utcDate(2025, 1, 6),
        utcDate(2025, 2, 2),
      );

      expect(results.length).toBe(4);
    });

    it('should return empty when endDate is before startDate', () => {
      const results = computePeriodBoundaries(
        'weekly',
        'Saturday',
        utcDate(2025, 1, 10),
        utcDate(2025, 1, 5),
      );

      expect(results.length).toBe(0);
    });
  });

  describe('monthly', () => {
    it('should generate monthly periods starting on the 1st with periodEnd on last day of month', () => {
      const results = computePeriodBoundaries(
        'monthly',
        '1',
        utcDate(2025, 1, 1),
        utcDate(2025, 4, 30),
      );

      expect(results.length).toBe(4);

      // Jan 1 - Jan 31
      expect(fmt(results[0].periodStart)).toBe('2025-01-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-31');

      // Feb 1 - Feb 28 (2025 is not a leap year)
      expect(fmt(results[1].periodStart)).toBe('2025-02-01');
      expect(fmt(results[1].periodEnd)).toBe('2025-02-28');

      // Mar 1 - Mar 31
      expect(fmt(results[2].periodStart)).toBe('2025-03-01');
      expect(fmt(results[2].periodEnd)).toBe('2025-03-31');

      // Apr 1 - Apr 30
      expect(fmt(results[3].periodStart)).toBe('2025-04-01');
      expect(fmt(results[3].periodEnd)).toBe('2025-04-30');
    });

    it('should generate monthly periods starting on the 15th with periodEnd on the 14th', () => {
      const results = computePeriodBoundaries(
        'monthly',
        '15',
        utcDate(2025, 1, 15),
        utcDate(2025, 4, 14),
      );

      expect(results.length).toBe(3);

      // Jan 15 - Feb 14
      expect(fmt(results[0].periodStart)).toBe('2025-01-15');
      expect(fmt(results[0].periodEnd)).toBe('2025-02-14');

      // Feb 15 - Mar 14
      expect(fmt(results[1].periodStart)).toBe('2025-02-15');
      expect(fmt(results[1].periodEnd)).toBe('2025-03-14');

      // Mar 15 - Apr 14
      expect(fmt(results[2].periodStart)).toBe('2025-03-15');
      expect(fmt(results[2].periodEnd)).toBe('2025-04-14');
    });

    it('should clamp day 28 correctly in February (non-leap year)', () => {
      // Feb 2025 has 28 days, so day 28 is the last day
      const results = computePeriodBoundaries(
        'monthly',
        '28',
        utcDate(2025, 1, 28),
        utcDate(2025, 3, 27),
      );

      expect(results.length).toBe(2);

      // Jan 28 - Feb 27
      expect(fmt(results[0].periodStart)).toBe('2025-01-28');
      expect(fmt(results[0].periodEnd)).toBe('2025-02-27');

      // Feb 28 - Mar 27
      expect(fmt(results[1].periodStart)).toBe('2025-02-28');
      expect(fmt(results[1].periodEnd)).toBe('2025-03-27');
    });

    it('should clamp day 28 correctly in February (leap year)', () => {
      // 2024 is a leap year, Feb has 29 days
      const results = computePeriodBoundaries(
        'monthly',
        '28',
        utcDate(2024, 1, 28),
        utcDate(2024, 3, 27),
      );

      expect(results.length).toBe(2);

      // Jan 28 - Feb 27
      expect(fmt(results[0].periodStart)).toBe('2024-01-28');
      expect(fmt(results[0].periodEnd)).toBe('2024-02-27');

      // Feb 28 - Mar 27
      expect(fmt(results[1].periodStart)).toBe('2024-02-28');
      expect(fmt(results[1].periodEnd)).toBe('2024-03-27');
    });

    it('should handle short months correctly for day 28', () => {
      // All months have at least 28 days, so 28 should never clamp.
      // But let's verify across a range that includes Feb.
      const results = computePeriodBoundaries(
        'monthly',
        '28',
        utcDate(2025, 2, 28),
        utcDate(2025, 5, 27),
      );

      expect(results.length).toBe(3);

      // Feb 28 - Mar 27
      expect(fmt(results[0].periodStart)).toBe('2025-02-28');
      expect(fmt(results[0].periodEnd)).toBe('2025-03-27');

      // Mar 28 - Apr 27
      expect(fmt(results[1].periodStart)).toBe('2025-03-28');
      expect(fmt(results[1].periodEnd)).toBe('2025-04-27');

      // Apr 28 - May 27
      expect(fmt(results[2].periodStart)).toBe('2025-04-28');
      expect(fmt(results[2].periodEnd)).toBe('2025-05-27');
    });

    it('should include period where startDate falls mid-period', () => {
      // intervalStart is 1, startDate is Jan 15 (mid-period)
      const results = computePeriodBoundaries(
        'monthly',
        '1',
        utcDate(2025, 1, 15),
        utcDate(2025, 2, 28),
      );

      // Period Jan 1 - Jan 31 has periodEnd (Jan 31) >= startDate (Jan 15). Included.
      // Period Feb 1 - Feb 28 also included.
      expect(results.length).toBe(2);

      expect(fmt(results[0].periodStart)).toBe('2025-01-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-31');

      expect(fmt(results[1].periodStart)).toBe('2025-02-01');
      expect(fmt(results[1].periodEnd)).toBe('2025-02-28');
    });

    it('should handle year boundary correctly', () => {
      const results = computePeriodBoundaries(
        'monthly',
        '15',
        utcDate(2024, 12, 15),
        utcDate(2025, 2, 14),
      );

      expect(results.length).toBe(2);

      // Dec 15 - Jan 14
      expect(fmt(results[0].periodStart)).toBe('2024-12-15');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-14');

      // Jan 15 - Feb 14
      expect(fmt(results[1].periodStart)).toBe('2025-01-15');
      expect(fmt(results[1].periodEnd)).toBe('2025-02-14');
    });
  });

  describe('yearly', () => {
    it('should generate yearly periods starting 01/01 with periodEnd on 12/31', () => {
      const results = computePeriodBoundaries(
        'yearly',
        '01/01',
        utcDate(2025, 1, 1),
        utcDate(2027, 12, 31),
      );

      expect(results.length).toBe(3);

      // 2025: Jan 1 - Dec 31
      expect(fmt(results[0].periodStart)).toBe('2025-01-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-12-31');

      // 2026: Jan 1 - Dec 31
      expect(fmt(results[1].periodStart)).toBe('2026-01-01');
      expect(fmt(results[1].periodEnd)).toBe('2026-12-31');

      // 2027: Jan 1 - Dec 31
      expect(fmt(results[2].periodStart)).toBe('2027-01-01');
      expect(fmt(results[2].periodEnd)).toBe('2027-12-31');
    });

    it('should generate yearly periods starting 06/15 with periodEnd on 06/14', () => {
      const results = computePeriodBoundaries(
        'yearly',
        '06/15',
        utcDate(2025, 6, 15),
        utcDate(2027, 6, 14),
      );

      expect(results.length).toBe(2);

      // Jun 15, 2025 - Jun 14, 2026
      expect(fmt(results[0].periodStart)).toBe('2025-06-15');
      expect(fmt(results[0].periodEnd)).toBe('2026-06-14');

      // Jun 15, 2026 - Jun 14, 2027
      expect(fmt(results[1].periodStart)).toBe('2026-06-15');
      expect(fmt(results[1].periodEnd)).toBe('2027-06-14');
    });

    it('should return correct number of periods for multi-year range', () => {
      const results = computePeriodBoundaries(
        'yearly',
        '01/01',
        utcDate(2020, 1, 1),
        utcDate(2025, 12, 31),
      );

      expect(results.length).toBe(6);
    });

    it('should include period where startDate falls mid-period', () => {
      // Yearly starting 01/01, startDate is Jun 15 2025 (mid-year)
      const results = computePeriodBoundaries(
        'yearly',
        '01/01',
        utcDate(2025, 6, 15),
        utcDate(2026, 6, 15),
      );

      // Period Jan 1 2025 - Dec 31 2025: periodEnd (Dec 31) >= startDate (Jun 15). Included.
      // Period Jan 1 2026 - Dec 31 2026: periodStart (Jan 1) <= endDate (Jun 15). Included.
      expect(results.length).toBe(2);

      expect(fmt(results[0].periodStart)).toBe('2025-01-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-12-31');

      expect(fmt(results[1].periodStart)).toBe('2026-01-01');
      expect(fmt(results[1].periodEnd)).toBe('2026-12-31');
    });

    it('should handle year boundary when intervalStart is late in the year', () => {
      // Starting 11/01, range from Jan 2025 to Oct 2026
      const results = computePeriodBoundaries(
        'yearly',
        '11/01',
        utcDate(2025, 1, 1),
        utcDate(2026, 10, 31),
      );

      // Period Nov 1 2024 - Oct 31 2025: periodEnd (Oct 31 2025) >= startDate. Included.
      // Period Nov 1 2025 - Oct 31 2026: periodEnd (Oct 31 2026) >= startDate and periodStart <= endDate. Included.
      expect(results.length).toBe(2);

      expect(fmt(results[0].periodStart)).toBe('2024-11-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-10-31');

      expect(fmt(results[1].periodStart)).toBe('2025-11-01');
      expect(fmt(results[1].periodEnd)).toBe('2026-10-31');
    });
  });

  describe('edge cases', () => {
    it('should return empty array when endDate is before startDate', () => {
      const results = computePeriodBoundaries(
        'monthly',
        '1',
        utcDate(2025, 6, 1),
        utcDate(2025, 1, 1),
      );

      expect(results.length).toBe(0);
    });

    it('should return single period when range spans exactly one period', () => {
      const results = computePeriodBoundaries(
        'monthly',
        '1',
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      expect(results.length).toBe(1);
      expect(fmt(results[0].periodStart)).toBe('2025-03-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-03-31');
    });

    it('should handle startDate exactly on period boundary', () => {
      // startDate is exactly on the period start (Saturday)
      const results = computePeriodBoundaries(
        'weekly',
        'Saturday',
        utcDate(2025, 1, 4), // This is a Saturday
        utcDate(2025, 1, 10),
      );

      expect(results.length).toBe(1);
      expect(fmt(results[0].periodStart)).toBe('2025-01-04');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-10');
    });

    it('should handle endDate exactly on period boundary', () => {
      // endDate is exactly on periodEnd (Friday)
      const results = computePeriodBoundaries(
        'weekly',
        'Saturday',
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 10), // Friday
      );

      expect(results.length).toBe(1);
      expect(fmt(results[0].periodStart)).toBe('2025-01-04');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-10');
    });

    it('should handle single-day range that falls within a period', () => {
      const results = computePeriodBoundaries(
        'monthly',
        '1',
        utcDate(2025, 1, 15),
        utcDate(2025, 1, 15),
      );

      // Jan 1 - Jan 31 period contains Jan 15
      expect(results.length).toBe(1);
      expect(fmt(results[0].periodStart)).toBe('2025-01-01');
      expect(fmt(results[0].periodEnd)).toBe('2025-01-31');
    });

    it('should derive periodEnd from nextPeriodStart minus 1 day consistently', () => {
      // Verify the invariant: periodEnd[i] + 1 day === periodStart[i+1]
      const results = computePeriodBoundaries(
        'monthly',
        '15',
        utcDate(2025, 1, 15),
        utcDate(2025, 6, 14),
      );

      for (let i = 0; i < results.length - 1; i++) {
        const periodEndPlus1 = new Date(results[i].periodEnd.getTime() + 86400000);
        expect(fmt(periodEndPlus1)).toBe(fmt(results[i + 1].periodStart));
      }
    });
  });
});
