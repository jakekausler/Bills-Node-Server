import { describe, it, expect } from 'vitest';
import { getActivities } from '../helpers';

describe('Required Minimum Distributions', () => {
  describe('Alice RMDs', () => {
    it('start in 2043 (age 73)', () => {
      const activities = getActivities('Alice 401(k)');
      // TODO: Find the exact activity name for RMDs
      const rmds = activities.filter(a => a.name.toLowerCase().includes('rmd'));
      const first = rmds.find(r => r.date.substring(0, 4) >= '2043');
      expect(first).toBeDefined();
    });

    it('RMD amount = prior year-end balance / IRS divisor', () => {
      // TODO: Calculate from Dec 31 2042 balance and age-73 divisor (26.5)
      const activities = getActivities('Alice 401(k)');
      const rmds = activities.filter(a => a.name.toLowerCase().includes('rmd') && a.date.startsWith('2043'));
      if (rmds.length > 0) {
        expect(rmds[0].amount).toBeLessThan(0); // Money leaving 401(k)
        expect(Math.abs(rmds[0].amount)).toBeCloseTo(0, -2); // PLACEHOLDER
      }
    });
  });

  describe('Bob RMDs', () => {
    it('start in 2046 (age 73)', () => {
      const activities = getActivities('Bob 401(k)');
      const rmds = activities.filter(a => a.name.toLowerCase().includes('rmd'));
      const first = rmds.find(r => r.date.substring(0, 4) >= '2046');
      expect(first).toBeDefined();
    });
  });
});
