import { Account } from '../../data/account/account';
import { formatDate, isAfterOrSame, isBeforeOrSame } from '../date/date';
import { ActivityTransferEvent, EventType, Segment, SegmentResult } from './types';
import { AccountManager } from './account-manager';
import { Activity } from '../../data/activity/activity';
import { BalanceTracker } from './balance-tracker';

export interface PullFailure {
  date: Date;
  accountId: string;
  shortfall: number;
}

export class PushPullHandler {
  private accountManager: AccountManager;
  private balanceTracker: BalanceTracker;
  private pullFailures: PullFailure[] = [];
  private withdrawalStrategy: 'manual' | 'taxOptimized' = 'manual';

  constructor(accountManager: AccountManager, balanceTracker: BalanceTracker, withdrawalStrategy?: 'manual' | 'taxOptimized') {
    this.accountManager = accountManager;
    this.balanceTracker = balanceTracker;
    this.withdrawalStrategy = withdrawalStrategy || 'manual';
  }

  /**
   * Handles account push/pull events
   */
  handleAccountPushPulls(segmentResult: SegmentResult, segment: Segment, referenceDate: Date): boolean {
    let pushPullEventAdded = false;
    for (const accountId of segment.affectedAccountIds) {
      const account = this.accountManager.getAccountById(accountId);
      if (!account) {
        console.warn(`Account with ID ${accountId} not found in segment ${segment.id}`);
        continue;
      }

      // Skip accounts that do not perform pushes or pulls
      const performsPushes = this.accountPerformsPushes(account, segment.startDate, referenceDate);
      const performsPulls = this.accountPerformsPulls(account, segment.startDate, referenceDate);
      if (!performsPushes && !performsPulls) {
        continue;
      }

      // Check if the account needs a push or pull based on its balance
      const min = segmentResult.balanceMinimums.get(account.id) || 0;
      const max = segmentResult.balanceMaximums.get(account.id) || 0;
      const { pushNeeded, pullNeeded } = this.checkPushPullRequirements(
        account,
        min,
        max,
        performsPushes,
        performsPulls,
      );

      // If push or pull is needed, add the corresponding event
      if (pushNeeded && performsPushes) {
        if (this.addPushEvents(segment, account, min)) {
          pushPullEventAdded = true;
        }
      } else if (pullNeeded && performsPulls) {
        if (this.addPullEvents(segment, account, min)) {
          pushPullEventAdded = true;
        }
      }
    }

    return pushPullEventAdded;
  }

  /**
   * Adds push events to the segment
   */
  private addPushEvents(segment: Segment, account: Account, minBalance: number): boolean {
    // Calculate the amount to push
    let pushAmount = 0;
    let toPush = minBalance - (account.maximumBalance ?? 0);
    if (toPush <= 0) {
      return false;
    }
    pushAmount = toPush;

    // Get the account to push to
    const pushAccount = this.accountManager.getAccountByName(account.pushAccount ?? '');
    if (!pushAccount) {
      console.warn(`Push account ${account.pushAccount} not found for account ${account.name}`);
      return false;
    }

    // Create the push activity
    const pushActivity = new Activity({
      id: `AUTO-PUSH_${account.id}_${segment.startDate.getTime()}`,
      name: `Auto Push to ${pushAccount.name}`,
      amount: pushAmount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(segment.startDate),
      dateIsVariable: false,
      dateVariable: null,
      from: account.name,
      to: pushAccount.name,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: true,
      flagColor: 'indigo',
    });

    // Create the push event
    const pushEvent: ActivityTransferEvent = {
      id: `AUTO-PUSH_${account.id}_${segment.startDate.getTime()}`,
      type: EventType.activityTransfer,
      date: segment.startDate,
      accountId: account.id,
      fromAccountId: account.id,
      toAccountId: pushAccount.id,
      priority: 0,
      originalActivity: pushActivity,
    };

    // Add the push event to the segment
    segment.events.push(pushEvent);

    return true;
  }

  /**
   * Adds pull events to the segment
   */
  private addPullEvents(segment: Segment, account: Account, minBalance: number): boolean {
    // Calculate the amount to pull
    let pullAmount = 0;
    let toPull = Math.abs(minBalance - (account.minimumBalance ?? 0));
    if (toPull <= 0) {
      return false;
    }
    toPull = Math.max(toPull, account.minimumPullAmount ?? 0);
    const accountsChecked = new Set<string>();

    // Continue pulling until the amount to pull is 0 or no more pullable accounts are found
    while (toPull > 0) {
      const pullableAccount = this.getNextPullableAccount(accountsChecked, segment.startDate);
      accountsChecked.add(pullableAccount?.id ?? '');
      if (!pullableAccount) {
        break;
      }

      // Calculate the amount available to pull from the pullable account
      const pullableAccountBalance = this.balanceTracker.getAccountBalance(pullableAccount.id);
      const availableAmount = Math.min(toPull, pullableAccountBalance - (pullableAccount.minimumBalance ?? 0));

      // If no amount is available, break
      if (availableAmount <= 0) {
        break;
      }

      // Update the amount to pull and the amount pulled
      pullAmount += availableAmount;
      toPull -= availableAmount;

      // Create the pull activity
      const pullActivity = new Activity({
        id: `AUTO-PULL_${account.id}_from_${pullableAccount.id}_${segment.startDate.getTime()}`,
        name: `Auto Pull from ${pullableAccount.name}`,
        amount: availableAmount,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(segment.startDate),
        dateIsVariable: false,
        dateVariable: null,
        from: pullableAccount.name,
        to: account.name,
        isTransfer: true,
        category: 'Ignore.Transfer',
        flag: true,
        flagColor: 'indigo',
      });

      // Create the pull event
      const pullEvent: ActivityTransferEvent = {
        id: `AUTO-PULL_${account.id}_from_${pullableAccount.id}_${segment.startDate.getTime()}`,
        type: EventType.activityTransfer,
        date: segment.startDate,
        accountId: account.id,
        fromAccountId: pullableAccount.id,
        toAccountId: account.id,
        priority: 0,
        originalActivity: pullActivity,
      };

      // Add the pull event to the segment
      segment.events.push(pullEvent);
    }

    // Track pull failure if we couldn't get enough funds
    if (toPull > 0) {
      this.pullFailures.push({
        date: segment.startDate,
        accountId: account.id,
        shortfall: toPull,
      });
    }

    return pullAmount > 0; // Return true if a pull event was added
  }

