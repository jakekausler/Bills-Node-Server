/**
 * Balance tracking system for optimized financial calculations
 *
 * This module manages account balances throughout the calculation process,
 * providing efficient balance updates, snapshot management, and state tracking
 * to replace the expensive deep copying in the original system.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { createHash } from 'crypto';
import { BalanceSnapshot, InterestState, CalculationAccount } from './types';
import { CacheManager } from './cache';
import { Account } from '../../data/account/account';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { debug, err, warn } from './logger';
import { formatDate } from '../date/date';

dayjs.extend(utc);

/**
 * Manages account balances and state throughout calculation
 */
export class BalanceTracker {
  private accounts: Account[];
  private cache: CacheManager;
  private startDate: Date | null;

  // Current state
  private balances: Record<string, number> = {};
  private activityIndices: Record<string, number> = {};
  private interestStates: Record<string, InterestState> = {};
  private lastSnapshotDate: Date | null = null;
  private snapshotInterval: number = 30; // days

  constructor(accounts: Account[], cache: CacheManager, startDate: Date | null = null) {
    this.accounts = [...accounts]; // Shallow copy to avoid mutations
    this.cache = cache;
    this.startDate = startDate;
  }

  /**
   * Initializes balances from account data or snapshots
   */
  async initializeBalances(): Promise<void> {
    const targetDate = this.startDate || this.getEarliestDate();

    // Try to find a cached snapshot close to our start date
    const snapshot = await this.findClosestSnapshot(targetDate);

    if (snapshot && this.isSnapshotUsable(snapshot, targetDate)) {
      this.restoreFromSnapshot(snapshot);
    } else {
      this.initializeFromScratch();
    }

    // Create initial snapshot if none exists
    if (!snapshot) {
      await this.createSnapshot(targetDate);
    }
  }

  /**
   * Initializes balances from scratch (beginning of data)
   */
  private initializeFromScratch(): void {
    for (const account of this.accounts) {
      this.balances[account.id] = 0;
      this.activityIndices[account.id] = 0;

      // Initialize interest state
      this.interestStates[account.id] = {
        currentInterest: account.interests.length > 0 ? account.interests[0] : null,
        interestIndex: 0,
        nextInterestDate: account.interests.length > 0 ? account.interests[0].applicableDate : null,
        accumulatedTaxableInterest: 0,
      };

      // Start with 0 balance - Opening Balance activities will be processed as events
      // This prevents double-counting the Opening Balance
      // (Previous logic incorrectly set starting balance to Opening Balance amount,
      //  then added Opening Balance activity again during calculation)
    }
  }

  /**
   * Restores state from a balance snapshot
   */
  private restoreFromSnapshot(snapshot: BalanceSnapshot): void {
    this.balances = { ...snapshot.balances };
    this.activityIndices = { ...snapshot.activityIndices };
    this.interestStates = {};

    // Deep copy interest states
    for (const [accountId, state] of Object.entries(snapshot.interestStates)) {
      this.interestStates[accountId] = {
        currentInterest: state.currentInterest,
        interestIndex: state.interestIndex,
        nextInterestDate: state.nextInterestDate ? new Date(state.nextInterestDate) : null,
        accumulatedTaxableInterest: state.accumulatedTaxableInterest,
      };
    }

    this.lastSnapshotDate = snapshot.date instanceof Date ? snapshot.date : new Date(snapshot.date);
  }

  /**
   * Gets current balances for all accounts
   */
  getCurrentBalances(): Record<string, number> {
    try {
      const result = { ...this.balances };

      return result;
    } catch (error) {
      err('[BalanceTracker] Error in getCurrentBalances:', error);
      throw error;
    }
  }

  /**
   * Gets current balance for a specific account
   */
  getAccountBalance(accountId: string): number {
    return this.balances[accountId] || 0;
  }

  /**
   * Updates balance for an account
   */
  updateBalance(accountId: string, amount: number): void {
    if (!Object.prototype.hasOwnProperty.call(this.balances, accountId)) {
      this.balances[accountId] = 0;
    }
    this.balances[accountId] += amount;
  }

  /**
   * Sets absolute balance for an account
   */
  setBalance(accountId: string, balance: number): void {
    this.balances[accountId] = balance;
  }

