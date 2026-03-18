import { describe, it, expect } from 'vitest';
import { getActivities } from '../helpers';

describe('Contribution Limits', () => {
  describe('401(k) limit enforcement', () => {
    it('Alice 401(k) contributions capped at annual limit with catch-up', () => {
      // TODO: Read 2025 401(k) limit from historicRates.json contributionLimits
      // Alice is 55 -> catch-up eligible
      // Total should be base_limit + catch_up, NOT $46,800 (uncapped biweekly)
      const activities = getActivities('Alice 401(k)');
      const contribs2025 = activities.filter(a =>
        a.date.startsWith('2025') && a.amount > 0 && !a.name.includes('Interest') && !a.name.includes('Employer')
      );
      const total = contribs2025.reduce((sum, c) => sum + c.amount, 0);
      // TODO: Calculate expected limit
      expect(total).toBeLessThan(46800); // Must be capped
      expect(total).toBeCloseTo(0, -2); // PLACEHOLDER -- exact annual limit
    });

    it('Bob 401(k) contributions are NOT capped ($15,600 under limit)', () => {
      const activities = getActivities('Bob 401(k)');
      const contribs2025 = activities.filter(a =>
        a.date.startsWith('2025') && a.amount > 0 && !a.name.includes('Interest') && !a.name.includes('Employer')
      );
      const total = contribs2025.reduce((sum, c) => sum + c.amount, 0);
      // TODO: Verify Bob's $600 biweekly * 26 = $15,600 goes through uncapped
      expect(total).toBeCloseTo(0, -2); // PLACEHOLDER
    });
  });

  describe('HSA limit enforcement', () => {
    it('HSA contributions under limit ($2,040/yr)', () => {
      const activities = getActivities('HSA');
      const contribs2025 = activities.filter(a =>
        a.date.startsWith('2025') && a.amount > 0 && !a.name.includes('Interest')
      );
      const total = contribs2025.reduce((sum, c) => sum + c.amount, 0);
      // TODO: Verify $170/mo * 12 = $2,040 under HSA individual limit + catch-up
      expect(total).toBeCloseTo(0, -1); // PLACEHOLDER
    });
  });
});
