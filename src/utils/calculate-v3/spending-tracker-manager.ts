import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { SpendingTrackerCategory, ChartDataResponse, ChartDataPoint } from '../../data/spendingTracker/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { loadNumberOrVariable, loadDateOrVariable } from '../simulation/loadVariableValue';
import { formatDate } from '../date/date';
import { DateString } from '../date/types';
import { computePeriodBoundaries } from './period-utils';
import { SegmentResult } from './types';

dayjs.extend(utc);

/**
 * Resolved threshold change with variable values already loaded.
 */
type ResolvedThresholdChange = {
  date: Date;
  newThreshold: number;
  resetCarry: boolean;
};

/**
 * Resolved category config with all variable values loaded at construction time.
 */
type ResolvedCategory = {
  id: string;
  name: string;
  threshold: number;
  interval: 'weekly' | 'monthly' | 'yearly';
  intervalStart: string;
  accountId: string;
  carryOver: boolean;
  carryUnder: boolean;
  increaseBy: number;
  increaseByDate: string; // "MM/DD" format
  thresholdChanges: ResolvedThresholdChange[];
};

/**
 * Per-category runtime state for spending tracking.
 */
type CategoryState = {
  carryBalance: number;
  periodSpending: number;
  lastProcessedPeriodEnd: Date | null;
  checkpointCarryBalance: number;
  checkpointPeriodSpending: number;
  checkpointLastProcessedPeriodEnd: Date | null;
};

/**
 * Manages spending tracking against configurable budgets per category,
 * with carry-over/carry-under logic and threshold inflation.
 *
 * All variable values are resolved once at construction time.
 * State tracks carry balances and period spending per category.
 */
export class SpendingTrackerManager {
  private resolvedCategories: Map<string, ResolvedCategory> = new Map();
  private categoryStates: Map<string, CategoryState> = new Map();
  private startDate: Date;

  constructor(categories: SpendingTrackerCategory[], simulation: string, startDate: Date) {
    this.startDate = startDate;

    for (const category of categories) {
      // Resolve threshold
      const resolvedThreshold = loadNumberOrVariable(
        category.threshold,
        category.thresholdIsVariable,
        category.thresholdVariable,
        simulation,
      );
      if (typeof resolvedThreshold.amount !== 'number') {
        throw new Error(`SpendingTrackerManager: threshold for category "${category.name}" resolved to non-numeric value`);
      }

      // Resolve increaseBy
      const resolvedIncreaseBy = loadNumberOrVariable(
        category.increaseBy,
        category.increaseByIsVariable,
        category.increaseByVariable,
        simulation,
      );
      if (typeof resolvedIncreaseBy.amount !== 'number') {
        throw new Error(`SpendingTrackerManager: increaseBy for category "${category.name}" resolved to non-numeric value`);
      }

      // Resolve threshold changes
      const resolvedChanges: ResolvedThresholdChange[] = category.thresholdChanges.map((change) => {
        const resolvedDate = loadDateOrVariable(
          change.date as DateString,
          change.dateIsVariable,
          change.dateVariable,
          simulation,
        );
        const resolvedNewThreshold = loadNumberOrVariable(
          change.newThreshold,
          change.newThresholdIsVariable,
          change.newThresholdVariable,
          simulation,
        );
        if (typeof resolvedNewThreshold.amount !== 'number') {
          throw new Error(`SpendingTrackerManager: threshold change newThreshold for category "${category.name}" resolved to non-numeric value`);
        }
        return {
          date: resolvedDate.date,
          newThreshold: resolvedNewThreshold.amount as number,
          resetCarry: change.resetCarry,
        };
      });

      // Sort threshold changes chronologically by resolved dates
      resolvedChanges.sort((a, b) => a.date.getTime() - b.date.getTime());

      this.resolvedCategories.set(category.id, {
        id: category.id,
        name: category.name,
        threshold: resolvedThreshold.amount as number,
        interval: category.interval,
        intervalStart: category.intervalStart,
        accountId: category.accountId,
        carryOver: category.carryOver,
        carryUnder: category.carryUnder,
        increaseBy: resolvedIncreaseBy.amount as number,
        increaseByDate: category.increaseByDate,
        thresholdChanges: resolvedChanges,
      });

      this.categoryStates.set(category.id, {
        carryBalance: 0,
        periodSpending: 0,
        lastProcessedPeriodEnd: null,
        checkpointCarryBalance: 0,
        checkpointPeriodSpending: 0,
        checkpointLastProcessedPeriodEnd: null,
      });
    }
  }