  /**
   * Gets current activity index for an account
   */
  getActivityIndex(accountId: string): number {
    return this.activityIndices[accountId] || 0;
  }

  /**
   * Updates activity index for an account
   */
  updateActivityIndex(accountId: string, increment: number = 1): void {
    this.activityIndices[accountId] = (this.activityIndices[accountId] || 0) + increment;
  }

  /**
   * Sets absolute activity index for an account
   */
  setActivityIndex(accountId: string, index: number): void {
    this.activityIndices[accountId] = index;
  }

  /**
   * Gets current interest state for an account
   */
  getInterestState(accountId: string): InterestState | null {
    return this.interestStates[accountId] || null;
  }

  /**
   * Updates interest state for an account
   */
  updateInterestState(accountId: string, updates: Partial<InterestState>): void {
    if (!this.interestStates[accountId]) {
      this.interestStates[accountId] = {
        currentInterest: null,
        interestIndex: 0,
        nextInterestDate: null,
        accumulatedTaxableInterest: 0,
      };
    }

    Object.assign(this.interestStates[accountId], updates);
  }

  /**
   * Advances to the next interest configuration for an account
   */
  advanceInterest(accountId: string): void {
    const account = this.accounts.find((acc) => acc.id === accountId);
    if (!account) return;

    const state = this.interestStates[accountId];
    if (!state) return;

    state.interestIndex++;

    if (state.interestIndex < account.interests.length) {
      state.currentInterest = account.interests[state.interestIndex];
      state.nextInterestDate = state.currentInterest.applicableDate;
    } else {
      state.currentInterest = null;
      state.nextInterestDate = null;
    }
  }

  /**
   * Adds accumulated taxable interest for an account
   */
  addTaxableInterest(accountId: string, amount: number): void {
    if (!this.interestStates[accountId]) {
      this.interestStates[accountId] = {
        currentInterest: null,
        interestIndex: 0,
        nextInterestDate: null,
        accumulatedTaxableInterest: 0,
      };
    }

    this.interestStates[accountId].accumulatedTaxableInterest += amount;
  }

  /**
   * Clears accumulated taxable interest for an account (after paying taxes)
   */
  clearTaxableInterest(accountId: string): number {
    const state = this.interestStates[accountId];
    if (!state) return 0;

    const amount = state.accumulatedTaxableInterest;
    state.accumulatedTaxableInterest = 0;
    return amount;
  }

  /**
   * Applies a segment result to the current state
   */
  applySegmentResult(segmentResult: any): void {
    // Apply balance changes
    for (const [accountId, change] of segmentResult.balanceChanges) {
      this.updateBalance(accountId, change);
    }

    // Apply activity additions
    for (const [accountId, activities] of segmentResult.activitiesAdded) {
      const account = this.accounts.find((acc) => acc.id === accountId);
      if (account) {
        account.consolidatedActivity.push(...activities);
        this.updateActivityIndex(accountId, activities.length);
      } else {
        warn(`[BalanceTracker] Account ${accountId} not found for applying activities`);
      }
    }

    // Apply interest state changes
    for (const [accountId, stateChanges] of segmentResult.interestStateChanges) {
      this.updateInterestState(accountId, stateChanges);
    }
  }

  /**
   * Creates a balance snapshot at the current state
   */
  async createSnapshot(date: Date): Promise<string> {
    const snapshot: BalanceSnapshot = {
      date: new Date(date),
      balances: { ...this.balances },
      activityIndices: { ...this.activityIndices },
      interestStates: { ...this.interestStates },
      dataHash: this.calculateStateHash(),
      processedEventIds: new Set(), // This would be populated by the engine
    };

    const key = await this.cache.setBalanceSnapshot(date, snapshot);
    this.lastSnapshotDate = new Date(date);

    return key;
  }

  /**
   * Creates a snapshot if enough time has passed since the last one
   */
  async createSnapshotIfNeeded(currentDate: Date): Promise<string | null> {
    if (!this.lastSnapshotDate) {
      return await this.createSnapshot(currentDate);
    }

    const daysSinceSnapshot = dayjs.utc(currentDate).diff(dayjs.utc(this.lastSnapshotDate), 'day');

    if (daysSinceSnapshot >= this.snapshotInterval) {
      return await this.createSnapshot(currentDate);
    }

    return null;
  }

