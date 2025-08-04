import { Account } from '../../data/account/account';
import { CacheManager } from './cache';
import { BalanceSnapshot, SegmentResult } from './types';
import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { minDate } from '../io/minDate';
import { warn } from '../calculate-v2/logger';
import { isSame } from '../date/date';

export class BalanceTracker {
  private accounts: Account[];
  private cache: CacheManager;
  private startDate: Date | null;

  // Current state
  private balances: Record<string, number> = {};
  private activityIndices: Record<string, number> = {};
  private lastSnapshotDate: Date | null = null;
  private snapshotInterval: number = 30; // days

  constructor(accounts: Account[], cache: CacheManager, startDate: Date | null = null) {
    // Deep clone accounts to avoid mutations affecting other parallel calculations
    this.accounts = accounts.map((account) => new Account(account.serialize()));
    this.cache = cache;
    this.startDate = startDate;
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
  }

  /**
   * Get the accounts with consolidated activities filtered to the given date range
   * @param startDate - The start date of the date range
   * @param endDate - The end date of the date range
   * @returns The accounts with consolidated activities filtered to the given date range
   */
  getAccountsWithFilteredDates(startDate: Date | null, endDate: Date): Account[] {
    return this.accounts.map((account) => {
      if (!account.consolidatedActivity) {
        account.consolidatedActivity = [];
      }

      let runningBalance = 0;

      const allActivitiesWithBalances = account.consolidatedActivity.map((activity, index) => {
        activity.balance = runningBalance + Number(activity.amount);
        runningBalance = activity.balance;
        return activity;
      });

      account.consolidatedActivity = allActivitiesWithBalances.filter((activity) => {
        const activityDate = new Date(activity.date);
        const afterStart = !startDate || activityDate >= startDate;
        const beforeEnd = !endDate || activityDate <= endDate;
        return afterStart && beforeEnd;
      });

      return account;
    });
  }

  applySegmentResult(segmentResult: SegmentResult, date: Date): void {
    // Apply balance changes
    for (const [accountId, change] of segmentResult.balanceChanges) {
      this.updateBalance(accountId, change, date);
    }

    // Apply activity additions
    for (const [accountId, activities] of segmentResult.activitiesAdded) {
      const account = this.findAccountById(accountId);
      if (account) {
        account.consolidatedActivity.push(...activities);
        this.updateActivityIndex(accountId, activities.length);
      } else {
        warn(`[BalanceTracker] Account ${accountId} not found for applying activities`);
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
   * Gets the account by id
   */
  findAccountById(accountId: string): Account | undefined {
    return this.accounts.find((acc) => acc.id === accountId);
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

    return { min, max };
  }
}