  /**
   * Returns the resolved category config for a given ID, or throws if not found.
   */
  getCategoryConfig(categoryId: string): ResolvedCategory {
    const config = this.resolvedCategories.get(categoryId);
    if (!config) {
      throw new Error(`SpendingTrackerManager: unknown category ID "${categoryId}"`);
    }
    return config;
  }

  /**
   * Static utility to compute the threshold at a given date, accounting for
   * threshold changes and compound inflation anchored to increaseByDate.
   *
   * This is separated as a static method so it can be reused by computeChartData()
   * in a later slice without needing an instance.
   */
  private static resolveThresholdAtDate(
    baseThreshold: number,
    thresholdChanges: ResolvedThresholdChange[],
    increaseBy: number,
    increaseByDate: string, // "MM/DD" format
    startDate: Date,
    date: Date,
  ): number {
    // 1. Apply threshold changes chronologically
    let currentThreshold = baseThreshold;
    let lastChangeDate: Date | null = null;

    for (const change of thresholdChanges) {
      if (!dayjs.utc(change.date).isAfter(dayjs.utc(date), 'day')) {
        currentThreshold = change.newThreshold;
        lastChangeDate = change.date;
      } else {
        break; // Changes are sorted chronologically, no need to continue
      }
    }

    // 2. Apply compound inflation anchored to increaseByDate rhythm
    if (increaseBy === 0) {
      return currentThreshold;
    }

    // Parse increaseByDate (MM/DD)
    const parts = increaseByDate.split('/');
    const milestoneMonth = parseInt(parts[0], 10) - 1; // 0-indexed
    const milestoneDay = parseInt(parts[1], 10);

    // The reference point for counting milestones is the last threshold change date,
    // or the calculation startDate if no changes have applied
    const referenceDate = lastChangeDate ?? startDate;

    // Count inflation milestones between referenceDate and date
    const refDayjs = dayjs.utc(referenceDate);
    const dateDayjs = dayjs.utc(date);

    // Find the first milestone on or after the reference date
    let milestoneYear = refDayjs.year();
    let milestone = dayjs.utc().year(milestoneYear).month(milestoneMonth).date(milestoneDay).startOf('day');

    // If the milestone in the reference year is before or on the reference date, start from next year
    if (!milestone.isAfter(refDayjs, 'day')) {
      milestoneYear += 1;
      milestone = dayjs.utc().year(milestoneYear).month(milestoneMonth).date(milestoneDay).startOf('day');
    }

    // Count milestones that fall on or before `date`
    let inflationCount = 0;
    while (!milestone.isAfter(dateDayjs, 'day')) {
      inflationCount += 1;
      milestoneYear += 1;
      milestone = dayjs.utc().year(milestoneYear).month(milestoneMonth).date(milestoneDay).startOf('day');
    }

    // Apply compound inflation
    if (inflationCount > 0) {
      currentThreshold *= Math.pow(1 + increaseBy, inflationCount);
    }

    return currentThreshold;
  }

  /**
   * Computes the base threshold for a given category at a given date,
   * accounting for threshold changes and compound inflation.
   */
  resolveThreshold(categoryId: string, date: Date): number {
    const config = this.getCategoryConfig(categoryId);
    return SpendingTrackerManager.resolveThresholdAtDate(
      config.threshold,
      config.thresholdChanges,
      config.increaseBy,
      config.increaseByDate,
      this.startDate,
      date,
    );
  }

  /**
   * Returns the base threshold and the effective threshold (adjusted for carry balance).
   * Effective threshold is clamped to a minimum of 0.
   */
  getEffectiveThreshold(
    categoryId: string,
    date: Date,
  ): { baseThreshold: number; effectiveThreshold: number } {
    const baseThreshold = this.resolveThreshold(categoryId, date);
    const state = this.categoryStates.get(categoryId);
    if (!state) {
      throw new Error(`SpendingTrackerManager: no state for category ID "${categoryId}"`);
    }
    const effectiveThreshold = Math.max(0, baseThreshold + state.carryBalance);
    return { baseThreshold, effectiveThreshold };
  }

