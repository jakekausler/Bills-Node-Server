import { describe, it, expect, vi, beforeEach } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { ActivityData } from '../../data/activity/types';

dayjs.extend(utc);

let activityCounter = 0;

// Mock the variable resolution functions to avoid filesystem access.
// The mock passes through raw values (no variable lookup), which is
// correct for tests where all isVariable flags are false.
vi.mock('../simulation/loadVariableValue', () => ({
  loadNumberOrVariable: vi.fn(
    (amount: number, isVariable: boolean, variable: string | null, _simulation: string) => ({
      amount: amount,
      amountIsVariable: isVariable,
      amountVariable: variable,
    }),
  ),
  loadDateOrVariable: vi.fn(
    (date: string, isVariable: boolean, variable: string | null, _simulation: string) => ({
      date: new Date(date + 'T12:00:00Z'),
      dateIsVariable: isVariable,
      dateVariable: variable,
    }),
  ),
}));

import { SpendingTrackerManager } from './spending-tracker-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a SpendingTrackerCategory with sensible defaults */
function makeCategory(overrides: Partial<SpendingTrackerCategory> = {}): SpendingTrackerCategory {
  return {
    id: 'test-cat-1',
    name: 'Test Category',
    threshold: 150,
    thresholdIsVariable: false,
    thresholdVariable: null,
    interval: 'weekly',
    intervalStart: 'Saturday',
    accountId: 'account-1',
    carryOver: false,
    carryUnder: false,
    increaseBy: 0,
    increaseByIsVariable: false,
    increaseByVariable: null,
    increaseByDate: '01/01',
    thresholdChanges: [],
    startDate: null,
    ...overrides,
  };
}

/**
 * Build a ConsolidatedActivity with only the fields computeChartData accesses:
 * spendingCategory, amount, and date.
 */
