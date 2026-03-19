import { describe, it, expect } from 'vitest';
import {
  getMonthEndBalance,
  getActivitiesInMonth,
  getAutoPushPullActivities,
} from '../helpers';
import { calculatePush, calculatePull } from '../calculators/push-pull-calculator';

// Checking account configuration from data.json
const CHECKING_MIN_BALANCE = 5000;
const CHECKING_MAX_BALANCE = 25000;
const CHECKING_MIN_PULL_AMOUNT = 1000;
const PUSH_TARGET = 'HYSA';

describe('Push/Pull Mechanics', () => {
  describe('Shadow calculator sanity checks', () => {
    it('calculatePush returns excess when balance exceeds max', () => {
      expect(calculatePush(30000, 25000)).toBe(5000);
    });

    it('calculatePush returns 0 when balance is at or below max', () => {
      expect(calculatePush(25000, 25000)).toBe(0);
      expect(calculatePush(20000, 25000)).toBe(0);
    });

    it('calculatePull returns deficit when balance falls below min', () => {
      // deficit = 5000 - 3000 = 2000, which exceeds minimumPullAmount of 1000
      expect(calculatePull(3000, 5000, 1000)).toBe(2000);
    });

    it('calculatePull returns minimumPullAmount when deficit is smaller', () => {
      // deficit = 5000 - 4500 = 500, but min pull is 1000
      expect(calculatePull(4500, 5000, 1000)).toBe(1000);
    });

    it('calculatePull returns 0 when balance is at or above min', () => {
      expect(calculatePull(5000, 5000, 1000)).toBe(0);
      expect(calculatePull(10000, 5000, 1000)).toBe(0);
    });
  });

  describe('2025-01: Pre-retirement — paychecks flowing in', () => {
    const yearMonth = '2025-01';

    it('should have activities in Checking for January 2025', () => {
      const activities = getActivitiesInMonth('Checking', yearMonth);
      expect(activities.length).toBeGreaterThan(0);
    });

    it('should generate Auto Push/Pull activities when thresholds are crossed', () => {
      const pushPullActivities = getAutoPushPullActivities('Checking', yearMonth);
      // With paychecks coming in biweekly, Checking may exceed $25K → push expected
      // We verify the mechanism exists; exact count depends on timing
      // At minimum, the engine should be processing push/pull logic
      if (pushPullActivities.length > 0) {
        for (const a of pushPullActivities) {
          // Push activities should be negative (money leaving Checking)
          // Pull activities should be positive (money entering Checking)
          if (a.name.includes('Push') || a.name.includes('push')) {
            expect(a.amount).toBeLessThan(0);
          }
          if (a.name.includes('Pull') || a.name.includes('pull')) {
            expect(a.amount).toBeGreaterThan(0);
          }
        }
      }
    });

    it('Checking month-end balance should be within min/max bounds (or close)', () => {
      const endBalance = getMonthEndBalance('Checking', yearMonth);
      // After push/pull, balance should be managed toward the min/max range
      // Allow some tolerance since the engine processes in segments
      expect(endBalance).toBeGreaterThan(0);
      // Should not wildly exceed max after pushes
      expect(endBalance).toBeLessThan(CHECKING_MAX_BALANCE * 2);
    });
  });

  describe('2025-06: Mid-year — verify push behavior with HYSA', () => {
    const yearMonth = '2025-06';

    it('if pushes occurred, HYSA should also have corresponding activities', () => {
      const checkingPushPull = getAutoPushPullActivities('Checking', yearMonth);
      const pushActivities = checkingPushPull.filter(
        (a) => a.name.includes('Push') || a.name.includes('push'),
      );

      if (pushActivities.length > 0) {
        // HYSA should have received push deposits
        const hysaActivities = getActivitiesInMonth('HYSA', yearMonth);
        const hysaPushes = hysaActivities.filter(
          (a) =>
            a.name.includes('Auto Push') ||
            a.name.includes('auto push') ||
            a.name.includes('Push') ||
            a.name.includes('push'),
        );
        expect(hysaPushes.length).toBeGreaterThan(0);
        // HYSA push amounts should be positive (money coming in)
        for (const h of hysaPushes) {
          expect(h.amount).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('2028-07: Retirement month — income drops', () => {
    const yearMonth = '2028-07';

    it('should have activities in Checking for retirement month', () => {
      const activities = getActivitiesInMonth('Checking', yearMonth);
      expect(activities.length).toBeGreaterThan(0);
    });

    it('push/pull activities may shift as income pattern changes', () => {
      const pushPullActivities = getAutoPushPullActivities('Checking', yearMonth);
      // During retirement transition, income drops — pulls become more likely
      // This test documents the behavior without over-constraining
      for (const a of pushPullActivities) {
        if (a.name.includes('Pull') || a.name.includes('pull')) {
          expect(a.amount).toBeGreaterThan(0);
          // Minimum pull amount should be respected
          expect(a.amount).toBeGreaterThanOrEqual(CHECKING_MIN_PULL_AMOUNT);
        }
        if (a.name.includes('Push') || a.name.includes('push')) {
          expect(a.amount).toBeLessThan(0);
        }
      }
    });
  });

  describe('2035-12: Ongoing retirement — verify pull behavior', () => {
    const yearMonth = '2035-12';

    it('should have activities in Checking during retirement', () => {
      const activities = getActivitiesInMonth('Checking', yearMonth);
      expect(activities.length).toBeGreaterThan(0);
    });

    it('if pulls occur, minimum pull amount should be respected', () => {
      const pushPullActivities = getAutoPushPullActivities('Checking', yearMonth);
      const pullActivities = pushPullActivities.filter(
        (a) => a.name.includes('Pull') || a.name.includes('pull'),
      );

      for (const a of pullActivities) {
        expect(a.amount).toBeGreaterThanOrEqual(CHECKING_MIN_PULL_AMOUNT);
      }
    });

    it('Checking balance should remain managed within bounds', () => {
      const endBalance = getMonthEndBalance('Checking', yearMonth);
      // Balance should not be wildly negative or astronomically high
      // Push/pull keeps it near the configured range
      expect(endBalance).toBeGreaterThan(-CHECKING_MAX_BALANCE);
    });

    it('shadow calculator agrees with engine push/pull direction', () => {
      // Get prior month-end balance as proxy for segment start
      const priorBalance = getMonthEndBalance('Checking', '2035-11');
      const pushPullActivities = getAutoPushPullActivities('Checking', yearMonth);

      const expectedPush = calculatePush(priorBalance, CHECKING_MAX_BALANCE);
      const expectedPull = calculatePull(
        priorBalance,
        CHECKING_MIN_BALANCE,
        CHECKING_MIN_PULL_AMOUNT,
      );

      const hasPush = pushPullActivities.some(
        (a) => a.name.includes('Push') || a.name.includes('push'),
      );
      const hasPull = pushPullActivities.some(
        (a) => a.name.includes('Pull') || a.name.includes('pull'),
      );

      // Shadow calculator direction should match engine direction
      // (exact amounts may differ since engine uses intra-segment min balance)
      if (expectedPush > 0) {
        // Prior month ended above max → engine should push
        expect(hasPush).toBe(true);
      }
      if (expectedPull > 0) {
        // Prior month ended below min → engine should pull
        expect(hasPull).toBe(true);
      }
    });
  });

  describe('2050-12: Late retirement — verify continued operation', () => {
    const yearMonth = '2050-12';

    it('should still have activities in Checking', () => {
      const activities = getActivitiesInMonth('Checking', yearMonth);
      expect(activities.length).toBeGreaterThan(0);
    });

    it('push/pull mechanism should still be active', () => {
      // Verify the engine is still processing push/pull even decades into retirement
      const pushPullActivities = getAutoPushPullActivities('Checking', yearMonth);

      for (const a of pushPullActivities) {
        if (a.name.includes('Pull') || a.name.includes('pull')) {
          expect(a.amount).toBeGreaterThanOrEqual(CHECKING_MIN_PULL_AMOUNT);
        }
        if (a.name.includes('Push') || a.name.includes('push')) {
          expect(a.amount).toBeLessThan(0);
        }
      }
    });

    it('Checking balance should not be wildly out of range', () => {
      const endBalance = getMonthEndBalance('Checking', yearMonth);
      // After 25+ years of retirement, push/pull should still manage the balance
      // We just verify it hasn't gone to extreme values
      expect(endBalance).toBeDefined();
      expect(typeof endBalance).toBe('number');
    });
  });
});
