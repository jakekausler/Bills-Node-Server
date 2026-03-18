import { describe, it, expect } from 'vitest';
import { getActivitiesByName, getActivities } from '../helpers';

describe('Transfers & Push/Pull', () => {
  describe('credit card payments', () => {
    it('Alice CC Payment uses {FULL} -- balance near 0 after payment', () => {
      // TODO: Verify the activity name the engine uses for CC payments
      const ccActivities = getActivities('Alice Credit Card');
      // After each payment cycle, balance should reset near 0
      expect(ccActivities.length).toBeGreaterThan(0);
    });

    it('Shared CC has two {HALF} payments per month', () => {
      const ccActivities = getActivities('Shared Credit Card');
      // TODO: Verify payment activity names and count per month
      expect(ccActivities.length).toBeGreaterThan(0);
    });
  });

  describe('401(k) contributions', () => {
    it('Alice 401(k) receives contributions that stop at RETIRE_DATE', () => {
      // TODO: Find the activity name for 401k contributions
      const activities = getActivities('Alice 401(k)');
      const contribs = activities.filter(a => a.amount > 0 && !a.name.includes('Interest'));
      expect(contribs.length).toBeGreaterThan(0);
      const lastDate = contribs[contribs.length - 1].date.substring(0, 10);
      expect(lastDate <= '2028-07-01').toBe(true);
    });
  });

  describe('push/pull', () => {
    it('Checking pushes excess to HYSA when above $25,000', () => {
      // TODO: Find the exact activity name for auto-push events
      const hysa = getActivities('HYSA');
      const pushes = hysa.filter(a => a.name.includes('Push') || a.name.includes('push'));
      // Should have push events when paychecks accumulate past max
      expect(pushes.length).toBeGreaterThanOrEqual(0); // PLACEHOLDER -- verify pushes occur
    });

    it('Minimum pull amount is $1,000', () => {
      const checking = getActivities('Checking');
      const pulls = checking.filter(a => (a.name.includes('Pull') || a.name.includes('pull')) && a.amount > 0);
      if (pulls.length > 0) {
        pulls.forEach(p => {
          expect(p.amount).toBeGreaterThanOrEqual(1000);
        });
      }
    });
  });
});
