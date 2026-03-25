import { Account } from '../../data/account/account';
import { CacheManager } from './cache';
import { BalanceSnapshot, SegmentResult } from './types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AccountsAndTransfers } from '../../data/account/types';
import { minDate } from '../io/minDate';
import { isSame } from '../date/date';
import type { DebugLogger } from './debug-logger';

dayjs.extend(utc);

export class BalanceTracker {
  private accounts: Account[];
  private cache: CacheManager;
  private startDate: Date | null;
  private accountMap: Map<string, Account>;

  // Current state
  private balances: Record<string, number> = {};
  private activityIndices: Record<string, number> = {};
  private lastSnapshotDate: Date | null = null;
  private snapshotInterval: number = 30; // days
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(accounts: Account[], cache: CacheManager, startDate: Date | null = null, debugLogger?: DebugLogger | null, simNumber: number = 0) {
    // Deep clone accounts to avoid mutations affecting other parallel calculations
    this.accounts = accounts.map((account) => new Account(account.serialize()));
    this.cache = cache;
    this.startDate = startDate;
    // Build index map for O(1) account lookups
    this.accountMap = new Map(this.accounts.flatMap((acc) => [[acc.id, acc], [acc.name, acc]]));
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'balance-tracker', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  async initializeBalances(
    accountsAndTransfers: AccountsAndTransfers,
    forceRecalculate: boolean = false,
  ): Promise<void> {
    const targetDate = this.startDate || minDate(accountsAndTransfers);

    // Try to find a cached snapshot close to our start date
    const snapshot = await this.findClosestSnapshot(targetDate);

    if (!forceRecalculate && snapshot && this.isSnapshotUsable(snapshot, targetDate)) {
      this.restoreFromSnapshot(snapshot);
    } else {
      this.initializeFromScratch();
    }

    this.log('balances-initialized', { accountCount: this.accounts.length, startDate: targetDate.toISOString() });

    // Create initial snapshot if none exists
    if (!snapshot) {
      await this.createSnapshot(targetDate);
    }
  }

  private initializeFromScratch(): void {
    for (const account of this.accounts) {
      this.balances[account.id] = 0;
      this.activityIndices[account.id] = 0;
    }
    this.lastSnapshotDate = null;
  }

  private async findClosestSnapshot(targetDate: Date): Promise<BalanceSnapshot | null> {
    const result = await this.cache.findClosestSnapshot(targetDate);
    return result ? result.snapshot : null;
  }

  private isSnapshotUsable(snapshot: BalanceSnapshot, targetDate: Date): boolean {
    // Snapshot is usable if it's not too far in the future
    const snapshotDate = snapshot.date instanceof Date ? snapshot.date : new Date(snapshot.date);
    const snapshotTime = snapshotDate.getTime();
    const targetTime = targetDate.getTime();

    // Don't use snapshots from the future
    if (snapshotTime > targetTime) {
      return false;
    }

    // Don't use snapshots that are too old (more than 1 year)
    const daysDiff = dayjs.utc(targetDate).diff(dayjs.utc(snapshotDate), 'day');
    return daysDiff <= 365;
  }

  private async createSnapshot(date: Date): Promise<string> {
    const snapshot: BalanceSnapshot = {
      date,
      balances: { ...this.balances },
      activityIndices: { ...this.activityIndices },
      processedEventIds: new Set(),
    };

    const key = await this.cache.setBalanceSnapshot(date, snapshot);
    this.lastSnapshotDate = new Date(date);
    this.log('snapshot-created', { date: date.toISOString(), accountCount: Object.keys(this.balances).length });

    return key;
  }

  async createSnapshotIfNeeded(date: Date): Promise<string | null> {
    if (
      !this.lastSnapshotDate ||
      dayjs.utc(date).diff(dayjs.utc(this.lastSnapshotDate), 'day') > this.snapshotInterval
    ) {
      return await this.createSnapshot(date);
    }

    const daysSinceLastSnapshot = dayjs.utc(date).diff(dayjs.utc(this.lastSnapshotDate), 'day');
    if (daysSinceLastSnapshot > this.snapshotInterval) {
      return await this.createSnapshot(date);
    }

    return null;
  }

  private restoreFromSnapshot(snapshot: BalanceSnapshot): void {
    this.balances = { ...snapshot.balances };
    this.activityIndices = { ...snapshot.activityIndices };
    this.lastSnapshotDate = snapshot.date instanceof Date ? snapshot.date : new Date(snapshot.date);
    this.log('snapshot-restored', {
      snapshotDate: this.lastSnapshotDate.toISOString(),
      accountCount: Object.keys(this.balances).length,
    });
  }

  /**
   * Get the accounts with consolidated activities filtered to the given date range
   * @param startDate - The start date of the date range
   * @param endDate - The end date of the date range
   * @returns The accounts with consolidated activities filtered to the given date range
   */
  getAccountsWithFilteredDates(startDate: Date | null, endDate: Date): Account[] {
    // Clone accounts before filtering to avoid mutating the source data
    return this.accounts.map((account) => {
      // Create a deep clone of the account with consolidatedActivity
      const clonedAccount = new Account(account.serialize(true));

      if (!clonedAccount.consolidatedActivity) {
        clonedAccount.consolidatedActivity = [];
      }

      let runningBalance = 0;

      const allActivitiesWithBalances = clonedAccount.consolidatedActivity.map((activity) => {
        const effectiveAmount = (activity as any).isPaycheckActivity && (activity as any).paycheckDetails?.netPay
          ? (activity as any).paycheckDetails.netPay
          : Number(activity.amount);
        activity.balance = runningBalance + effectiveAmount;
        runningBalance = activity.balance;
        return activity;
      });

      // Filter activities to the specified date range
      clonedAccount.consolidatedActivity = allActivitiesWithBalances.filter((activity) => {
        // Use day-based comparison in UTC to avoid timezone/timestamp precision issues.
        // IMPORTANT: Must use dayjs.utc() not dayjs() to prevent local-timezone shifts
        // where midnight UTC dates appear as the previous day in US timezones.
        const activityDate = dayjs.utc(activity.date).startOf('day');
        const filterStartDate = startDate ? dayjs.utc(startDate).startOf('day') : null;
        const filterEndDate = endDate ? dayjs.utc(endDate).startOf('day') : null;

        const afterStart = !filterStartDate || activityDate.isAfter(filterStartDate) || activityDate.isSame(filterStartDate);
        const beforeEnd = !filterEndDate || activityDate.isBefore(filterEndDate) || activityDate.isSame(filterEndDate);

        return afterStart && beforeEnd;
      });

      return clonedAccount;
    });
  }

  applySegmentResult(segmentResult: SegmentResult, date: Date): void {
    let activitiesAddedCount = 0;
    for (const [, activities] of segmentResult.activitiesAdded) {
      activitiesAddedCount += activities.length;
    }
    this.log('segment-applied', { balanceChangesCount: segmentResult.balanceChanges.size, activitiesAddedCount });

    // Apply balance changes (resolve name to ID if needed)
    for (const [accountId, change] of segmentResult.balanceChanges) {
      const resolvedAccount = this.findAccountById(accountId);
      const resolvedId = resolvedAccount ? resolvedAccount.id : accountId;
      this.updateBalance(resolvedId, change, date);
    }

    // Apply activity additions (resolve name to ID if needed)
    for (const [accountId, activities] of segmentResult.activitiesAdded) {
      const account = this.findAccountById(accountId);
      if (account) {
        account.consolidatedActivity.push(...activities);
        this.updateActivityIndex(account.id, activities.length);
      } else {
        this.log('account-not-found-for-activities', { accountId });
      }
    }
  }

  updateBalance(accountId: string, amount: number, date: Date): void {
    if (!Object.prototype.hasOwnProperty.call(this.balances, accountId)) {
      this.balances[accountId] = 0;
    }
    this.balances[accountId] += amount;
  }

  updateActivityIndex(accountId: string, increment: number = 1): void {
    this.activityIndices[accountId] = (this.activityIndices[accountId] || 0) + increment;
  }

  /**
   * Gets current balance for a specific account
   */
  getAccountBalance(accountId: string): number {
    return this.balances[accountId] || 0;
  }

  /**
   * Gets the effective balance for an account, accounting for in-flight
   * segment changes that haven't been applied yet.
   * This is critical for events like Roth conversions that run at the end
   * of a segment — the base balance is stale (set before the segment started),
   * so we must add any pending balance changes from the current segment.
   */
  getEffectiveBalance(accountId: string, segmentResult?: SegmentResult): number {
    const base = this.balances[accountId] || 0;
    const change = segmentResult?.balanceChanges?.get(accountId) || 0;
    return base + change;
  }

  /**
   * Gets the account by id
   */
  findAccountById(accountId: string): Account | undefined {
    return this.accountMap.get(accountId);
  }

  /**
   * Gets the balance range for an account based on the segment result
   */
  getAccountBalanceRange(accountId: string, segmentResult: SegmentResult): { min: number; max: number } {
    // Initialize running balance, min and max with current balance
    let balance = this.getAccountBalance(accountId);
    let min = balance;
    let max = balance;

    // Get activities added for the account in the segment result
    const activities = segmentResult.activitiesAdded.get(accountId) || [];

    // Used to track the last activity added to the balance to check if we have a new date
    let lastActivityDate: Date | null = null;

    // Loop over all activities added in the segment result
    // Use their amounts to calculate the new balance after each activity
    // If the activity is the last on a day, it will be the final balance for that day
    // Use the final balance on each day to calculate the min and max
    for (const activity of activities) {
      const activityDate = new Date(activity.date);
      if (lastActivityDate && !isSame(lastActivityDate, activityDate)) {
        // If we have a new date, finalize the last day's balance
        if (balance !== null) {
          min = Math.min(min, balance);
          max = Math.max(max, balance);
        }
      }

      // Update balance with the activity amount
      balance += Number(activity.amount);
      lastActivityDate = activityDate;
    }
    // Finalize the last day's balance
    if (balance !== null) {
      min = Math.min(min, balance);
      max = Math.max(max, balance);
    }

    this.log('balance-range-calculated', { accountId, min, max });
    return { min, max };
  }
}
