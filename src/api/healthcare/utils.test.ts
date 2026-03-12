import { describe, it, expect } from 'vitest';
import { getPlanYear } from './utils';

describe('Healthcare Utils', () => {
  describe('getPlanYear', () => {
    it('should return current year when date is on reset date', () => {
      // Jan 1, 2024 with Jan 1 reset
      const date = new Date(Date.UTC(2024, 0, 1));
      const planYear = getPlanYear(date, 0, 1);
      expect(planYear).toBe(2024);
    });

    it('should return current year when date is after reset date', () => {
      // March 15, 2024 with Jan 1 reset
      const date = new Date(Date.UTC(2024, 2, 15));
      const planYear = getPlanYear(date, 0, 1);
      expect(planYear).toBe(2024);
    });

    it('should return previous year when date is before reset date', () => {
      // March 15, 2024 with July 1 reset (month 6, day 1)
      const date = new Date(Date.UTC(2024, 2, 15));
      const planYear = getPlanYear(date, 6, 1);
      expect(planYear).toBe(2023);
    });

    it('should return previous year when before reset month', () => {
      // February 28, 2024 with July 1 reset
      const date = new Date(Date.UTC(2024, 1, 28));
      const planYear = getPlanYear(date, 6, 1);
      expect(planYear).toBe(2023);
    });

    it('should return current year when on reset day in reset month', () => {
      // July 1, 2024 with July 1 reset
      const date = new Date(Date.UTC(2024, 6, 1));
      const planYear = getPlanYear(date, 6, 1);
      expect(planYear).toBe(2024);
    });

    it('should return previous year when day before reset in reset month', () => {
      // June 30, 2024 with July 1 reset
      const date = new Date(Date.UTC(2024, 5, 30));
      const planYear = getPlanYear(date, 6, 1);
      expect(planYear).toBe(2023);
    });

    it('should handle mid-month reset dates', () => {
      // April 14, 2024 with April 15 reset
      const date = new Date(Date.UTC(2024, 3, 14));
      const planYear = getPlanYear(date, 3, 15);
      expect(planYear).toBe(2023);

      // April 15, 2024 with April 15 reset
      const date2 = new Date(Date.UTC(2024, 3, 15));
      const planYear2 = getPlanYear(date2, 3, 15);
      expect(planYear2).toBe(2024);
    });

    it('should handle December reset dates', () => {
      // November 30, 2024 with Dec 15 reset
      const date = new Date(Date.UTC(2024, 10, 30));
      const planYear = getPlanYear(date, 11, 15);
      expect(planYear).toBe(2023);

      // December 20, 2024 with Dec 15 reset
      const date2 = new Date(Date.UTC(2024, 11, 20));
      const planYear2 = getPlanYear(date2, 11, 15);
      expect(planYear2).toBe(2024);
    });
  });
});
