import { Account } from '../../data/account/account';
import { CacheManager } from './cache';
import { BalanceSnapshot, SegmentResult } from './types';
import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { minDate } from '../io/minDate';
import { log, warn } from '../calculate-v2/logger';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';

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
    this.accounts = [...accounts]; // Shallow copy to avoid mutations
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

  applySegmentResult(segmentResult: SegmentResult): void {
    // Apply balance changes
    for (const [accountId, change] of segmentResult.balanceChanges) {
      this.updateBalance(accountId, change);
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

  updateBalance(accountId: string, amount: number): void {
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
}
