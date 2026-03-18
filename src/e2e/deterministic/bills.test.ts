import { describe, it, expect } from 'vitest';
import { getActivitiesByName, getActivitiesInDateRange } from '../helpers';

describe('Bill Scheduling', () => {
  describe('frequency types', () => {
    it('Alice Paycheck appears biweekly (14 days apart)', () => {
      const paychecks = getActivitiesByName('Checking', 'Alice Paycheck');
      expect(paychecks.length).toBeGreaterThan(0);
      const d1 = new Date(paychecks[0].date);
      const d2 = new Date(paychecks[1].date);
      const daysDiff = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBe(14);
    });

    it('Mortgage Payment appears monthly (12 per year)', () => {
      const payments = getActivitiesByName('Checking', 'Mortgage Payment');
      const year2025 = payments.filter(p => p.date.startsWith('2025'));
      expect(year2025.length).toBe(12);
    });

    it('Property Tax appears yearly (1 per year)', () => {
      const taxes = getActivitiesByName('Checking', 'Property Tax');
      const year2025 = taxes.filter(t => t.date.startsWith('2025'));
      expect(year2025.length).toBe(1);
    });

    it('Alice Dental appears every 6 months (2 per year)', () => {
      const dental = getActivitiesByName('Alice Credit Card', 'Alice Dental');
      const year2026 = dental.filter(d => d.date.startsWith('2026'));
      expect(year2026.length).toBe(2);
    });
  });

  describe('inflation', () => {
    it('Property Tax uses ceiling multiple of 100 after inflation', () => {
      const taxes = getActivitiesByName('Checking', 'Property Tax');
      expect(Math.abs(taxes[0].amount)).toBe(3600); // Base year
      // TODO: Calculate year 2 value: base * (1+INFLATION)^1 rounded up to next multiple of 100
      expect(Math.abs(taxes[1].amount)).toBe(0); // PLACEHOLDER
    });

    it('Mortgage Payment is fixed (no inflation)', () => {
      const payments = getActivitiesByName('Checking', 'Mortgage Payment');
      expect(Math.abs(payments[0].amount)).toBe(2100);
      expect(Math.abs(payments[payments.length - 1].amount)).toBe(2100);
    });

    it('Home Insurance deflates with DEFLATION_TEST_RATE (-2%)', () => {
      const insurance = getActivitiesByName('Checking', 'Home Insurance');
      expect(Math.abs(insurance[0].amount)).toBe(1800);
      // TODO: Calculate year 2: 1800 * (1 + (-0.02)) = ?
      expect(Math.abs(insurance[1].amount)).toBe(0); // PLACEHOLDER
    });

    it('Internet has fixed 3% inflation rate', () => {
      const internet = getActivitiesByName('Shared Credit Card', 'Internet');
      const year1 = internet.filter(i => i.date.startsWith('2025'));
      expect(Math.abs(year1[0].amount)).toBe(80);
      // TODO: Calculate year 2 value: 80 * 1.03 = ?
      const year2 = internet.filter(i => i.date.startsWith('2026'));
      expect(Math.abs(year2[0].amount)).toBeCloseTo(0, 0); // PLACEHOLDER
    });
  });

  describe('variable end dates', () => {
    it('Default: Alice Paycheck stops at RETIRE_DATE (2028-07-01)', () => {
      const paychecks = getActivitiesByName('Checking', 'Alice Paycheck', 'default');
      const lastDate = paychecks[paychecks.length - 1].date.substring(0, 10);
      expect(lastDate <= '2028-07-01').toBe(true);
    });

    it('Conservative: Alice Paycheck runs longer (RETIRE_DATE is 2029-07-01)', () => {
      const paychecks = getActivitiesByName('Checking', 'Alice Paycheck', 'conservative');
      const lastDate = paychecks[paychecks.length - 1].date.substring(0, 10);
      expect(lastDate > '2028-07-01').toBe(true);
      expect(lastDate <= '2029-07-01').toBe(true);
    });
  });
});