  private getNextPullableAccount(accountsChecked: Set<string>, segmentDate: Date): Account | undefined {
    const pullable = this.accountManager
      .getPullableAccounts()
      .filter(
        (a) => this.balanceTracker.getAccountBalance(a.id) > (a.minimumBalance ?? 0) && !accountsChecked.has(a.id),
      );

    if (this.withdrawalStrategy === 'taxOptimized') {
      return pullable.sort((a, b) => {
        const scoreA = this.getTaxAwarePriority(a, segmentDate);
        const scoreB = this.getTaxAwarePriority(b, segmentDate);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.pullPriority - b.pullPriority; // Tiebreaker
      })[0] ?? undefined;
    }

    return pullable.sort((a, b) => a.pullPriority - b.pullPriority)[0] ?? undefined;
  }

  /**
   * Calculate tax-aware priority for an account (lower = higher priority to pull)
   *
   * Pre-59.5 (penalty applies):
   *  10 - Taxable accounts (checking, savings, brokerage)
   *  50 - Roth contributions (tax-free, penalty-free)
   * 100 - Tax-deferred WITH penalty (401k/IRA before 59.5)
   *
   * Post-59.5 (no penalty):
   *  10 - Taxable accounts (fill low brackets)
   *  40 - Tax-deferred (ordinary income)
   *  50 - Roth (preserve tax-free growth)
   */
  private getTaxAwarePriority(account: Account, date: Date): number {
    const isPreTax = account.usesRMD; // 401k, traditional IRA
    const isRoth = account.name.toLowerCase().includes('roth'); // Heuristic for Roth accounts
    const hasPenalty = account.earlyWithdrawalPenalty > 0 &&
      account.earlyWithdrawalDate &&
      date < account.earlyWithdrawalDate;

    // Penalty era (pre-59.5): Roth contributions get high priority, penalty accounts avoided
    if (hasPenalty) {
      if (isRoth) return 50; // Roth: pull contributions (tax-free, penalty-free)
      if (isPreTax) return 100; // Pre-tax with penalty: absolute last resort
      return 10; // Taxable: pull first (no tax consequence on principal)
    }

    // No penalty (post-59.5): preserve Roth growth, use taxable/pre-tax first
    if (isRoth) return 50; // Roth: pull last to preserve tax-free growth
    if (isPreTax) return 40; // Pre-tax: ordinary income, no penalty
    return 10; // Taxable: fill low brackets first
  }

  /**
   * Checks if the account needs a push or pull based on its balance
   */
  private checkPushPullRequirements(
    account: Account,
    minBalance: number,
    _maxBalance: number,
    performsPushes: boolean,
    performsPulls: boolean,
  ): { pushNeeded: boolean; pullNeeded: boolean } {
    // Push needed if the minimum balance is greater than the maximum balance
    let pushNeeded =
      performsPushes &&
      account.maximumBalance &&
      minBalance > account.maximumBalance;
    // Pull needed if the minimum balance is less than the minimum balance
    let pullNeeded = performsPulls && account.minimumBalance && minBalance < account.minimumBalance;

    return {
      pushNeeded: !!pushNeeded,
      pullNeeded: !!pullNeeded,
    };
  }

  /**
   * Checks if the account performs pushes based on its configuration
   */
  private accountPerformsPushes(account: Account, segmentStartDate: Date, referenceDate: Date): boolean {
    return (
      account.performsPushes &&
      isAfterOrSame(segmentStartDate, referenceDate) &&
      (!account.pushStart || isBeforeOrSame(account.pushStart, segmentStartDate))
    );
  }

  /**
   * Checks if the account performs pulls based on its configuration
   */
  private accountPerformsPulls(account: Account, segmentStartDate: Date, referenceDate: Date): boolean {
    return (
      account.performsPulls &&
      isAfterOrSame(segmentStartDate, referenceDate) &&
      (!account.pushStart || isBeforeOrSame(account.pushStart, segmentStartDate))
    );
  }

  /**
   * Get all pull failures recorded during processing
   */
  getPullFailures(): PullFailure[] {
    return this.pullFailures;
  }

  /**
   * Reset pull failures (called at start of new calculation)
   */
  resetPullFailures(): void {
    this.pullFailures = [];
  }
}
