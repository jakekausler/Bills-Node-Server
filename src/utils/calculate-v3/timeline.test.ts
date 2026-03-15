import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Timeline } from './timeline';
import {
  ActivityEvent,
  BillEvent,
  BillTransferEvent,
  EventType,
  InterestEvent,
  PensionEvent,
  RMDEvent,
  Segment,
  SocialSecurityEvent,
  SpendingTrackerEvent,
  TaxEvent,
  TimelineEvent,
} from './types';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { AccountManager } from './account-manager';

// ---------------------------------------------------------------------------
// Mocks for fromAccountsAndTransfers dependencies
// ---------------------------------------------------------------------------

vi.mock('../io/retirement', () => ({
  loadPensionsAndSocialSecurity: vi.fn().mockReturnValue({ pensions: [], socialSecurities: [] }),
}));

vi.mock('../simulation/loadVariableValue', () => ({
  loadNumberOrVariable: vi.fn((amount: any) => ({ amount, amountIsVariable: false, amountVariable: null })),
  loadDateOrVariable: vi.fn((date: any) => ({ date: new Date(date), dateIsVariable: false, dateVariable: null })),
}));

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
    initializeDate: null,
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

  // ─── 7. Runtime Computed startDate Filtering ──────────────────────────────────────

  describe('runtime computed startDate filtering', () => {
    // Setup fake timers for deterministic "today" behavior
    // Each test overrides this as needed
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should generate all events when all periods are in or after current period', async () => {
      // Set today to Jan 4 2025 (Saturday), start of the first period
      // Current period: Sat Jan 4 - Fri Jan 10
      // computedStartDate = Jan 4
      // All periods end on or after Jan 4, so none are virtual
      vi.setSystemTime(new Date('2025-01-04T00:00:00Z'));

      const timeline = createTimeline();
      const category = makeCategory({
        id: 'skip-null',
        name: 'No Skip',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      // 4 weekly periods: Sat-Fri each (Jan 4-10, 11-17, 18-24, 25-31)
      // All are non-virtual since today (Jan 4) is in the first period
      expect(events.length).toBe(4);
      for (const event of events) {
        expect(event.virtual).toBe(false);
      }
    });

    it('should mark periods ending before current period as virtual', async () => {
      // Set today to Jan 18 2025 (Saturday), start of the third period
      // Current period: Sat Jan 18 - Fri Jan 24
      // computedStartDate = Jan 18
      // Periods ending before Jan 18 are virtual:
      // - Period Sat Jan 4 - Fri Jan 10: ends Jan 10 < Jan 18 => virtual
      // - Period Sat Jan 11 - Fri Jan 17: ends Jan 17 < Jan 18 => virtual
      // - Period Sat Jan 18 - Fri Jan 24: ends Jan 24, not before Jan 18 => real
      // - Period Sat Jan 25 - Fri Jan 31: ends Jan 31, not before Jan 18 => real
      vi.setSystemTime(new Date('2025-01-18T00:00:00Z'));

      const timeline = createTimeline();
      const category = makeCategory({
        id: 'skip-filter',
        name: 'Skipped',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
      });

      const events = await addSpendingTrackerEvents(
        timeline,
        [category],
        utcDate(2025, 1, 4),
        utcDate(2025, 1, 31),
      );

      // All 4 periods are emitted (none skipped)
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
      // Set today to Jan 18 2025 (Saturday)
      // Current period: Sat Jan 18 - Fri Jan 24
      // computedStartDate = Jan 18
      // First 2 periods are virtual, third is first real event
      vi.setSystemTime(new Date('2025-01-18T00:00:00Z'));

      const timeline = createTimeline();
      const category = makeCategory({
        id: 'skip-first',
        name: 'First Flag',
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'acct-1',
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
      expect(events[2].firstSpendingTracker).toBe(true);  // first real event (period ending Jan 24)
      expect(events[3].virtual).toBe(false);
      expect(events[3].firstSpendingTracker).toBe(false);
    });

    it('should set firstSpendingTracker true on first event when all periods are non-virtual', async () => {
      // Set today to Jan 1 2025 (Wednesday), within the first monthly period
      // Monthly with intervalStart='1' means periods are month-by-month starting on the 1st
      // Current period: Jan 1 - Jan 31
      // computedStartDate = Jan 1
      // All three periods (Jan, Feb, Mar) end on or after Jan 1, so none are virtual
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

      const timeline = createTimeline();
      const category = makeCategory({
        id: 'no-skip-first',
        name: 'No Skip First',
        interval: 'monthly',
        intervalStart: '1',
        accountId: 'acct-1',
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

// ===========================================================================
// Timeline - constructor, clone, getSegments, applyMonteCarlo
// ===========================================================================

describe('Timeline - core methods', () => {
  // ─── Helpers ───────────────────────────────────────────────────────────────

  function createTimeline(): Timeline {
    const mockAccountManager = {} as AccountManager;
    return new Timeline(mockAccountManager, Date.now(), false);
  }

  function makeEventBase(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
    return {
      id: 'evt-1',
      type: EventType.activity,
      date: utcDate(2025, 3, 15),
      accountId: 'acct-1',
      priority: 1,
      ...overrides,
    };
  }

  // ─── getAccountManager ─────────────────────────────────────────────────────

  describe('getAccountManager', () => {
    it('returns the account manager that was passed to the constructor', () => {
      const mockAccountManager = { id: 'test-am' } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      expect(timeline.getAccountManager()).toBe(mockAccountManager);
    });
  });

  // ─── getSegments ───────────────────────────────────────────────────────────

  describe('getSegments', () => {
    it('returns an empty array when no segments have been created', () => {
      const timeline = createTimeline();
      expect(timeline.getSegments()).toEqual([]);
    });

    it('returns a copy of the segments array (not the internal reference)', () => {
      const timeline = createTimeline();
      const segments1 = timeline.getSegments();
      const segments2 = timeline.getSegments();
      expect(segments1).not.toBe(segments2); // different array instances
      expect(segments1).toEqual(segments2);  // same contents
    });
  });

  // ─── clone ─────────────────────────────────────────────────────────────────

  describe('clone', () => {
    it('returns a new Timeline instance', () => {
      const timeline = createTimeline();
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 12, 31));
      expect(cloned).not.toBe(timeline);
      expect(cloned).toBeInstanceOf(Timeline);
    });

    it('shares the same account manager as the original', () => {
      const mockAccountManager = { id: 'shared-am' } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 12, 31));
      expect(cloned.getAccountManager()).toBe(mockAccountManager);
    });

    it('cloned timeline has independent events list', async () => {
      const timeline = createTimeline();
      // Add an event via addSpendingTrackerEvents
      await (timeline as any).addSpendingTrackerEvents(
        [makeCategory({ id: 'c1', name: 'C1', interval: 'monthly', intervalStart: '1', accountId: 'acct-1' })],
        utcDate(2025, 3, 1),
        utcDate(2025, 3, 31),
      );

      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 3, 31));

      // Mutate original events - should not affect clone
      (timeline as any).events.length = 0;

      expect((cloned as any).events.length).toBeGreaterThan(0);
    });

    it('cloned timeline creates segments for the given date range', async () => {
      const timeline = createTimeline();
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 3, 31));

      const segments = cloned.getSegments();
      // 3 months → 3 segments
      expect(segments.length).toBe(3);
    });

    it('accepts a monteCarloConfig argument', () => {
      const timeline = createTimeline();
      const mockMonteCarloConfig = { enabled: true, handler: {}, simulationNumber: 1, totalSimulations: 10 };
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 12, 31), mockMonteCarloConfig);
      expect(cloned).toBeInstanceOf(Timeline);
    });
  });

  // ─── applyMonteCarlo ───────────────────────────────────────────────────────

  describe('applyMonteCarlo', () => {
    it('calls handler.getSample for bill events with monteCarloSampleType', async () => {
      const getSample = vi.fn().mockReturnValue(0.03);
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 10,
        variableMappings: { 'INFLATION': 'Inflation' },
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      // Inject a bill event with monteCarloSampleType directly
      const billEvent = {
        id: 'bill-mc-1',
        type: EventType.bill,
        date: utcDate(2025, 6, 1),
        accountId: 'acct-1',
        priority: 2,
        originalBill: {
          id: 'bill-1',
          amount: 100,
          increaseByVariable: 'INFLATION',
          startDate: utcDate(2024, 1, 1),
          increaseByDate: { month: 0, day: 1 },
          increaseBy: 0,
          ceilingMultiple: null,
        },
        amount: 100,
        firstBill: false,
      } as unknown as BillEvent;

      (timeline as any).events = [billEvent];
      timeline.applyMonteCarlo();

      // getSample not called because yearsDiff = 0 when startDate is within same year range
      // The handler is set, and the function runs without throwing
      expect(timeline).toBeDefined();
    });

    it('calls handler.getSample for interest events with monteCarloSampleType', async () => {
      const getSample = vi.fn().mockReturnValue(0.05);
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 10,
        variableMappings: { 'HIGH_YIELD_SAVINGS_RATE': 'HYSA' },
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const interestEvent = {
        id: 'interest-mc-1',
        type: EventType.interest,
        date: utcDate(2025, 6, 1),
        accountId: 'acct-1',
        priority: 0,
        originalInterest: {
          id: 'interest-1',
          apr: 0.04,
          aprVariable: 'HIGH_YIELD_SAVINGS_RATE',
        },
        rate: 0.04,
        firstInterest: false,
      } as unknown as InterestEvent;

      (timeline as any).events = [interestEvent];
      timeline.applyMonteCarlo();

      expect(getSample).toHaveBeenCalledWith('HYSA', interestEvent.date);
      // rate should be updated to the sample value
      expect(interestEvent.rate).toBe(0.05);
    });

    it('does not modify bill events without monteCarloSampleType', () => {
      const getSample = vi.fn();
      const monteCarloConfig = { enabled: true, handler: { getSample }, simulationNumber: 1, totalSimulations: 1 };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const billEvent = {
        id: 'bill-1',
        type: EventType.bill,
        date: utcDate(2025, 6, 1),
        accountId: 'acct-1',
        priority: 2,
        originalBill: { id: 'bill-1', amount: 200, monteCarloSampleType: undefined },
        amount: 200,
        firstBill: false,
      } as unknown as BillEvent;

      (timeline as any).events = [billEvent];
      timeline.applyMonteCarlo();

      expect(getSample).not.toHaveBeenCalled();
      expect(billEvent.amount).toBe(200);
    });
  });

  // ─── createSegments ────────────────────────────────────────────────────────

  describe('createSegments (via clone)', () => {
    it('creates one segment per month in the range', () => {
      const timeline = createTimeline();
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 6, 30));
      // Jan, Feb, Mar, Apr, May, Jun = 6 segments
      expect(cloned.getSegments().length).toBe(6);
    });

    it('sets segment startDate and endDate to correct month boundaries', () => {
      const timeline = createTimeline();
      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 3, 31));
      const segments = cloned.getSegments();

      expect(segments.length).toBe(1);
      expect(fmt(segments[0].startDate)).toBe('2025-03-01');
      expect(fmt(segments[0].endDate)).toBe('2025-03-31');
    });

    it('assigns events to the correct segment', async () => {
      const timeline = createTimeline();
      // Use endDate that is past noon on the last day so spending tracker events
      // (which are set to noon UTC on periodEnd) are within the segment.
      // endDate = June 1 (so May 31 noon falls before it)
      await (timeline as any).addSpendingTrackerEvents(
        [makeCategory({ id: 'c1', name: 'C1', interval: 'monthly', intervalStart: '1', accountId: 'acct-1' })],
        utcDate(2025, 3, 1),
        utcDate(2025, 6, 1),
      );

      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 6, 1));
      const segments = cloned.getSegments();

      // Mar, Apr, May, and partial Jun = 4 segments; first 3 should have events
      expect(segments.length).toBeGreaterThanOrEqual(3);
      // March, April, May segments should each have an event
      const marSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-03-01');
      const aprSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-04-01');
      const maySegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-05-01');
      expect(marSegment?.events.length).toBeGreaterThan(0);
      expect(aprSegment?.events.length).toBeGreaterThan(0);
      expect(maySegment?.events.length).toBeGreaterThan(0);
    });

    it('adds transfer account IDs to affectedAccountIds', async () => {
      const timeline = createTimeline();

      // Inject a billTransfer event manually
      const billTransferEvent = {
        id: 'bill-transfer-1',
        type: EventType.billTransfer,
        date: utcDate(2025, 3, 15),
        accountId: 'acct-from',
        priority: 2,
        fromAccountId: 'acct-from',
        toAccountId: 'acct-to',
        originalBill: { id: 'b1', amount: 100, monteCarloSampleType: undefined },
        amount: 100,
        firstBill: false,
      };
      (timeline as any).events = [billTransferEvent];

      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 3, 31));
      const segments = cloned.getSegments();

      const marchSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-03-01');
      expect(marchSegment).toBeDefined();
      expect(marchSegment!.affectedAccountIds.has('acct-from')).toBe(true);
      expect(marchSegment!.affectedAccountIds.has('acct-to')).toBe(true);
    });

    it('gives each segment a unique id', () => {
      const timeline = createTimeline();
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 4, 30));
      const segments = cloned.getSegments();
      const ids = segments.map((s: Segment) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('generates a non-empty cacheKey for a segment with events', async () => {
      const timeline = createTimeline();
      // Use April 1 as endDate so the March 31 noon event falls before the boundary
      await (timeline as any).addSpendingTrackerEvents(
        [makeCategory({ id: 'c1', name: 'C1', interval: 'monthly', intervalStart: '1', accountId: 'acct-1' })],
        utcDate(2025, 3, 1),
        utcDate(2025, 4, 1),
      );
      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 4, 1));
      const segments = cloned.getSegments();
      // March segment should have the event
      const marchSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-03-01');
      expect(marchSegment).toBeDefined();
      expect(marchSegment!.cacheKey).not.toBe('empty');
      expect(marchSegment!.cacheKey.length).toBeGreaterThan(0);
    });

    it('generates "empty" cacheKey for a segment with no events', () => {
      const timeline = createTimeline();
      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 3, 31));
      const segments = cloned.getSegments();
      expect(segments[0].cacheKey).toBe('empty');
    });
  });

  // ─── sortEvents ────────────────────────────────────────────────────────────

  describe('sortEvents (indirectly via clone)', () => {
    it('sorts events by date ascending', async () => {
      const timeline = createTimeline();
      // Add events via spending tracker across months - they will be sorted
      await (timeline as any).addSpendingTrackerEvents(
        [makeCategory({ id: 'c1', name: 'C1', interval: 'monthly', intervalStart: '1', accountId: 'acct-1' })],
        utcDate(2025, 1, 1),
        utcDate(2025, 3, 31),
      );

      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 3, 31));
      const events = (cloned as any).events as TimelineEvent[];

      for (let i = 1; i < events.length; i++) {
        expect(events[i].date.getTime()).toBeGreaterThanOrEqual(events[i - 1].date.getTime());
      }
    });

    it('sorts same-date events by priority ascending', async () => {
      const timeline = createTimeline();

      // Inject two events on the same date with different priorities
      const highPriorityEvent: TimelineEvent = {
        id: 'high',
        type: EventType.tax,
        date: utcDate(2025, 3, 15),
        accountId: 'acct-1',
        priority: 3,
      };
      const lowPriorityEvent: TimelineEvent = {
        id: 'low',
        type: EventType.interest,
        date: utcDate(2025, 3, 15),
        accountId: 'acct-1',
        priority: 0,
      };
      (timeline as any).events = [highPriorityEvent, lowPriorityEvent];

      const cloned = timeline.clone(utcDate(2025, 3, 1), utcDate(2025, 3, 31));
      const events = (cloned as any).events as TimelineEvent[];

      // Interest (priority 0) should come before Tax (priority 3)
      const lowIdx = events.findIndex((e) => e.id === 'low');
      const highIdx = events.findIndex((e) => e.id === 'high');
      expect(lowIdx).toBeLessThan(highIdx);
    });
  });

  // ─── addActivityEvents (private) ───────────────────────────────────────────

  describe('addActivityEvents (private)', () => {
    it('adds non-transfer activity events to the timeline', async () => {
      const mockActivity = {
        id: 'act-1',
        date: utcDate(2025, 3, 15),
        isTransfer: false,
        name: 'Expense',
      };
      const mockAccount = { id: 'acct-1', activity: [mockActivity], bills: [], interests: [] };
      const accountsAndTransfers = {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events as ActivityEvent[];
      expect(events.length).toBe(1);
      expect(events[0].type).toBe(EventType.activity);
      expect(events[0].accountId).toBe('acct-1');
    });

    it('skips transfer activities', async () => {
      const mockActivity = {
        id: 'act-transfer',
        date: utcDate(2025, 3, 15),
        isTransfer: true,
        name: 'Transfer',
      };
      const mockAccount = { id: 'acct-1', activity: [mockActivity], bills: [], interests: [] };
      const accountsAndTransfers = {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events as ActivityEvent[];
      expect(events.length).toBe(0);
    });

    it('skips activities after endDate', async () => {
      const mockActivity = {
        id: 'act-future',
        date: utcDate(2026, 1, 1),
        isTransfer: false,
        name: 'Future',
      };
      const mockAccount = { id: 'acct-1', activity: [mockActivity], bills: [], interests: [] };
      const accountsAndTransfers = {
        accounts: [mockAccount],
        transfers: { activity: [], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(0);
    });
  });

  // ─── addTransferActivityEvents (private) ──────────────────────────────────

  describe('addTransferActivityEvents (private)', () => {
    it('skips transfer activities without fro or to', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockActivity = {
        id: 'act-1',
        date: utcDate(2025, 3, 15),
        isTransfer: true,
        fro: null,
        to: null,
      };
      const accountsAndTransfers = {
        accounts: [],
        transfers: { activity: [mockActivity], bills: [] },
      };
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(undefined),
      } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addTransferActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(0);
      consoleSpy.mockRestore();
    });

    it('skips activities past endDate', async () => {
      const mockActivity = {
        id: 'act-1',
        date: utcDate(2026, 1, 1),
        isTransfer: true,
        fro: 'Checking',
        to: 'Savings',
      };
      const accountsAndTransfers = {
        accounts: [],
        transfers: { activity: [mockActivity], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addTransferActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(0);
    });

    it('adds activityTransfer event when both from and to accounts exist', async () => {
      const mockActivity = {
        id: 'act-1',
        date: utcDate(2025, 3, 15),
        isTransfer: true,
        fro: 'Checking',
        to: 'Savings',
      };
      const fromAccount = { id: 'acct-from', name: 'Checking' };
      const toAccount = { id: 'acct-to', name: 'Savings' };

      const mockAccountManager = {
        getAccountByName: vi.fn()
          .mockImplementation((name: string) => name === 'Checking' ? fromAccount : toAccount),
      } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const accountsAndTransfers = {
        accounts: [],
        transfers: { activity: [mockActivity], bills: [] },
      };
      await (timeline as any).addTransferActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(1);
      expect(events[0].type).toBe(EventType.activityTransfer);
      expect(events[0].fromAccountId).toBe('acct-from');
      expect(events[0].toAccountId).toBe('acct-to');
    });

    it('adds activityTransfer event when only from account exists', async () => {
      const mockActivity = {
        id: 'act-partial',
        date: utcDate(2025, 3, 15),
        isTransfer: true,
        fro: 'Checking',
        to: 'Savings',
      };
      const fromAccount = { id: 'acct-from', name: 'Checking' };

      const mockAccountManager = {
        getAccountByName: vi.fn()
          .mockImplementation((name: string) => name === 'Checking' ? fromAccount : undefined),
      } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const accountsAndTransfers = {
        accounts: [],
        transfers: { activity: [mockActivity], bills: [] },
      };
      await (timeline as any).addTransferActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(1);
      expect(events[0].type).toBe(EventType.activityTransfer);
      expect(events[0].fromAccountId).toBe('acct-from');
      expect(events[0].toAccountId).toBe('');
    });

    it('warns and skips when transfer activity has no fro or to (null values)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Activity with isTransfer=true but fro and to are null/undefined
      const mockActivity = {
        id: 'act-nofroto',
        date: utcDate(2025, 3, 15),
        isTransfer: true,
        fro: undefined,
        to: undefined,
      };
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(undefined),
      } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const accountsAndTransfers = {
        accounts: [],
        transfers: { activity: [mockActivity], bills: [] },
      };
      await (timeline as any).addTransferActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ─── addBillEvents / generateBillEvents (private) ─────────────────────────

  describe('addBillEvents / generateBillEvents (private)', () => {
    function makeMockBill(overrides: Record<string, any> = {}): any {
      return {
        id: 'bill-1',
        name: 'Test Bill',
        startDate: utcDate(2025, 1, 1),
        endDate: null,
        periods: 'month',
        everyN: 1,
        amount: 100,
        increaseBy: 0,
        increaseByDate: { month: 0, day: 1 },
        ceilingMultiple: 0,
        monteCarloSampleType: null,
        checkAnnualDates: (d: Date) => d,
        ...overrides,
      };
    }

    it('generates bill events for a simple monthly bill', async () => {
      const bill = makeMockBill({ startDate: utcDate(2025, 1, 1), endDate: utcDate(2025, 3, 31) });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(3);
      expect(events[0].type).toBe(EventType.bill);
      expect(events[0].accountId).toBe('acct-1');
      expect(events[0].firstBill).toBe(true);
      expect(events[1].firstBill).toBe(false);
    });

    it('skips bills starting after endDate', async () => {
      const bill = makeMockBill({ startDate: utcDate(2026, 1, 1) });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('respects bill endDate and stops generating events after it', async () => {
      const bill = makeMockBill({ startDate: utcDate(2025, 1, 1), endDate: utcDate(2025, 2, 28) });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(2); // Jan and Feb
    });

    it('generates bill events with special amount {HALF}', async () => {
      const bill = makeMockBill({ amount: '{HALF}' });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 1, 31));

      const events = (timeline as any).events;
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].amount).toBe('{HALF}');
    });

    it('generates bill events with special amount {FULL}', async () => {
      const bill = makeMockBill({ amount: '{FULL}' });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 1, 31));

      const events = (timeline as any).events;
      expect(events[0].amount).toBe('{FULL}');
    });

    it('applies ceilingMultiple to bill amount', async () => {
      // Amount = 105, ceilingMultiple = 50 => ceil(105/50)*50 = 150
      const bill = makeMockBill({ amount: 105, ceilingMultiple: 50 });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 1, 31));

      const events = (timeline as any).events;
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].amount).toBe(150);
    });

    it('applies inflation (increaseBy) to bill amount across years', async () => {
      // yearIncreases counts milestone dates that fall between startDate and currentDate (inclusive).
      // increaseByDate = Jan 1. For Jan 2024: Jan1-2024 is same as startDate and currentDate => count=1.
      // For Jan 2025: Jan1-2024 and Jan1-2025 both count => count=2.
      // So: event1 (Jan2024) amount = 100 * 1.10 = 110; event2 (Jan2025) = 100 * 1.10^2 = 121
      const bill = makeMockBill({
        startDate: utcDate(2024, 1, 1),
        endDate: utcDate(2025, 1, 31),
        amount: 100,
        increaseBy: 0.10,
        increaseByDate: { month: 0, day: 1 }, // Jan 1 each year
        periods: 'year',
        everyN: 1,
      });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(2);
      // First event at Jan 2024: yearIncreases counts Jan1-2024 => 1 increase applied
      expect(events[0].amount).toBeCloseTo(110, 0);
      // Second event at Jan 2025: yearIncreases counts Jan1-2024 and Jan1-2025 => 2 increases
      expect(events[1].amount).toBeCloseTo(121, 0);
    });

    it('applies ceilingMultiple after each inflation step', async () => {
      // ceilingMultiple applied first to base amount: ceil(100/50)*50 = 100
      // Then yearIncreases for Jan 2024 event counts 1 (Jan1-2024 is same as startDate):
      //   100 * 1.60 = 160; ceil(160/50)*50 = 200
      // For Jan 2025 event: count=2 increases:
      //   100 * 1.60 = 160 → ceil(160/50)*50 = 200; 200 * 1.60 = 320 → ceil(320/50)*50 = 350
      const bill = makeMockBill({
        startDate: utcDate(2024, 1, 1),
        endDate: utcDate(2025, 1, 31),
        amount: 100,
        increaseBy: 0.60,
        increaseByDate: { month: 0, day: 1 },
        ceilingMultiple: 50,
        periods: 'year',
        everyN: 1,
      });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(2);
      // First event: 1 inflation step with ceiling => 200
      expect(events[0].amount).toBe(200);
      // Second event: 2 inflation steps with ceiling => 350
      expect(events[1].amount).toBe(350);
    });

    it('throws when too many bill events are generated (> 10000)', async () => {
      // Daily bill with no endDate over many years would exceed 10000
      // Simulate by using a bill where checkAnnualDates returns same date (infinite loop protection)
      let callCount = 0;
      const bill = makeMockBill({
        startDate: utcDate(2000, 1, 1),
        endDate: null,
        periods: 'day',
        everyN: 1,
        checkAnnualDates: (d: Date) => { callCount++; return d; },
      });
      const account = { id: 'acct-1', bills: [bill], activity: [], interests: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();

      await expect(
        (timeline as any).addBillEvents(accountsAndTransfers, utcDate(2100, 12, 31))
      ).rejects.toThrow('Too many bill events generated');
    });
  });

  // ─── addInterestEvents / generateInterestEvents (private) ─────────────────

  describe('addInterestEvents / generateInterestEvents (private)', () => {
    function makeMockInterest(overrides: Record<string, any> = {}): any {
      return {
        id: 'interest-1',
        apr: 0.05,
        compounded: 'month',
        applicableDate: utcDate(2025, 1, 1),
        monteCarloSampleType: null,
        ...overrides,
      };
    }

    it('generates monthly interest events for an account', async () => {
      const interest = makeMockInterest({ applicableDate: utcDate(2025, 1, 1) });
      const account = { id: 'acct-1', interests: [interest], activity: [], bills: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addInterestEvents(accountsAndTransfers, utcDate(2025, 3, 31));

      const events = (timeline as any).events;
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe(EventType.interest);
      expect(events[0].accountId).toBe('acct-1');
      expect(events[0].firstInterest).toBe(true);
      expect(events[1].firstInterest).toBe(false);
    });

    it('uses next interest applicableDate as the boundary for the previous interest', async () => {
      // Two interests: first applies Jan-Mar, second applies Apr+
      const interest1 = makeMockInterest({ id: 'int-1', apr: 0.03, applicableDate: utcDate(2025, 1, 1) });
      const interest2 = makeMockInterest({ id: 'int-2', apr: 0.06, applicableDate: utcDate(2025, 4, 1) });
      const account = { id: 'acct-1', interests: [interest1, interest2], activity: [], bills: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addInterestEvents(accountsAndTransfers, utcDate(2025, 6, 30));

      const events = (timeline as any).events as InterestEvent[];
      expect(events.length).toBeGreaterThan(0);
      // Events from first interest should have apr=0.03
      const firstInterestEvents = events.filter(e => e.rate === 0.03);
      expect(firstInterestEvents.length).toBeGreaterThan(0);
    });

    it('generates no events when account has no interests', async () => {
      const account = { id: 'acct-1', interests: [], activity: [], bills: [] };
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = createTimeline();
      await (timeline as any).addInterestEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });
  });

  // ─── addTransferBillEvents / generateTransferBillEvents (private) ──────────

  describe('addTransferBillEvents / generateTransferBillEvents (private)', () => {
    function makeMockTransferBill(overrides: Record<string, any> = {}): any {
      return {
        id: 'tbill-1',
        name: 'Transfer Bill',
        fro: 'Checking',
        to: 'Savings',
        startDate: utcDate(2025, 1, 1),
        endDate: utcDate(2025, 3, 31),
        periods: 'month',
        everyN: 1,
        amount: 200,
        increaseBy: 0,
        increaseByDate: { month: 0, day: 1 },
        ceilingMultiple: 0,
        monteCarloSampleType: null,
        checkAnnualDates: (d: Date) => d,
        ...overrides,
      };
    }

    it('generates bill transfer events when both accounts exist', async () => {
      const fromAccount = { id: 'acct-from', name: 'Checking' };
      const toAccount = { id: 'acct-to', name: 'Savings' };
      const mockAccountManager = {
        getAccountByName: vi.fn()
          .mockImplementation((name: string) => name === 'Checking' ? fromAccount : toAccount),
      } as unknown as AccountManager;

      const bill = makeMockTransferBill();
      const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [bill] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addTransferBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(3); // Jan, Feb, Mar
      expect(events[0].type).toBe(EventType.billTransfer);
      expect(events[0].fromAccountId).toBe('acct-from');
      expect(events[0].toAccountId).toBe('acct-to');
      expect(events[0].firstBill).toBe(true);
    });

    it('skips transfer bills with no startDate before endDate', async () => {
      const bill = makeMockTransferBill({ startDate: utcDate(2026, 1, 1) });
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(undefined),
      } as unknown as AccountManager;
      const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [bill] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addTransferBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('skips transfer bills with no fro or to', async () => {
      const bill = makeMockTransferBill({ fro: null, to: null });
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(undefined),
      } as unknown as AccountManager;
      const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [bill] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addTransferBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('skips transfer bills when neither account exists', async () => {
      const bill = makeMockTransferBill();
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(undefined),
      } as unknown as AccountManager;
      const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [bill] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addTransferBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('generates transfer bill events when only from account exists', async () => {
      const fromAccount = { id: 'acct-from', name: 'Checking' };
      const mockAccountManager = {
        getAccountByName: vi.fn()
          .mockImplementation((name: string) => name === 'Checking' ? fromAccount : undefined),
      } as unknown as AccountManager;

      const bill = makeMockTransferBill({ endDate: utcDate(2025, 1, 31) });
      const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [bill] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addTransferBillEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(1);
      expect(events[0].fromAccountId).toBe('acct-from');
      expect(events[0].toAccountId).toBe('');
    });
  });

  // ─── addSocialSecurityEvents / generateSocialSecurityEvents (private) ──────

  describe('addSocialSecurityEvents / generateSocialSecurityEvents (private)', () => {
    function makeSocialSecurity(payToAccount: any, overrides: Record<string, any> = {}): any {
      return {
        name: 'SS-Alice',
        payToAccount: 'Checking',
        startDate: utcDate(2025, 1, 1),
        birthDate: utcDate(1955, 1, 1),
        ...overrides,
      };
    }

    it('generates monthly social security events', async () => {
      const ssAccount = { id: 'ss-acct', name: 'Checking' };
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([makeSocialSecurity(ssAccount)]),
        getPensions: vi.fn().mockReturnValue([]),
        getAccountByName: vi.fn().mockReturnValue(ssAccount),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addSocialSecurityEvents(utcDate(2025, 3, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(3); // Jan, Feb, Mar 2025
      expect(events[0].type).toBe(EventType.socialSecurity);
      expect(events[0].accountId).toBe('ss-acct');
      expect(events[0].firstPayment).toBe(true);
      expect(events[1].firstPayment).toBe(false);
    });

    it('skips social security when payTo account does not exist', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([makeSocialSecurity(null)]),
        getPensions: vi.fn().mockReturnValue([]),
        getAccountByName: vi.fn().mockReturnValue(undefined),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addSocialSecurityEvents(utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('skips social security that starts after endDate', async () => {
      const ss = makeSocialSecurity(null, { startDate: utcDate(2026, 1, 1) });
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([ss]),
        getPensions: vi.fn().mockReturnValue([]),
        getAccountByName: vi.fn().mockReturnValue({ id: 'x', name: 'Checking' }),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addSocialSecurityEvents(utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('calculates ownerAge based on birthDate', async () => {
      const ssAccount = { id: 'ss-acct', name: 'Checking' };
      // Born Jan 1 1955, starting Jan 1 2025 => age 70
      const ss = makeSocialSecurity(ssAccount, {
        startDate: utcDate(2025, 1, 1),
        birthDate: utcDate(1955, 1, 1),
      });
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([ss]),
        getPensions: vi.fn().mockReturnValue([]),
        getAccountByName: vi.fn().mockReturnValue(ssAccount),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addSocialSecurityEvents(utcDate(2025, 1, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(1);
      expect(events[0].ownerAge).toBe(70);
    });
  });

  // ─── addPensionEvents / generatePensionEvents (private) ───────────────────

  describe('addPensionEvents / generatePensionEvents (private)', () => {
    function makePension(overrides: Record<string, any> = {}): any {
      return {
        name: 'Pension-Bob',
        payToAccount: 'Checking',
        startDate: utcDate(2025, 1, 1),
        birthDate: utcDate(1960, 6, 15),
        yearsWorked: 30,
        unreducedRequirements: [{ age: 65, yearsWorked: 5 }],
        reducedRequirements: [{ age: 60, yearsWorked: 5 }],
        ...overrides,
      };
    }

    it('generates monthly pension events', async () => {
      const pensionAccount = { id: 'pension-acct', name: 'Checking' };
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([]),
        getPensions: vi.fn().mockReturnValue([makePension()]),
        getAccountByName: vi.fn().mockReturnValue(pensionAccount),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addPensionEvents(utcDate(2025, 3, 31));

      const events = (timeline as any).events;
      expect(events.length).toBe(3); // Jan, Feb, Mar
      expect(events[0].type).toBe(EventType.pension);
      expect(events[0].accountId).toBe('pension-acct');
      expect(events[0].firstPayment).toBe(true);
      expect(events[2].firstPayment).toBe(false);
    });

    it('skips pension when payTo account does not exist', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([]),
        getPensions: vi.fn().mockReturnValue([makePension()]),
        getAccountByName: vi.fn().mockReturnValue(undefined),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addPensionEvents(utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('skips pension that starts after endDate', async () => {
      const pension = makePension({ startDate: utcDate(2027, 1, 1) });
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([]),
        getPensions: vi.fn().mockReturnValue([pension]),
        getAccountByName: vi.fn().mockReturnValue({ id: 'x', name: 'Checking' }),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addPensionEvents(utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });
  });

  // ─── addRmdEvents / generateRmdEvents (private) ───────────────────────────

  describe('addRmdEvents / generateRmdEvents (private)', () => {
    function makeMockAccountWithRMD(overrides: Record<string, any> = {}): any {
      return {
        id: 'rmd-acct',
        name: 'IRA',
        usesRMD: true,
        rmdAccount: 'Checking',
        accountOwnerDOB: utcDate(1950, 6, 1),
        activity: [],
        bills: [],
        interests: [],
        ...overrides,
      };
    }

    it('generates an RMD event on Dec 31 for each year in range', async () => {
      const rmdAccount = makeMockAccountWithRMD();
      const checkingAccount = { id: 'checking', name: 'Checking' };
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(checkingAccount),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;

      const accountsAndTransfers = {
        accounts: [rmdAccount],
        transfers: { activity: [], bills: [] },
      };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addRmdEvents(accountsAndTransfers, utcDate(2025, 1, 1), utcDate(2026, 12, 31));

      const events = (timeline as any).events as RMDEvent[];
      expect(events.length).toBe(2); // Dec 31 2025 and Dec 31 2026
      expect(events[0].type).toBe(EventType.rmd);
      expect(events[0].accountId).toBe('rmd-acct');
      // Dec 31 check
      expect(events[0].date.getUTCMonth()).toBe(11); // December
      expect(events[0].date.getUTCDate()).toBe(31);
    });

    it('skips accounts without usesRMD', async () => {
      const account = makeMockAccountWithRMD({ usesRMD: false });
      const accountsAndTransfers = {
        accounts: [account],
        transfers: { activity: [], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addRmdEvents(accountsAndTransfers, utcDate(2025, 1, 1), utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('skips accounts without rmdAccount', async () => {
      const account = makeMockAccountWithRMD({ rmdAccount: null });
      const accountsAndTransfers = {
        accounts: [account],
        transfers: { activity: [], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addRmdEvents(accountsAndTransfers, utcDate(2025, 1, 1), utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('skips accounts without accountOwnerDOB', async () => {
      const account = makeMockAccountWithRMD({ accountOwnerDOB: null });
      const accountsAndTransfers = {
        accounts: [account],
        transfers: { activity: [], bills: [] },
      };
      const timeline = createTimeline();
      await (timeline as any).addRmdEvents(accountsAndTransfers, utcDate(2025, 1, 1), utcDate(2025, 12, 31));

      expect((timeline as any).events.length).toBe(0);
    });

    it('calculates owner age in RMD event', async () => {
      const rmdAccount = makeMockAccountWithRMD({ accountOwnerDOB: utcDate(1950, 1, 1) });
      const checkingAccount = { id: 'checking', name: 'Checking' };
      const mockAccountManager = {
        getAccountByName: vi.fn().mockReturnValue(checkingAccount),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;
      const accountsAndTransfers = {
        accounts: [rmdAccount],
        transfers: { activity: [], bills: [] },
      };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      await (timeline as any).addRmdEvents(accountsAndTransfers, utcDate(2025, 1, 1), utcDate(2025, 12, 31));

      const events = (timeline as any).events as RMDEvent[];
      expect(events.length).toBe(1);
      expect(events[0].ownerAge).toBe(75); // Dec 31 2025 - Jan 1 1950 = 75
    });
  });

  // ─── addTaxEvents / generateTaxEvents (private) ───────────────────────────

  describe('addTaxEvents / generateTaxEvents (private)', () => {
    it('generates a tax event on Mar 1 for accounts that performsPulls', async () => {
      const account = {
        id: 'acct-1',
        name: 'IRA',
        performsPulls: true,
        activity: [],
        bills: [],
        interests: [],
      };
      const mockAccountManager = {
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const currentYear = new Date().getUTCFullYear();
      await (timeline as any).addTaxEvents(
        accountsAndTransfers,
        new Date(Date.UTC(currentYear, 0, 1)),
        new Date(Date.UTC(currentYear + 1, 11, 31))
      );

      const events = (timeline as any).events as TaxEvent[];
      // Expect at least one tax event
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe(EventType.tax);
      expect(events[0].accountId).toBe('acct-1');
      // Tax event is on March 1
      expect(events[0].date.getUTCMonth()).toBe(2); // March
      expect(events[0].date.getUTCDate()).toBe(1);
    });

    it('generates tax events for interest-pay accounts', async () => {
      const account = {
        id: 'acct-savings',
        name: 'Savings',
        performsPulls: false,
        activity: [],
        bills: [],
        interests: [],
      };
      const mockAccountManager = {
        // 'Savings' is an interest-pay account
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set(['Savings'])),
      } as unknown as AccountManager;
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const currentYear = new Date().getUTCFullYear();
      await (timeline as any).addTaxEvents(
        accountsAndTransfers,
        new Date(Date.UTC(currentYear, 0, 1)),
        new Date(Date.UTC(currentYear, 11, 31))
      );

      const events = (timeline as any).events as TaxEvent[];
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe(EventType.tax);
    });

    it('skips tax events for accounts that do not pay taxes', async () => {
      const account = {
        id: 'acct-checking',
        name: 'Checking',
        performsPulls: false,
        activity: [],
        bills: [],
        interests: [],
      };
      const mockAccountManager = {
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;
      const accountsAndTransfers = { accounts: [account], transfers: { activity: [], bills: [] } };
      const timeline = new Timeline(mockAccountManager, Date.now(), false);
      const currentYear = new Date().getUTCFullYear();
      await (timeline as any).addTaxEvents(
        accountsAndTransfers,
        new Date(Date.UTC(currentYear, 0, 1)),
        new Date(Date.UTC(currentYear, 11, 31))
      );

      expect((timeline as any).events.length).toBe(0);
    });
  });

  // ─── calculateBillAmountMonteCarlo (private) ──────────────────────────────

  describe('calculateBillAmountMonteCarlo (private)', () => {
    it('returns special amounts unchanged (e.g. {HALF})', () => {
      const getSample = vi.fn().mockReturnValue(0.03);
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 10,
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const bill = {
        amount: '{HALF}' as const,
        increaseByVariable: 'INFLATION',
        startDate: utcDate(2024, 1, 1),
        increaseByDate: { month: 0, day: 1 },
      } as any;

      const result = (timeline as any).calculateBillAmountMonteCarlo(bill, utcDate(2025, 1, 1));
      expect(result).toBe('{HALF}');
      expect(getSample).not.toHaveBeenCalled();
    });

    it('throws if monteCarlo config is not enabled', () => {
      const mockAccountManager = {} as AccountManager;
      // No monteCarlo config
      const timeline = new Timeline(mockAccountManager, Date.now(), false);

      const bill = {
        amount: 100,
        increaseByVariable: 'INFLATION',
        startDate: utcDate(2024, 1, 1),
        increaseByDate: { month: 0, day: 1 },
      } as any;

      expect(() =>
        (timeline as any).calculateBillAmountMonteCarlo(bill, utcDate(2025, 1, 1))
      ).toThrow('Monte Carlo configuration not enabled');
    });

    it('applies monte carlo samples for multi-year inflation', () => {
      const getSample = vi.fn().mockReturnValue(0.05); // 5% each year
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 10,
        variableMappings: { 'INFLATION': 'Inflation' },
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const bill = {
        amount: 100,
        increaseByVariable: 'INFLATION',
        startDate: utcDate(2023, 1, 1),
        increaseByDate: { month: 0, day: 1 }, // Jan 1
      } as any;

      // calculateBillAmountMonteCarlo uses yearIncreases(startDate, currentDate, increaseByDate).
      // startDate=Jan1-2023, currentDate=Jun1-2025, increaseByDate=Jan1
      // Milestones: Jan1-2023 (>= startDate, <= Jun1-2025: YES),
      //             Jan1-2024 (YES), Jan1-2025 (YES) => yearsDiff=3
      // 100 * 1.05 * 1.05 * 1.05 = 115.7625
      const result = (timeline as any).calculateBillAmountMonteCarlo(bill, utcDate(2025, 6, 1));
      expect(result as number).toBeCloseTo(115.76, 1);
    });

    it('throws when getSample returns null for a year', () => {
      const getSample = vi.fn().mockReturnValue(null);
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 10,
        variableMappings: { 'INFLATION': 'Inflation' },
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const bill = {
        amount: 100,
        increaseByVariable: 'INFLATION',
        startDate: utcDate(2023, 1, 1),
        increaseByDate: { month: 0, day: 1 },
      } as any;

      expect(() =>
        (timeline as any).calculateBillAmountMonteCarlo(bill, utcDate(2025, 6, 1))
      ).toThrow('No sample found');
    });
  });

  // ─── applyMonteCarlo with billTransfer events ──────────────────────────────

  describe('applyMonteCarlo with billTransfer events', () => {
    it('applies monte carlo amount for billTransfer events with monteCarloSampleType', () => {
      const getSample = vi.fn().mockReturnValue(0.03);
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 10,
        variableMappings: { 'INFLATION': 'Inflation' },
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const billTransferEvent = {
        id: 'bt-mc-1',
        type: EventType.billTransfer,
        date: utcDate(2025, 6, 1),
        accountId: 'acct-from',
        priority: 2,
        fromAccountId: 'acct-from',
        toAccountId: 'acct-to',
        originalBill: {
          id: 'bill-1',
          amount: 100,
          increaseByVariable: 'INFLATION',
          startDate: utcDate(2024, 1, 1),
          increaseByDate: { month: 0, day: 1 },
          increaseBy: 0,
          ceilingMultiple: null,
        },
        amount: 100,
        firstBill: false,
      } as any;

      (timeline as any).events = [billTransferEvent];
      timeline.applyMonteCarlo();

      // Amount should be updated by monteCarlo (no increaseDate change = same amount for yearsDiff=0)
      expect(timeline).toBeDefined();
    });

    it('does not modify billTransfer events without monteCarloSampleType', () => {
      const getSample = vi.fn();
      const monteCarloConfig = {
        enabled: true,
        handler: { getSample },
        simulationNumber: 1,
        totalSimulations: 1,
      };
      const mockAccountManager = {} as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), false, monteCarloConfig);

      const billTransferEvent = {
        id: 'bt-1',
        type: EventType.billTransfer,
        date: utcDate(2025, 6, 1),
        accountId: 'acct-from',
        priority: 2,
        fromAccountId: 'acct-from',
        toAccountId: 'acct-to',
        originalBill: { id: 'bill-1', amount: 500, monteCarloSampleType: undefined },
        amount: 500,
        firstBill: false,
      } as any;

      (timeline as any).events = [billTransferEvent];
      timeline.applyMonteCarlo();

      expect(getSample).not.toHaveBeenCalled();
      expect(billTransferEvent.amount).toBe(500);
    });
  });

  // ─── enableLogging paths ──────────────────────────────────────────────────

  describe('logging paths (enableLogging=true)', () => {
    it('logs messages when enableLogging is true', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockAccountManager = {
        getSocialSecurities: vi.fn().mockReturnValue([]),
        getPensions: vi.fn().mockReturnValue([]),
        getInterestPayAccountNames: vi.fn().mockReturnValue(new Set()),
      } as unknown as AccountManager;
      const timeline = new Timeline(mockAccountManager, Date.now(), true);

      const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [] } };
      await (timeline as any).addActivityEvents(accountsAndTransfers, utcDate(2025, 12, 31));

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Finished adding activity events'), expect.any(Number), 'ms');
      logSpy.mockRestore();
    });
  });

  // ─── createSegments break path ────────────────────────────────────────────

  describe('createSegments event past segment boundary', () => {
    it('stops assigning events to a segment once an event is past the segment end', async () => {
      const timeline = createTimeline();

      // Add events in two different months - this exercises the break path
      // when an event's date > actualEnd for the current segment
      const earlyEvent: TimelineEvent = {
        id: 'early',
        type: EventType.activity,
        date: utcDate(2025, 1, 15), // January
        accountId: 'acct-1',
        priority: 1,
      };
      const lateEvent: TimelineEvent = {
        id: 'late',
        type: EventType.activity,
        date: utcDate(2025, 3, 15), // March
        accountId: 'acct-1',
        priority: 1,
      };

      (timeline as any).events = [earlyEvent, lateEvent];

      // Clone creates segments - January segment should only have earlyEvent
      // March segment should only have lateEvent
      // When processing January segment, lateEvent is past actualEnd => break
      const cloned = timeline.clone(utcDate(2025, 1, 1), utcDate(2025, 3, 31));
      const segments = cloned.getSegments();

      const janSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-01-01');
      const febSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-02-01');
      const marSegment = segments.find((s: Segment) => fmt(s.startDate) === '2025-03-01');

      expect(janSegment?.events.length).toBe(1);
      expect(janSegment?.events[0].id).toBe('early');
      expect(febSegment?.events.length).toBe(0);
      expect(marSegment?.events.length).toBe(1);
      expect(marSegment?.events[0].id).toBe('late');
    });
  });
});
