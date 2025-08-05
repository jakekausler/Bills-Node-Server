import { Account } from '../../data/account/account';
import { formatDate, isAfterOrSame, isBeforeOrSame } from '../date/date';
import { ActivityTransferEvent, EventType, Segment, SegmentResult } from './types';
import { AccountManager } from './account-manager';
import { Activity } from '../../data/activity/activity';
import { BalanceTracker } from './balance-tracker';

export class PushPullHandler {
  private accountManager: AccountManager;
  private balanceTracker: BalanceTracker;

  constructor(accountManager: AccountManager, balanceTracker: BalanceTracker) {
    this.accountManager = accountManager;
    this.balanceTracker = balanceTracker;
  }

  /**
   * Handles account push/pull events
   */
  handleAccountPushPulls(segmentResult: SegmentResult, segment: Segment): boolean {
    let pushPullEventAdded = false;
    for (const accountId of segment.affectedAccountIds) {
      const account = this.accountManager.getAccountById(accountId);
      if (!account) {
        console.warn(`Account with ID ${accountId} not found in segment ${segment.id}`);
        continue;
      }

      // Skip accounts that do not perform pushes or pulls
      const performsPushes = this.accountPerformsPushes(account, segment.startDate);
      const performsPulls = this.accountPerformsPulls(account, segment.startDate);
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
    let toPush = minBalance - (account.minimumBalance ?? 0) - (account.minimumPullAmount ?? 0) * 4;
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
      const pullableAccount = this.getNextPullableAccount(accountsChecked);
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
        id: `AUTO-PULL_${account.id}_${segment.startDate.getTime()}`,
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
        id: `AUTO-PULL_${account.id}_${segment.startDate.getTime()}`,
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

    return pullAmount > 0; // Return true if a pull event was added
  }

  private getNextPullableAccount(accountsChecked: Set<string>): Account | undefined {
    return (
      this.accountManager
        .getPullableAccounts()
        .filter(
          (a) => this.balanceTracker.getAccountBalance(a.id) > (a.minimumBalance ?? 0) && !accountsChecked.has(a.id),
        )
        .sort((a, b) => a.pullPriority - b.pullPriority)[0] ?? null
    );
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
    // Push needed if the minimum balance is greater than the minimum balance + 4 times the minimum pull amount
    let pushNeeded =
      performsPushes &&
      account.minimumBalance &&
      minBalance > account.minimumBalance + (account.minimumPullAmount ?? 0) * 4;
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
  private accountPerformsPushes(account: Account, segmentStartDate: Date): boolean {
    return (
      account.performsPushes &&
      isAfterOrSame(segmentStartDate, new Date()) &&
      (!account.pushStart || isBeforeOrSame(account.pushStart, segmentStartDate))
    );
  }

  /**
   * Checks if the account performs pulls based on its configuration
   */
  private accountPerformsPulls(account: Account, segmentStartDate: Date): boolean {
    return (
      account.performsPulls &&
      isAfterOrSame(segmentStartDate, new Date()) &&
      (!account.pushStart || isBeforeOrSame(account.pushStart, segmentStartDate))
    );
  }
}