  /**
   * Gets updated accounts with current consolidated activities
   */
  getUpdatedAccounts(startDate?: Date, endDate?: Date): CalculationAccount[] {
    try {
      return this.accounts.map((account, accountIndex) => {
        try {
          // Get the starting balance for this account (from balance tracker)
          const startingBalance = this.balances[account.id] || 0;
          // Initialize consolidatedActivity if it doesn't exist
          if (!account.consolidatedActivity) {
            account.consolidatedActivity = [];
          }

          // First, calculate running balances for ALL activities to get correct starting balance
          const allActivitiesWithBalances = account.consolidatedActivity.map((activity, index) => {
            try {
              // Calculate running balance up to this activity (starting from 0)
              let runningBalance = 0;

              for (let i = 0; i <= index; i++) {
                const amount = account.consolidatedActivity[i].amount as number;
                if (isNaN(amount)) {
                  warn(`[BalanceTracker] NaN amount found in activity ${i}:`, account.consolidatedActivity[i]);
                }
                runningBalance += amount;
              }

              // Update the activity's balance
              const updatedActivity = new ConsolidatedActivity(activity.serialize());
              updatedActivity.balance = runningBalance;

              return updatedActivity;
            } catch (error) {
              err(`[BalanceTracker] Error processing activity ${index} for account ${account.id}:`, error);
              throw error;
            }
          });

          // Calculate the balance at the start date by including activities before the start date
          let balanceAtStartDate = 0;
          let activitiesToReturn = allActivitiesWithBalances;

          if (startDate || endDate) {
            const originalCount = activitiesToReturn.length;

            // Find all activities before the start date to calculate starting balance
            if (startDate) {
              const activitiesBeforeStart = allActivitiesWithBalances.filter((activity) => {
                const activityDate = new Date(activity.date);
                return activityDate < startDate;
              });

              // The balance at start date is the balance of the last activity before start date
              if (activitiesBeforeStart.length > 0) {
                balanceAtStartDate = activitiesBeforeStart[activitiesBeforeStart.length - 1].balance;
              }
            }

            // Filter activities by date range
            activitiesToReturn = allActivitiesWithBalances.filter((activity) => {
              const activityDate = new Date(activity.date);
              const afterStart = !startDate || activityDate >= startDate;
              const beforeEnd = !endDate || activityDate <= endDate;
              return afterStart && beforeEnd;
            });

            // Adjust the balances of filtered activities to account for the starting balance
            activitiesToReturn = activitiesToReturn.map((activity, index) => {
              const adjustedActivity = new ConsolidatedActivity(activity.serialize());
              // Recalculate balance: starting balance + cumulative amounts up to this activity
              let cumulativeAmount = 0;
              for (let i = 0; i <= index; i++) {
                cumulativeAmount += activitiesToReturn[i].amount as number;
              }
              adjustedActivity.balance = balanceAtStartDate + cumulativeAmount;
              return adjustedActivity;
            });
          }

          // Final account balance is the balance of the last activity in the filtered list,
          // or the balance at start date if no activities in the range
          const finalBalance =
            activitiesToReturn.length > 0
              ? activitiesToReturn[activitiesToReturn.length - 1].balance
              : balanceAtStartDate;

          // Create updated account by mutating the existing account
          account.consolidatedActivity = activitiesToReturn;

          // Add balance property dynamically (Account class doesn't have balance property)
          (account as any).balance = finalBalance;

          return account as CalculationAccount;
        } catch (error) {
          err(`[BalanceTracker] Error processing account ${account.id}:`, error);
          throw error;
        }
      });
    } catch (error) {
      err(`[BalanceTracker] Error in getUpdatedAccounts:`, error);
      throw error;
    }
  }