function makeActivity(
  date: string,
  amount: number,
  spendingCategory: string | null,
): ConsolidatedActivity {
  const activityData: ActivityData = {
    id: `act-${++activityCounter}`,
    date: date as any,
    dateIsVariable: false,
    dateVariable: null,
    name: 'Test Activity',
    category: 'general',
    amount: amount,
    amountIsVariable: false,
    amountVariable: null,
    flag: false,
    flagColor: null,
    isTransfer: false,
    from: null,
    to: null,
    spendingCategory: spendingCategory,
  };
  return new ConsolidatedActivity(activityData);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpendingTrackerManager.computeChartData', () => {
  const simulation = 'test-sim';

  beforeEach(() => { activityCounter = 0; });

  // Common date ranges for weekly tests (Saturday-based weeks).
  // intervalStart: 'Saturday' means periods start on Saturday.
  // 2025-01-04 is a Saturday.
  //
  // For a date range 2025-01-04 to 2025-01-31:
  //   Period 1: Sat 2025-01-04 to Fri 2025-01-10
  //   Period 2: Sat 2025-01-11 to Fri 2025-01-17
  //   Period 3: Sat 2025-01-18 to Fri 2025-01-24
  //   Period 4: Sat 2025-01-25 to Fri 2025-01-31

  // -----------------------------------------------------------------------
  // 1. Correct number of periods
  // -----------------------------------------------------------------------
  describe('Correct number of periods', () => {
    it('returns correct number of weekly periods for a 4-week range', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(4);
    });

    it('returns correct number of monthly periods', () => {
      const category = makeCategory({
        interval: 'monthly',
        intervalStart: '1',
      });

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-01', endDate: '2025-03-31' },
        '2025-01-01',
        simulation,
      );

      // Jan 1 - Jan 31, Feb 1 - Feb 28, Mar 1 - Mar 31
      expect(result.periods).toHaveLength(3);
    });

    it('returns empty periods array for degenerate date range', () => {
      const category = makeCategory();

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-02-01', endDate: '2025-01-01' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(0);
      expect(result.nextPeriodThreshold).toBe(0);
      expect(result.cumulativeSpent).toBe(0);
      expect(result.cumulativeThreshold).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Period spending totals
  // -----------------------------------------------------------------------
  describe('Period spending totals', () => {
    it('computes totalSpent as negated sum of activity amounts (expenses increase spending)', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // Activities in first period (Sat Jan 4 - Fri Jan 10)
      const activities = [
        makeActivity('2025-01-05', -50, 'test-cat-1'), // expense: totalSpent += 50
        makeActivity('2025-01-06', -30, 'test-cat-1'), // expense: totalSpent += 30
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(1);
      expect(result.periods[0].totalSpent).toBe(80);
    });

    it('activities in different periods are attributed to correct periods', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -50, 'test-cat-1'),  // Period 1
        makeActivity('2025-01-12', -30, 'test-cat-1'),  // Period 2
        makeActivity('2025-01-20', -20, 'test-cat-1'),  // Period 3
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(4);
      expect(result.periods[0].totalSpent).toBe(50);
      expect(result.periods[1].totalSpent).toBe(30);
      expect(result.periods[2].totalSpent).toBe(20);
      expect(result.periods[3].totalSpent).toBe(0); // No activities in period 4
    });
  });

  // -----------------------------------------------------------------------
  // 3. Carry logic - underspend with carryOver ON
  // -----------------------------------------------------------------------
  describe('Carry logic - underspend with carryOver ON', () => {
    it('threshold $150, spend $100, carryOver=true => next period effective threshold = $200', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: false,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // Period 1 (Jan 4-10): spend $100
      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-17' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(2);

      // Period 1: spent 100, base 150, carry starts at 0
      expect(result.periods[0].totalSpent).toBe(100);
      expect(result.periods[0].baseThreshold).toBe(150);
      expect(result.periods[0].effectiveThreshold).toBe(150); // no carry yet
      expect(result.periods[0].remainder).toBe(50); // 150 - 100
      // newCarry = 150 - 100 = 50 (carryOver ON, positive carry stays)
      expect(result.periods[0].carryAfter).toBe(50);

      // Period 2: no spending, effective = 150 + 50 = 200
      expect(result.periods[1].totalSpent).toBe(0);
      expect(result.periods[1].effectiveThreshold).toBe(200);
      expect(result.periods[1].remainder).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Carry logic - overspend with carryUnder ON
  // -----------------------------------------------------------------------
  describe('Carry logic - overspend with carryUnder ON', () => {
    it('threshold $150, spend $500, carryUnder=true => next period effective threshold = $0', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: false,
        carryUnder: true,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -500, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-17' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(2);

      // Period 1: newCarry = 150 - 500 = -350 (negative, carryUnder ON so it stays)
      expect(result.periods[0].totalSpent).toBe(500);
      expect(result.periods[0].carryAfter).toBe(-350);

      // Period 2: effective = max(0, 150 + (-350)) = 0
      expect(result.periods[1].effectiveThreshold).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Carry logic - both OFF
  // -----------------------------------------------------------------------
  describe('Carry logic - both carry flags OFF', () => {
    it('threshold $150, underspend and overspend, both OFF => every period uses base threshold', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: false,
        carryUnder: false,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),  // Period 1: underspend
        makeActivity('2025-01-12', -200, 'test-cat-1'),  // Period 2: overspend
        makeActivity('2025-01-19', -50, 'test-cat-1'),   // Period 3: underspend
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(4);

      // Every period should have effectiveThreshold = 150 (no carry)
      for (const period of result.periods) {
        expect(period.effectiveThreshold).toBe(150);
        expect(period.carryAfter).toBe(0);
      }

      expect(result.periods[0].totalSpent).toBe(100);
      expect(result.periods[1].totalSpent).toBe(200);
      expect(result.periods[2].totalSpent).toBe(50);
      expect(result.periods[3].totalSpent).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Carry logic - both ON
  // -----------------------------------------------------------------------
  describe('Carry logic - both carry flags ON', () => {
    it('combined carry model with mixed spend/underspend periods', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: true,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),  // Period 1: spend 100, underspend 50
        makeActivity('2025-01-12', -250, 'test-cat-1'),  // Period 2: spend 250, overspend
        makeActivity('2025-01-19', -0, 'test-cat-1'),    // Period 3: spend 0 (zero amount skipped)
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(4);

      // Period 1: carry(start)=0, effective=150, spent=100
      //   newCarry = 150 - 100 = +50 (carryOver ON, stays)
      expect(result.periods[0].effectiveThreshold).toBe(150);
      expect(result.periods[0].totalSpent).toBe(100);
      expect(result.periods[0].carryAfter).toBe(50);

      // Period 2: carry(start)=50, effective=max(0,150+50)=200, spent=250
      //   newCarry = 150 - 250 = -100 (carryUnder ON, stays)
      expect(result.periods[1].effectiveThreshold).toBe(200);
      expect(result.periods[1].totalSpent).toBe(250);
      expect(result.periods[1].carryAfter).toBe(-100);

      // Period 3: carry(start)=-100, effective=max(0,150-100)=50, spent=0
      //   newCarry = 150 - 0 = +150 (carryOver ON, stays)
      expect(result.periods[2].effectiveThreshold).toBe(50);
      expect(result.periods[2].totalSpent).toBe(0);
      expect(result.periods[2].carryAfter).toBe(150);

      // Period 4: carry(start)=150, effective=max(0,150+150)=300, spent=0
      //   newCarry = 150 - 0 = +150 (carryOver ON, stays)
      expect(result.periods[3].effectiveThreshold).toBe(300);
      expect(result.periods[3].totalSpent).toBe(0);
      expect(result.periods[3].carryAfter).toBe(150);
    });
  });

  // -----------------------------------------------------------------------
  // 7. isCurrent flag
  // -----------------------------------------------------------------------
  describe('isCurrent flag', () => {
    it('the period containing today has isCurrent: true', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-02-15T12:00:00Z'));
      try {
        const category = makeCategory({ interval: 'monthly', intervalStart: '1' });
        const result = SpendingTrackerManager.computeChartData(
          category, [],
          { startDate: '2025-01-01', endDate: '2025-03-31' },
          '2025-01-01', simulation,
        );
        const currentPeriods = result.periods.filter(p => p.isCurrent);
        expect(currentPeriods).toHaveLength(1);
        expect(currentPeriods[0].periodStart).toBe('2025-02-01');
      } finally {
        vi.useRealTimers();
      }
    });

    it('periods not containing today have isCurrent: false', () => {
      // Use a far-past date range that doesn't include today
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2020-01-04', endDate: '2020-01-31' },
        '2020-01-01',
        simulation,
      );

      for (const period of result.periods) {
        expect(period.isCurrent).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 8. nextPeriodThreshold
  // -----------------------------------------------------------------------
  describe('nextPeriodThreshold', () => {
    it('reflects carry state after last period', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: false,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // Period 1: spend 100, newCarry = 150-100 = +50 (carryOver ON)
      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(1);
      expect(result.periods[0].carryAfter).toBe(50);

      // nextPeriodThreshold = max(0, 150 + 50) = 200
      expect(result.nextPeriodThreshold).toBe(200);
    });

    it('nextPeriodThreshold is 0 when effective goes below 0 (clamped)', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: false,
        carryUnder: true,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // Massive overspend: newCarry = 150-1000 = -850 (carryUnder ON)
      const activities = [
        makeActivity('2025-01-05', -1000, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      // next effective = max(0, 150 + (-850)) = 0
      expect(result.nextPeriodThreshold).toBe(0);
    });

    it('nextPeriodThreshold equals base threshold when both carry flags are OFF', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: false,
        carryUnder: false,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      // carry is zeroed because both flags OFF => nextPeriodThreshold = max(0, 150 + 0) = 150
      expect(result.nextPeriodThreshold).toBe(150);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Cumulative totals
  // -----------------------------------------------------------------------
  describe('Cumulative totals', () => {
    it('cumulativeSpent is sum of all period totalSpent values', () => {
      const category = makeCategory({
        threshold: 150,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -50, 'test-cat-1'),  // Period 1
        makeActivity('2025-01-12', -30, 'test-cat-1'),  // Period 2
        makeActivity('2025-01-19', -20, 'test-cat-1'),  // Period 3
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      expect(result.cumulativeSpent).toBe(50 + 30 + 20);
    });

    it('cumulativeThreshold is sum of all period effectiveThreshold values', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: false,
        carryUnder: false,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      // 4 periods, each with effectiveThreshold 150 (no carry)
      expect(result.periods).toHaveLength(4);
      expect(result.cumulativeThreshold).toBe(150 * 4);
    });

    it('cumulativeThreshold accounts for carry adjustments', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: false,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // Period 1: spend 100, newCarry = 150-100 = +50 (carryOver ON)
      // Period 2: effective = 200, spend 0, newCarry = 150-0 = +150 (carryOver ON)
      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-17' },
        '2025-01-01',
        simulation,
      );

      // Period 1: effective = 150 (carry starts at 0)
      // Period 2: effective = 200 (carry = 50)
      expect(result.cumulativeThreshold).toBe(150 + 200);
    });

    it('cumulative totals are zero when no periods exist', () => {
      const category = makeCategory();

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-02-01', endDate: '2025-01-01' },
        '2025-01-01',
        simulation,
      );

      expect(result.cumulativeSpent).toBe(0);
      expect(result.cumulativeThreshold).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Empty category (no activities)
  // -----------------------------------------------------------------------
  describe('Empty category (no activities)', () => {
    it('zero-spending periods with full threshold', () => {
      const category = makeCategory({
        threshold: 200,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-04', endDate: '2025-01-17' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(2);
      for (const period of result.periods) {
        expect(period.totalSpent).toBe(0);
        expect(period.baseThreshold).toBe(200);
        expect(period.effectiveThreshold).toBe(200);
        expect(period.remainder).toBe(200);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 11. Remainder bills excluded (spendingCategory exact match)
  // -----------------------------------------------------------------------
  describe('Remainder bills excluded (exact category match)', () => {
    it('activities with spendingCategory: null are excluded from spending totals', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -50, 'test-cat-1'),  // Matches => counted
        makeActivity('2025-01-06', -100, null),          // Remainder bill => excluded
        makeActivity('2025-01-07', -30, 'test-cat-1'),  // Matches => counted
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods[0].totalSpent).toBe(80); // 50 + 30, not 180
    });

    it('activities with a different spendingCategory are excluded', () => {
      const category = makeCategory({
        id: 'cat-A',
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -50, 'cat-A'),       // Matches => counted
        makeActivity('2025-01-06', -100, 'cat-B'),      // Different category => excluded
        makeActivity('2025-01-07', -30, 'cat-A'),       // Matches => counted
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods[0].totalSpent).toBe(80);
    });

    it('activities with empty string spendingCategory are excluded (strict equality)', () => {
      const category = makeCategory({
        id: 'test-cat-1',
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // An activity whose spendingCategory is '' (empty string) is NOT === 'test-cat-1'
      const activities = [
        makeActivity('2025-01-05', -50, 'test-cat-1'),
        makeActivity('2025-01-06', -100, ''),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods[0].totalSpent).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Refunds reduce spending
  // -----------------------------------------------------------------------
  describe('Refunds reduce spending', () => {
    it('positive amounts with matching category reduce the spending total', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),  // Expense: +100
        makeActivity('2025-01-06', 25, 'test-cat-1'),    // Refund: -25
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      // totalSpent = -(-100) + -(25) = 100 - 25 = 75
      expect(result.periods[0].totalSpent).toBe(75);
    });

    it('net refund produces negative totalSpent', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -20, 'test-cat-1'),  // Expense: +20
        makeActivity('2025-01-06', 50, 'test-cat-1'),   // Refund: -50
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      // totalSpent = 20 - 50 = -30
      expect(result.periods[0].totalSpent).toBe(-30);
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge case tests
  // -----------------------------------------------------------------------
  describe('Period date boundaries', () => {
    it('activities exactly on period boundaries are included in correct period', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // 2025-01-04 is Saturday (start of period 1)
      // 2025-01-10 is Friday (end of period 1)
      // 2025-01-11 is Saturday (start of period 2)
      const activities = [
        makeActivity('2025-01-04', -10, 'test-cat-1'),  // Period 1 start boundary
        makeActivity('2025-01-10', -20, 'test-cat-1'),  // Period 1 end boundary
        makeActivity('2025-01-11', -30, 'test-cat-1'),  // Period 2 start boundary
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-17' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(2);
      expect(result.periods[0].totalSpent).toBe(30);  // 10 + 20
      expect(result.periods[1].totalSpent).toBe(30);
    });
  });

  describe('Remainder and threshold consistency', () => {
    it('remainder = max(0, effectiveThreshold - totalSpent) for each period', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: true,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', -100, 'test-cat-1'),  // Period 1
        makeActivity('2025-01-12', -300, 'test-cat-1'),  // Period 2 (overspend)
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-24' },
        '2025-01-01',
        simulation,
      );

      for (const period of result.periods) {
        const expectedRemainder = Math.max(0, period.effectiveThreshold - period.totalSpent);
        expect(period.remainder).toBe(expectedRemainder);
      }
    });
  });

  describe('Zero-amount activities are skipped', () => {
    it('activities with amount 0 do not affect spending', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const activities = [
        makeActivity('2025-01-05', 0, 'test-cat-1'),
        makeActivity('2025-01-06', -50, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods[0].totalSpent).toBe(50);
    });
  });

  describe('Multi-period carry accumulation', () => {
    it('carryUnder ON: overspend carries for one period then resets (carryOver OFF)', () => {
      const category = makeCategory({
        threshold: 150,
        carryOver: false,
        carryUnder: true,
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      // Period 1: spend 500, newCarry = 150-500 = -350 (carryUnder ON, stays)
      // Period 2: spend 0, newCarry = 150-0 = +150 → 0 (carryOver OFF, positive zeroed)
      // Period 3: spend 0, newCarry = 150-0 = +150 → 0 (carryOver OFF, positive zeroed)
      // Period 4: spend 0, newCarry = 150-0 = +150 → 0 (carryOver OFF, positive zeroed)
      const activities = [
        makeActivity('2025-01-05', -500, 'test-cat-1'),
      ];

      const result = SpendingTrackerManager.computeChartData(
        category,
        activities,
        { startDate: '2025-01-04', endDate: '2025-01-31' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(4);

      // Period 1: effective=150 (carry starts at 0)
      expect(result.periods[0].effectiveThreshold).toBe(150);
      expect(result.periods[0].carryAfter).toBe(-350);

      // Period 2: carry=-350, effective=max(0, 150-350)=0, spend=0
      //   newCarry = 150 - 0 = +150 → 0 (carryOver OFF)
      expect(result.periods[1].effectiveThreshold).toBe(0);
      expect(result.periods[1].carryAfter).toBe(0);

      // Period 3: carry=0, effective=max(0, 150+0)=150, spend=0
      //   newCarry = 150 - 0 = +150 → 0 (carryOver OFF)
      expect(result.periods[2].effectiveThreshold).toBe(150);
      expect(result.periods[2].carryAfter).toBe(0);

      // Period 4: carry=0, effective=max(0, 150+0)=150, spend=0
      //   newCarry = 150 - 0 = +150 → 0 (carryOver OFF)
      expect(result.periods[3].effectiveThreshold).toBe(150);
      expect(result.periods[3].carryAfter).toBe(0);
    });
  });

  describe('Period format', () => {
    it('periodStart and periodEnd are YYYY-MM-DD strings', () => {
      const category = makeCategory({
        interval: 'weekly',
        intervalStart: 'Saturday',
      });

      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-04', endDate: '2025-01-10' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(1);
      expect(result.periods[0].periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.periods[0].periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // -----------------------------------------------------------------------
  // Threshold changes
  // -----------------------------------------------------------------------
  describe('threshold changes', () => {
    it('threshold change applies within chart range', () => {
      const category = makeCategory({
        threshold: 100,
        interval: 'weekly',
        intervalStart: 'Saturday',
        thresholdChanges: [
          {
            date: '2025-01-15',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 200,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
        ],
      });

      // 2025-01-04 is Saturday
      // Period 1: Sat Jan 4 - Fri Jan 10
      // Period 2: Sat Jan 11 - Fri Jan 17 (contains change on Jan 15)
      // Period 3: Sat Jan 18 - Fri Jan 24
      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-04', endDate: '2025-01-24' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(3);
      expect(result.periods[0].baseThreshold).toBe(100);
      expect(result.periods[1].baseThreshold).toBe(200);
      expect(result.periods[2].baseThreshold).toBe(200);
    });

    it('resetCarry resets carry to 0', () => {
      // Carry update runs first (carry = carry + (base - spent)), then resetCarry check
      // zeroes the carry. This matches engine ordering in updateCarry().
      const category = makeCategory({
        threshold: 150,
        carryOver: true,
        interval: 'weekly',
        intervalStart: 'Saturday',
        thresholdChanges: [
          {
            date: '2025-01-15',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 150,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: true,
          },
        ],
      });

      // No activities, so every period has totalSpent = 0
      // Period 1 (Jan 4-10): newCarry = 150 - 0 = 150 (carryOver ON, stays)
      // Period 2 (Jan 11-17): newCarry = 150 - 0 = 150 (carryOver ON, stays), then resetCarry => 0
      // Period 3 (Jan 18-24): newCarry = 150 - 0 = 150 (carryOver ON, stays)
      const result = SpendingTrackerManager.computeChartData(
        category,
        [],
        { startDate: '2025-01-04', endDate: '2025-01-24' },
        '2025-01-01',
        simulation,
      );

      expect(result.periods).toHaveLength(3);
      // Period 1: no resetCarry, carry accumulates normally
      expect(result.periods[0].carryAfter).toBe(150);
      // Period 2: newCarry = 150, then resetCarry zeroes it
      expect(result.periods[1].carryAfter).toBe(0);
      // Period 3: starts fresh from carry=0, accumulates normally
      expect(result.periods[2].carryAfter).toBe(150);
    });
  });
});