  /**
   * Computes the remaining budget for a category given total spending so far.
   */
  computeRemainder(categoryId: string, totalSpent: number, date: Date): number {
    const { effectiveThreshold } = this.getEffectiveThreshold(categoryId, date);
    return Math.max(0, effectiveThreshold - totalSpent);
  }

  /**
   * Updates the carry balance for a category at the end of a period.
   * Applies carry-over/carry-under rules and checks for threshold change resets.
   */
  updateCarry(categoryId: string, totalSpent: number, date: Date): void {
    const config = this.getCategoryConfig(categoryId);
    const state = this.categoryStates.get(categoryId)!;
    const baseThreshold = this.resolveThreshold(categoryId, date);

    // Calculate new carry: existing carry + (base threshold - total spent)
    let newCarry = state.carryBalance + (baseThreshold - totalSpent);

    // Apply carry-over rule: if positive carry and carryOver is OFF, zero it out
    if (newCarry > 0 && !config.carryOver) {
      newCarry = 0;
    }

    // Apply carry-under rule: if negative carry and carryUnder is OFF, zero it out
    if (newCarry < 0 && !config.carryUnder) {
      newCarry = 0;
    }

    state.carryBalance = newCarry;

    // Check if a threshold change with resetCarry applies at this date
    for (const change of config.thresholdChanges) {
      if (change.resetCarry && dayjs.utc(change.date).isSame(dayjs.utc(date), 'day')) {
        state.carryBalance = 0;
        break;
      }
    }
  }

  /**
   * Resets period spending for the given category to 0.
   */
  resetPeriodSpending(categoryId: string): void {
    const state = this.categoryStates.get(categoryId);
    if (!state) {
      throw new Error(`SpendingTrackerManager: no state for category ID "${categoryId}"`);
    }
    state.periodSpending = 0;
  }

  /**
   * Marks a period as processed for the given category, so that recordSegmentActivities
   * will only accumulate activities after this date. This prevents double-counting
   * of spending across segment boundaries when a spending tracker event fires mid-segment.
   */
  markPeriodProcessed(categoryId: string, periodEnd: Date): void {
    const state = this.categoryStates.get(categoryId);
    if (!state) {
      throw new Error(`SpendingTrackerManager: no state for category ID "${categoryId}"`);
    }
    state.lastProcessedPeriodEnd = periodEnd;
  }

  /**
   * Iterates over all activities in a segment result and accumulates spending
   * (absolute value of negative amounts only) into the correct category's periodSpending.
   */
  recordSegmentActivities(segmentResult: SegmentResult): void {
    const managedCategoryIds = new Set(this.resolvedCategories.keys());

    for (const [, activities] of segmentResult.activitiesAdded) {
      for (const activity of activities) {
        // Only count activities with a spending category that we manage
        if (!activity.spendingCategory || !managedCategoryIds.has(activity.spendingCategory)) {
          continue;
        }

        const amount = typeof activity.amount === 'number' ? activity.amount : 0;
        if (amount === 0) {
          continue;
        }

        const state = this.categoryStates.get(activity.spendingCategory)!;

        // Skip activities that were already counted in a processed period.
        // If lastProcessedPeriodEnd is set, only accumulate activities AFTER that date.
        if (state.lastProcessedPeriodEnd) {
          const activityDate = dayjs.utc(activity.date);
          if (!activityDate.isAfter(dayjs.utc(state.lastProcessedPeriodEnd), 'day')) {
            continue;
          }
        }

        // Negative amounts (expenses) increase periodSpending; positive amounts (refunds) decrease it.
        // Since amount is negative for expenses: -(-50) = +50 (adds spending)
        // Since amount is positive for refunds: -(+25) = -25 (reduces spending)
        // periodSpending CAN go negative when refunds exceed expenses. Negative periodSpending
        // means the effective budget increases (refunds add to remaining budget).
        state.periodSpending -= amount;
      }
    }
  }

  /**
   * Returns accumulated period spending for the given category.
   */
  getPeriodSpending(categoryId: string): number {
    const state = this.categoryStates.get(categoryId);
    if (!state) {
      throw new Error(`SpendingTrackerManager: no state for category ID "${categoryId}"`);
    }
    return state.periodSpending;
  }

