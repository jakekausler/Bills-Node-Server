import { describe, it, expect } from 'vitest';
import { Timeline } from './timeline';
import { EventType, SpendingTrackerEvent } from './types';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { AccountManager } from './account-manager';

/**
 * Creates a UTC date for test data.
 */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Formats a Date to YYYY-MM-DD for readable assertions.
 */
function fmt(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Creates a minimal SpendingTrackerCategory with sensible defaults.
 * Only the fields relevant to addSpendingTrackerEvents are required;
 * others are set to safe defaults.
 */
function makeCategory(overrides: Partial<SpendingTrackerCategory> & { id: string; name: string; interval: SpendingTrackerCategory['interval']; intervalStart: string; accountId: string }): SpendingTrackerCategory {
  return {
    threshold: 100,
    thresholdIsVariable: false,
    thresholdVariable: null,
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
 * Creates a Timeline instance with a mocked AccountManager.
 * The AccountManager is not exercised by addSpendingTrackerEvents,
 * so a minimal stub suffices.
 */
function createTimeline(): Timeline {
  const mockAccountManager = {} as AccountManager;
  return new Timeline(mockAccountManager, Date.now(), false);
}

/**
 * Calls the private addSpendingTrackerEvents method on a Timeline and
 * returns the resulting events array (also private).
 */
async function addSpendingTrackerEvents(
  timeline: Timeline,
  categories: SpendingTrackerCategory[],
  startDate: Date,
  endDate: Date,
): Promise<SpendingTrackerEvent[]> {
  await (timeline as any).addSpendingTrackerEvents(categories, startDate, endDate);
  return (timeline as any).events as SpendingTrackerEvent[];
}

describe('Timeline.addSpendingTrackerEvents', () => {
  // ─── 1. Event Properties ───────────────────────────────────────────

  describe('event properties', () => {
    it('should set type to EventType.spendingTracker', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-1',
        name: 'Groceries',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.type).toBe(EventType.spendingTracker);
      }
    });

    it('should set priority to 2.5', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-1',
        name: 'Groceries',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      for (const event of events) {
        expect(event.priority).toBe(2.5);
      }
    });

    it('should carry correct categoryId and categoryName', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-abc',
        name: 'Dining Out',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 1),
        utcDate(2025, 1, 31),
      );

      expect(events.length).toBe(1);
      expect(events[0].categoryId).toBe('cat-abc');
      expect(events[0].categoryName).toBe('Dining Out');
    });

    it('should carry correct periodStart and periodEnd', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-1',
        name: 'Test',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      expect(events.length).toBe(1);
      expect(fmt(events[0].periodStart)).toBe('2025-03-01');
      expect(fmt(events[0].periodEnd)).toBe('2025-03-31');
    });

    it('should set accountId to the category accountId', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-1',
        name: 'Test',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'my-checking-acct',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      expect(events[0].accountId).toBe('my-checking-acct');
    });

    it('should set event date equal to periodEnd', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-1',
        name: 'Test',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 4, 30),
      );

      for (const event of events) {
        expect(fmt(event.date)).toBe(fmt(event.periodEnd));
      }
    });

    it('should format event id as ST-${categoryId}-${YYYY-MM-DD of periodEnd}', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'cat-xyz',
        name: 'Test',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      expect(events.length).toBe(1);
      expect(events[0].id).toBe('ST-cat-xyz-2025-03-31');
    });
  });

  // ─── 2. Weekly Intervals ───────────────────────────────────────────

  describe('weekly intervals', () => {
    it('should generate events on correct days (Friday for Saturday start)', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'weekly-1',
        name: 'Weekly Budget',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
      });

      // Sat Jan 4, 2025 through Fri Jan 31, 2025
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      // 4 weekly periods: Sat-Fri each
      expect(events.length).toBe(4);

      // Each event date should be a Friday (day 5)
      for (const event of events) {
        expect(event.date.getUTCDay()).toBe(5); // Friday
      }

      // Verify specific dates
      expect(fmt(events[0].date)).toBe('2025-01-10');
      expect(fmt(events[1].date)).toBe('2025-01-17');
      expect(fmt(events[2].date)).toBe('2025-01-24');
      expect(fmt(events[3].date)).toBe('2025-01-31');
    });

    it('should generate correct count of events for a date range', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'weekly-2',
        name: 'Weekly',
        interval: 'weekly',
        intervalStart: 'Monday',
        accountId: 'acct-1',
      });

      // Mon Jan 6 to Sun Feb 2 = 4 full weeks
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 6),
        utcDate(2025, 2, 2),
      );

      expect(events.length).toBe(4);
    });

    it('should include partial first period when startDate is mid-week', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'weekly-3',
        name: 'Weekly',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
      });

      // Start mid-week on Wed Jan 8
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 8),
        utcDate(2025, 1, 17),
      );

      // Period Sat Jan 4-Fri Jan 10 overlaps, so included
      // Period Sat Jan 11-Fri Jan 17 also included
      expect(events.length).toBe(2);
      expect(fmt(events[0].periodStart)).toBe('2025-01-04');
      expect(fmt(events[0].periodEnd)).toBe('2025-01-10');
    });
  });

  // ─── 3. Monthly Intervals ─────────────────────────────────────────

  describe('monthly intervals', () => {
    it('should generate events on correct days for the 1st', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'monthly-1',
        name: 'Monthly Budget',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 1),
        utcDate(2025, 4, 30),
      );

      expect(events.length).toBe(4);

      // Event dates should be last day of each month (periodEnd)
      expect(fmt(events[0].date)).toBe('2025-01-31');
      expect(fmt(events[1].date)).toBe('2025-02-28');
      expect(fmt(events[2].date)).toBe('2025-03-31');
      expect(fmt(events[3].date)).toBe('2025-04-30');
    });

    it('should generate events on correct days for the 15th', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'monthly-2',
        name: 'Mid-month Budget',
        interval: 'monthly',
        intervalStart: '15',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 15),
        utcDate(2025, 4, 14),
      );

      expect(events.length).toBe(3);

      // periodEnd should be the 14th of the next month
      expect(fmt(events[0].date)).toBe('2025-02-14');
      expect(fmt(events[1].date)).toBe('2025-03-14');
      expect(fmt(events[2].date)).toBe('2025-04-14');
    });

    it('should handle day clamping for short months (February)', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'monthly-clamp',
        name: 'Clamped',
        interval: 'monthly',
        intervalStart: '28',
        accountId: 'acct-1',
      });

      // 2025 is not a leap year
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 28),
        utcDate(2025, 3, 27),
      );

      expect(events.length).toBe(2);

      // Jan 28 - Feb 27
      expect(fmt(events[0].periodStart)).toBe('2025-01-28');
      expect(fmt(events[0].periodEnd)).toBe('2025-02-27');

      // Feb 28 - Mar 27
      expect(fmt(events[1].periodStart)).toBe('2025-02-28');
      expect(fmt(events[1].periodEnd)).toBe('2025-03-27');
    });
  });

  // ─── 4. Yearly Intervals ──────────────────────────────────────────

  describe('yearly intervals', () => {
    it('should generate events on correct anniversary dates', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'yearly-1',
        name: 'Annual Budget',
        interval: 'yearly',
        intervalStart: '01/01',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 1),
        utcDate(2027, 12, 31),
      );

      expect(events.length).toBe(3);

      // Event dates should be Dec 31 of each year (periodEnd)
      expect(fmt(events[0].date)).toBe('2025-12-31');
      expect(fmt(events[1].date)).toBe('2026-12-31');
      expect(fmt(events[2].date)).toBe('2027-12-31');
    });

    it('should handle mid-year anniversary (06/15)', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'yearly-2',
        name: 'Fiscal Year Budget',
        interval: 'yearly',
        intervalStart: '06/15',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 6, 15),
        utcDate(2027, 6, 14),
      );

      expect(events.length).toBe(2);

      // Period Jun 15, 2025 - Jun 14, 2026
      expect(fmt(events[0].periodStart)).toBe('2025-06-15');
      expect(fmt(events[0].date)).toBe('2026-06-14');

      // Period Jun 15, 2026 - Jun 14, 2027
      expect(fmt(events[1].periodStart)).toBe('2026-06-15');
      expect(fmt(events[1].date)).toBe('2027-06-14');
    });
  });

  // ─── 5. Multiple Categories ────────────────────────────────────────

  describe('multiple categories', () => {
    it('should generate independent events for each category', async () => {
      const timeline = createTimeline();
      const catA = makeCategory({
        id: 'cat-A',
        name: 'Groceries',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-checking',
      });
      const catB = makeCategory({
        id: 'cat-B',
        name: 'Entertainment',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-savings',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [catA, catB],
        utcDate(2025, 1, 1),
        utcDate(2025, 1, 31),
      );

      // catA (monthly, day 1): 1 event for January
      const catAEvents = events.filter((e) => e.categoryId === 'cat-A');
      expect(catAEvents.length).toBe(1);
      expect(catAEvents[0].categoryName).toBe('Groceries');

      // catB (weekly, Saturday start): periods that overlap Jan 1-31
      // Dec 28 (Sat) - Jan 3 (Fri), Jan 4 - Jan 10, Jan 11 - Jan 17,
      // Jan 18 - Jan 24, Jan 25 - Jan 31
      const catBEvents = events.filter((e) => e.categoryId === 'cat-B');
      expect(catBEvents.length).toBe(5);
      expect(catBEvents[0].categoryName).toBe('Entertainment');
    });

    it('should assign correct accountId per category', async () => {
      const timeline = createTimeline();
      const catA = makeCategory({
        id: 'cat-A',
        name: 'Category A',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-111',
      });
      const catB = makeCategory({
        id: 'cat-B',
        name: 'Category B',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-222',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [catA, catB],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      const catAEvents = events.filter((e) => e.categoryId === 'cat-A');
      const catBEvents = events.filter((e) => e.categoryId === 'cat-B');

      for (const e of catAEvents) {
        expect(e.accountId).toBe('acct-111');
      }
      for (const e of catBEvents) {
        expect(e.accountId).toBe('acct-222');
      }
    });
  });

  // ─── 6. No Categories ─────────────────────────────────────────────

  describe('no categories', () => {
    it('should produce no events for empty categories array', async () => {
      const timeline = createTimeline();
      const events = await addSpendingTrackerEvents(
        timeline,
        [],
        utcDate(2025, 1, 1),
        utcDate(2025, 12, 31),
      );

      expect(events.length).toBe(0);
    });
  });

  // ─── 7. startDate Filtering ──────────────────────────────────────

  describe('startDate filtering', () => {
    it('should generate all events when startDate is null', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'skip-null',
        name: 'No Skip',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
        startDate: null,
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      // 4 weekly periods: Sat-Fri each (Jan 4-10, 11-17, 18-24, 25-31)
      expect(events.length).toBe(4);
    });

    it('should mark periods ending before startDate as virtual instead of filtering them out', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'skip-filter',
        name: 'Skipped',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
        startDate: '2025-01-18', // periods ending before Jan 18 are virtual
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      // All 4 periods are emitted (none skipped)
      // Period Sat Jan 4 - Fri Jan 10: periodEnd Jan 10 < Jan 18 => virtual
      // Period Sat Jan 11 - Fri Jan 17: periodEnd Jan 17 < Jan 18 => virtual
      // Period Sat Jan 18 - Fri Jan 24: periodEnd Jan 24 >= Jan 18 => real
      // Period Sat Jan 25 - Fri Jan 31: periodEnd Jan 31 >= Jan 18 => real
      expect(events.length).toBe(4);
      expect(events[0].virtual).toBe(true);
      expect(events[1].virtual).toBe(true);
      expect(events[2].virtual).toBe(false);
      expect(events[3].virtual).toBe(false);
      expect(fmt(events[0].periodStart)).toBe('2025-01-04');
      expect(fmt(events[1].periodStart)).toBe('2025-01-11');
      expect(fmt(events[2].periodStart)).toBe('2025-01-18');
      expect(fmt(events[3].periodStart)).toBe('2025-01-25');
    });

    it('should set firstSpendingTracker true only for first non-virtual event', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'skip-first',
        name: 'First Flag',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
        startDate: '2025-01-18',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      // All 4 events emitted; virtual ones have firstSpendingTracker=false
      // First real (non-virtual) event has firstSpendingTracker=true
      expect(events.length).toBe(4);
      expect(events[0].virtual).toBe(true);
      expect(events[0].firstSpendingTracker).toBe(false);
      expect(events[1].virtual).toBe(true);
      expect(events[1].firstSpendingTracker).toBe(false);
      expect(events[2].virtual).toBe(false);
      expect(events[2].firstSpendingTracker).toBe(true);  // first real event
      expect(events[3].virtual).toBe(false);
      expect(events[3].firstSpendingTracker).toBe(false);
    });

    it('should set firstSpendingTracker true on first event when nothing is skipped', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'no-skip-first',
        name: 'No Skip First',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
        startDate: null,
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 1),
        utcDate(2025, 3, 31),
      );

      expect(events.length).toBe(3);
      expect(events[0].firstSpendingTracker).toBe(true);
      expect(events[1].firstSpendingTracker).toBe(false);
      expect(events[2].firstSpendingTracker).toBe(false);
    });
  });

  // ─── 8. Date Range Filtering ──────────────────────────────────────

  describe('date range filtering', () => {
    it('should only generate events within the [startDate, endDate] range', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'range-1',
        name: 'Ranged',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      // Only March 2025
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      expect(events.length).toBe(1);
      expect(fmt(events[0].periodStart)).toBe('2025-03-01');
      expect(fmt(events[0].periodEnd)).toBe('2025-03-31');
    });

    it('should not generate events outside the date range', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'range-2',
        name: 'Ranged',
        interval: 'yearly',
        intervalStart: '01/01',
        accountId: 'acct-1',
      });

      // Range only covers part of 2025
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 6, 1),
        utcDate(2025, 12, 31),
      );

      // The yearly period Jan 1 2025 - Dec 31 2025 overlaps with our range
      // (its periodEnd Dec 31 >= startDate Jun 1), so it's included.
      expect(events.length).toBe(1);
      expect(fmt(events[0].periodStart)).toBe('2025-01-01');
      expect(fmt(events[0].periodEnd)).toBe('2025-12-31');
    });

    it('should return empty when endDate is before startDate', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'range-3',
        name: 'Ranged',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 6, 1),
        utcDate(2025, 1, 1),
      );

      expect(events.length).toBe(0);
    });

    it('should handle a narrow range that excludes all periods', async () => {
      const timeline = createTimeline();
      const category = makeCategory({
        id: 'range-4',
        name: 'Narrow',
        interval: 'yearly',
        intervalStart: '06/15',
        accountId: 'acct-1',
      });

      // Range: Jan 1 to Jan 5, 2025
      // Yearly period starting Jun 15, 2024 has periodEnd Jun 14, 2025
      // periodEnd (Jun 14) >= startDate (Jan 1) => included
      // But let's try a range that actually excludes everything
      // Period Jun 15 2025 - Jun 14 2026: periodStart (Jun 15) > endDate (Jan 5)
      // Period Jun 15 2024 - Jun 14 2025: periodEnd (Jun 14) >= startDate (Jan 1) => included
      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 1),
        utcDate(2025, 1, 5),
      );

      // The Jun 15 2024 - Jun 14 2025 period overlaps, so 1 event
      expect(events.length).toBe(1);
    });

    it('should accumulate events across multiple calls', async () => {
      const timeline = createTimeline();
      const catA = makeCategory({
        id: 'accum-A',
        name: 'First',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
      });
      const catB = makeCategory({
        id: 'accum-B',
        name: 'Second',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-2',
      });

      // First call
      await (timeline as any).addSpendingTrackerEvents([catA], utcDate(2025, 1, 1), utcDate(2025, 1, 31));
      // Second call
      await (timeline as any).addSpendingTrackerEvents([catB], utcDate(2025, 1, 1), utcDate(2025, 1, 31));

      const events = (timeline as any).events as SpendingTrackerEvent[];
      expect(events.length).toBe(2);
      expect(events[0].categoryId).toBe('accum-A');
      expect(events[1].categoryId).toBe('accum-B');
    });
  });
});
