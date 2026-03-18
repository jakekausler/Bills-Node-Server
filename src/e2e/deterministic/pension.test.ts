import { describe, it, expect } from 'vitest';
import { getActivitiesByName } from '../helpers';

describe('Pension', () => {
  describe('Alice pension payments', () => {
    it('starts at RETIRE_DATE (July 2028)', () => {
      const pension = getActivitiesByName('Checking', 'Alice Pension');
      expect(pension.length).toBeGreaterThan(0);
      expect(pension[0].date.substring(0, 7)).toBe('PLACEHOLDER'); // PLACEHOLDER
    });

    it('monthly amount = HCA * accrualRate * yearsWorked / 12', () => {
      // TODO: Calculate:
      // HCA = best 5-year average of Alice's last 5 years of pay
      // Monthly = HCA * 0.015 * 20 / 12
      const pension = getActivitiesByName('Checking', 'Alice Pension');
      expect(pension[0].amount).toBeCloseTo(0, 0); // PLACEHOLDER
    });

    it('2% fixed COLA applied each year', () => {
      const pension = getActivitiesByName('Checking', 'Alice Pension');
      // TODO: Compare Jan payments in consecutive years, ratio should be approx 1.02
      expect(pension.length).toBeGreaterThan(12);
    });

    it('continues through end of simulation (2055)', () => {
      const pension = getActivitiesByName('Checking', 'Alice Pension');
      const lastDate = pension[pension.length - 1].date.substring(0, 4);
      expect(lastDate).toBe('2055');
    });
  });
});
