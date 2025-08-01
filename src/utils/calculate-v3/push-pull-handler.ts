import { Account } from '../../data/account/account';
import { warn } from '../calculate-v2/logger';
import { formatDate, isAfterOrSame, isBeforeOrSame } from '../date/date';
import { BalanceTracker } from './balance-tracker';
import { Timeline } from './timeline';
import { Segment, SegmentResult } from './types';

export class PushPullHandler {
  private balanceTracker: BalanceTracker;
  private timeline: Timeline;

  constructor(balanceTracker: BalanceTracker, timeline: Timeline) {
    this.balanceTracker = balanceTracker;
    this.timeline = timeline;
  }

  /**
   * Handles account push/pull events
   */
  handleAccountPushPulls(segmentResult: SegmentResult, segment: Segment): boolean {
    let pushPullEventAdded = false;
    for (const accountId of segment.affectedAccountIds) {
      const account = this.timeline.getAccountById(accountId);
      if (!account) {
        warn(`Account with ID ${accountId} not found in segment ${segment.id}`);
        continue;
      }

      // Skip accounts that do not perform pushes or pulls
      const performsPushes = this.accountPerformsPushes(account, segment.startDate);
      const performsPulls = this.accountPerformsPulls(account, segment.startDate);
      if (!performsPushes && !performsPulls) {
        continue;
      }

      // Check if the account needs a push or pull based on its balance
      const { min, max } = this.balanceTracker.getAccountBalanceRange(accountId, segmentResult);
      const { pushNeeded, pullNeeded } = this.checkPushPullRequirements(
        account,
        min,
        max,
        performsPushes,
        performsPulls,
      );

      // If push or pull is needed, add the corresponding event
      if (pushNeeded && performsPushes) {
        if (this.addPushEvents(segment, account, max)) {
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
  private addPushEvents(segment: Segment, account: Account, maxBalance: number): boolean {
    console.log(
      `Adding push events for account ${account.name} with max balance ${maxBalance} on segment starting ${formatDate(segment.startDate)}`,
    );
    let pushAmount = 0;
    // TODO: Implement logic to add push events

    return pushAmount > 0; // Return true if a push event was added
  }

  /**
   * Adds pull events to the segment
   */
  private addPullEvents(segment: Segment, account: Account, minBalance: number): boolean {
    console.log(
      `Adding pull events for account ${account.name} with min balance ${minBalance} on segment starting ${formatDate(segment.startDate)}`,
    );
    let pullAmount = 0;
    // TODO: Implement logic to add pull events

    return pullAmount > 0; // Return true if a pull event was added
  }

  /**
   * Checks if the account needs a push or pull based on its balance
   */
  private checkPushPullRequirements(
    account: Account,
    minBalance: number,
    maxBalance: number,
    performsPushes: boolean,
    performsPulls: boolean,
  ): { pushNeeded: boolean; pullNeeded: boolean } {
    let pushNeeded = performsPushes && account.minimumBalance && maxBalance > account.minimumBalance * 4;
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
