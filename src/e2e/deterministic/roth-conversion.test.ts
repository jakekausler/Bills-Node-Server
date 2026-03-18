import { describe, it, expect } from 'vitest';
import { getActivities } from '../helpers';

describe('Roth Conversions', () => {
  describe('Alice Roth conversion', () => {
    it('appears on Dec 31 after retirement', () => {
      const activities = getActivities('Alice Roth IRA');
      // TODO: Find exact activity name for Roth conversions
      const conversions = activities.filter(a => a.name.toLowerCase().includes('roth') || a.name.toLowerCase().includes('conversion'));
      expect(conversions.length).toBeGreaterThan(0);
      expect(conversions[0].date.substring(5, 10)).toBe('12-31');
    });

    it('fills up to 22% bracket', () => {
      const activities = getActivities('Alice Roth IRA');
      const conversions = activities.filter(a => a.name.toLowerCase().includes('roth') || a.name.toLowerCase().includes('conversion'));
      if (conversions.length > 0) {
        expect(conversions[0].amount).toBeGreaterThan(0); // Money entering Roth
        // TODO: Calculate bracket space at 22% given pension income
        expect(conversions[0].amount).toBeCloseTo(0, -2); // PLACEHOLDER
      }
    });

    it('stops before Alice SS starts (2037-03-15)', () => {
      const activities = getActivities('Alice Roth IRA');
      const conversions = activities.filter(a => a.name.toLowerCase().includes('roth') || a.name.toLowerCase().includes('conversion'));
      if (conversions.length > 0) {
        const last = conversions[conversions.length - 1].date.substring(0, 10);
        expect(last < '2037-03-15').toBe(true);
      }
    });
  });
});