  /**
   * Deep-copy carry balance and period spending for all categories (for checkpoint/restore).
   */
  checkpoint(): void {
    for (const [, state] of this.categoryStates) {
      state.checkpointCarryBalance = state.carryBalance;
      state.checkpointPeriodSpending = state.periodSpending;
      state.checkpointLastProcessedPeriodEnd = state.lastProcessedPeriodEnd;
    }
  }

  /**
   * Restore carry balance and period spending from checkpoint for all categories.
   */
  restore(): void {
    for (const [, state] of this.categoryStates) {
      state.carryBalance = state.checkpointCarryBalance;
      state.periodSpending = state.checkpointPeriodSpending;
      state.lastProcessedPeriodEnd = state.checkpointLastProcessedPeriodEnd;
    }
  }

  /**
   * Computes chart data for a spending tracker category by replaying the carry
   * logic over consolidated activities within a date range.
   *
   * This is a static "replay" method — it resolves all variable-backed fields,
   * generates period boundaries, filters activities, and computes per-period
   * spending/threshold/carry data for chart visualization.
   *
   * @param category - The spending tracker category definition
   * @param consolidatedActivities - All consolidated activities from the calculation engine
   * @param dateRange - The chart display date range (startDate, endDate)
   * @param calculationStartDate - The engine's actualStartDate (inflation anchor)
   * @param simulation - The simulation name for variable resolution
   * @returns ChartDataResponse with per-period data and summary statistics
   */
  static computeChartData(
    category: SpendingTrackerCategory,
    consolidatedActivities: ConsolidatedActivity[],
    dateRange: { startDate: string; endDate: string },
    calculationStartDate: string,
    simulation: string,
  ): ChartDataResponse {
    // 1. Resolve all variable-backed fields
    const resolvedThreshold = loadNumberOrVariable(
      category.threshold,
      category.thresholdIsVariable,
      category.thresholdVariable,
      simulation,
    );
    if (typeof resolvedThreshold.amount !== 'number') {
      throw new Error(`computeChartData: threshold for category "${category.name}" resolved to non-numeric value`);
    }

    const resolvedIncreaseBy = loadNumberOrVariable(
      category.increaseBy,
      category.increaseByIsVariable,
      category.increaseByVariable,
      simulation,
    );
    if (typeof resolvedIncreaseBy.amount !== 'number') {
      throw new Error(`computeChartData: increaseBy for category "${category.name}" resolved to non-numeric value`);
    }

    const resolvedChanges: ResolvedThresholdChange[] = category.thresholdChanges.map((change) => {
      const resolvedDate = loadDateOrVariable(
        change.date as DateString,
        change.dateIsVariable,
        change.dateVariable,
        simulation,
      );
      const resolvedNewThreshold = loadNumberOrVariable(
        change.newThreshold,
        change.newThresholdIsVariable,
        change.newThresholdVariable,
        simulation,
      );
      if (typeof resolvedNewThreshold.amount !== 'number') {
        throw new Error(`computeChartData: threshold change newThreshold for category "${category.name}" resolved to non-numeric value`);
      }
      return {
        date: resolvedDate.date,
        newThreshold: resolvedNewThreshold.amount as number,
        resetCarry: change.resetCarry,
      };
    });

    // Sort threshold changes chronologically
    resolvedChanges.sort((a, b) => a.date.getTime() - b.date.getTime());

    const baseThreshold = resolvedThreshold.amount as number;
    const increaseBy = resolvedIncreaseBy.amount as number;
    const increaseByDate = category.increaseByDate;
    const startDateObj = new Date(dateRange.startDate + 'T12:00:00Z');
    const endDateObj = new Date(dateRange.endDate + 'T12:00:00Z');
    const calcStartDateObj = new Date(calculationStartDate + 'T12:00:00Z');

    // 2. Generate period boundaries
    const periods = computePeriodBoundaries(
      category.interval,
      category.intervalStart,
      startDateObj,
      endDateObj,
    );

    if (periods.length === 0) {
      return {
        periods: [],
        nextPeriodThreshold: 0,
        cumulativeSpent: 0,
        cumulativeThreshold: 0,
      };
    }

    // 3. Process each period
    const today = dayjs.utc();
    let carryBalance = 0;
    let cumulativeSpent = 0;
    let cumulativeThreshold = 0;
    const chartPoints: ChartDataPoint[] = [];

    for (const period of periods) {
      const periodStartDayjs = dayjs.utc(period.periodStart);
      const periodEndDayjs = dayjs.utc(period.periodEnd);

      // Filter activities for this period and category
      const periodActivities = consolidatedActivities.filter((activity) => {
        // Exact match on category ID
        if (activity.spendingCategory !== category.id) {
          return false;
        }
        const activityDate = dayjs.utc(activity.date);
        return !activityDate.isBefore(periodStartDayjs, 'day') && !activityDate.isAfter(periodEndDayjs, 'day');
      });

      // Sum spending using the same logic as recordSegmentActivities:
      // periodSpending -= amount
      // Negative amounts (expenses): -(-50) = +50 (increases spending)
      // Positive amounts (refunds): -(+25) = -25 (decreases spending)
      let totalSpent = 0;
      for (const activity of periodActivities) {
        const amount = typeof activity.amount === 'number' ? activity.amount : 0;
        if (amount === 0) {
          continue;
        }
        totalSpent -= amount;
      }

      // Compute base threshold at the period end date using resolveThresholdAtDate
      const periodBaseThreshold = SpendingTrackerManager.resolveThresholdAtDate(
        baseThreshold,
        resolvedChanges,
        increaseBy,
        increaseByDate,
        calcStartDateObj,
        period.periodEnd,
      );

      // Compute effective threshold: base + carry, clamped to 0
      const effectiveThreshold = Math.max(0, periodBaseThreshold + carryBalance);

      // Compute remainder
      const remainder = Math.max(0, effectiveThreshold - totalSpent);

      // Update carry balance: same algorithm and ordering as instance updateCarry()
      // 1. Compute new carry from existing carry + (base threshold - total spent)
      let newCarry = carryBalance + (periodBaseThreshold - totalSpent);

      // 2. Apply carry flag clamping
      // If positive carry and carryOver is OFF, zero it out
      if (newCarry > 0 && !category.carryOver) {
        newCarry = 0;
      }

      // If negative carry and carryUnder is OFF, zero it out
      if (newCarry < 0 && !category.carryUnder) {
        newCarry = 0;
      }

      // 3. Set carry balance
      carryBalance = newCarry;

      // 4. THEN check for resetCarry threshold changes within this period (reset wins)
      for (const change of resolvedChanges) {
        const changeDayjs = dayjs.utc(change.date);
        if (
          change.resetCarry &&
          !changeDayjs.isBefore(periodStartDayjs, 'day') &&
          !changeDayjs.isAfter(periodEndDayjs, 'day')
        ) {
          carryBalance = 0;
          break;
        }
      }

      // Determine if this is the current period
      const isCurrent = !today.isBefore(periodStartDayjs, 'day') && !today.isAfter(periodEndDayjs, 'day');

      // Accumulate cumulative totals
      cumulativeSpent += totalSpent;
      cumulativeThreshold += effectiveThreshold;

      chartPoints.push({
        periodStart: formatDate(period.periodStart),
        periodEnd: formatDate(period.periodEnd),
        totalSpent,
        baseThreshold: periodBaseThreshold,
        effectiveThreshold,
        remainder,
        carryAfter: carryBalance,
        isCurrent,
      });
    }

    // 4. Compute nextPeriodThreshold: effective threshold for the period after the last one
    const lastPeriod = periods[periods.length - 1];
    // Generate one more period to find the next period start date
    const extendedEnd = dayjs.utc(lastPeriod.periodEnd).add(1, 'year').toDate();
    const extendedPeriods = computePeriodBoundaries(
      category.interval,
      category.intervalStart,
      dayjs.utc(lastPeriod.periodEnd).add(1, 'day').toDate(),
      extendedEnd,
    );

    let nextPeriodThreshold = 0;
    if (extendedPeriods.length > 0) {
      const nextPeriodDate = extendedPeriods[0].periodEnd;
      const nextBaseThreshold = SpendingTrackerManager.resolveThresholdAtDate(
        baseThreshold,
        resolvedChanges,
        increaseBy,
        increaseByDate,
        calcStartDateObj,
        nextPeriodDate,
      );
      nextPeriodThreshold = Math.max(0, nextBaseThreshold + carryBalance);
    }

    return {
      periods: chartPoints,
      nextPeriodThreshold,
      cumulativeSpent,
      cumulativeThreshold,
    };
  }
}
