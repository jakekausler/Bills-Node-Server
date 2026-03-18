import { describe, it, expect } from 'vitest';
import { getActivitiesByName } from '../helpers';

describe('Social Security', () => {
  describe('Alice SS', () => {
    it('first payment appears after FRA (April 2037)', () => {
      const ss = getActivitiesByName('Checking', 'Alice Social Security');
      expect(ss.length).toBeGreaterThan(0);
      // TODO: Verify exact first payment date (month after FRA birthday)
      expect(ss[0].date.substring(0, 7)).toBe('PLACEHOLDER'); // PLACEHOLDER -- e.g. '2037-04'
    });

    it('monthly benefit amount matches AIME/PIA calculation', () => {
      const ss = getActivitiesByName('Checking', 'Alice Social Security');
      // TODO: Calculate AIME from 35-year earnings, apply bend points, get PIA
      // Then adjust for FRA claiming age (67 = 100% of PIA)
      expect(ss[0].amount).toBeCloseTo(0, 0); // PLACEHOLDER
    });

    it('COLA increases benefit each year at SS_COLA_RATE (2.5%)', () => {
      const ss = getActivitiesByName('Checking', 'Alice Social Security');
      // TODO: Find payments in consecutive years and verify ratio is approx 1.025
      // Placeholder structural check:
      expect(ss.length).toBeGreaterThan(12); // More than 1 year of payments
    });
  });

  describe('Bob SS with spousal benefit', () => {
    it('first payment appears after Bob FRA (July 2040)', () => {
      const ss = getActivitiesByName('Checking', 'Bob Social Security');
      expect(ss.length).toBeGreaterThan(0);
      expect(ss[0].date.substring(0, 7)).toBe('PLACEHOLDER'); // PLACEHOLDER
    });

    it('benefit is max(own PIA, 50% of Alice PIA)', () => {
      // TODO: Calculate Bob's own PIA from his earnings
      // Compare with 50% of Alice's PIA
      // Benefit = max(own, 50% spouse)
      const ss = getActivitiesByName('Checking', 'Bob Social Security');
      expect(ss[0].amount).toBeCloseTo(0, 0); // PLACEHOLDER
    });
  });
});