  /**
   * Validates the current state for consistency
   */
  validateState(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check that all accounts have balance entries
    for (const account of this.accounts) {
      if (!Object.prototype.hasOwnProperty.call(this.balances, account.id)) {
        errors.push(`Missing balance entry for account ${account.id}`);
      }

      if (!Object.prototype.hasOwnProperty.call(this.activityIndices, account.id)) {
        errors.push(`Missing activity index for account ${account.id}`);
      }

      if (!Object.prototype.hasOwnProperty.call(this.interestStates, account.id)) {
        errors.push(`Missing interest state for account ${account.id}`);
      }
    }

    // Check for negative balances where not allowed
    for (const [accountId, balance] of Object.entries(this.balances)) {
      const account = this.accounts.find((acc) => acc.id === accountId);
      if (account && account.type !== 'Credit Card' && balance < 0) {
        const minBalance = account.minimumBalance || 0;
        if (balance < minBalance) {
          errors.push(`Account ${accountId} balance ${balance} below minimum ${minBalance}`);
        }
      }
    }

    // Check activity indices are within bounds
    for (const [accountId, index] of Object.entries(this.activityIndices)) {
      const account = this.accounts.find((acc) => acc.id === accountId);
      if (account && index > account.consolidatedActivity.length) {
        errors.push(
          `Activity index ${index} exceeds activity count ${account.consolidatedActivity.length} for account ${accountId}`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gets statistics about the current state
   */
  getStats(): {
    totalAccounts: number;
    totalBalance: number;
    accountBalances: Record<string, number>;
    totalActivities: number;
    snapshotCount: number;
    lastSnapshotDate: Date | null;
  } {
    const totalBalance = Object.values(this.balances).reduce((sum, balance) => sum + balance, 0);
    const totalActivities = Object.values(this.activityIndices).reduce((sum, index) => sum + index, 0);

    return {
      totalAccounts: this.accounts.length,
      totalBalance,
      accountBalances: { ...this.balances },
      totalActivities,
      snapshotCount: 0, // Would need to track this
      lastSnapshotDate: this.lastSnapshotDate,
    };
  }

  // Private helper methods

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

  private getEarliestDate(): Date {
    let earliest = new Date();

    for (const account of this.accounts) {
      for (const activity of account.activity) {
        if (activity.date < earliest) {
          earliest = activity.date;
        }
      }

      for (const bill of account.bills) {
        if (bill.startDate && bill.startDate < earliest) {
          earliest = bill.startDate;
        }
      }

      for (const interest of account.interests) {
        if (interest.applicableDate && interest.applicableDate < earliest) {
          earliest = interest.applicableDate;
        }
      }
    }

    return earliest;
  }

  private calculateStateHash(): string {
    const stateData = {
      balances: this.balances,
      activityIndices: this.activityIndices,
      interestStates: Object.fromEntries(
        Object.entries(this.interestStates).map(([id, state]) => [
          id,
          {
            interestIndex: state.interestIndex,
            nextInterestDate: state.nextInterestDate?.getTime() || null,
            accumulatedTaxableInterest: state.accumulatedTaxableInterest,
          },
        ]),
      ),
    };

    return createHash('sha256').update(JSON.stringify(stateData)).digest('hex');
  }

  /**
   * Resets the tracker to initial state
   */
  reset(): void {
    this.balances = {};
    this.activityIndices = {};
    this.interestStates = {};
    this.lastSnapshotDate = null;
  }

  /**
   * Creates a deep copy of current state for lookahead calculations
   */
  createStateSnapshot(): {
    balances: Record<string, number>;
    activityIndices: Record<string, number>;
    interestStates: Record<string, InterestState>;
  } {
    return {
      balances: { ...this.balances },
      activityIndices: { ...this.activityIndices },
      interestStates: Object.fromEntries(
        Object.entries(this.interestStates).map(([id, state]) => [
          id,
          { ...state, nextInterestDate: state.nextInterestDate ? new Date(state.nextInterestDate) : null },
        ]),
      ),
    };
  }

  /**
   * Restores state from a snapshot (for lookahead calculations)
   */
  restoreStateSnapshot(snapshot: {
    balances: Record<string, number>;
    activityIndices: Record<string, number>;
    interestStates: Record<string, InterestState>;
  }): void {
    this.balances = { ...snapshot.balances };
    this.activityIndices = { ...snapshot.activityIndices };
    this.interestStates = Object.fromEntries(
      Object.entries(snapshot.interestStates).map(([id, state]) => [
        id,
        { ...state, nextInterestDate: state.nextInterestDate ? new Date(state.nextInterestDate) : null },
      ]),
    );
  }
}
