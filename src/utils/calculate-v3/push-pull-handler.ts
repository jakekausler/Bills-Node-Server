import { Account } from '../../data/account/account';
import { formatDate, isAfterOrSame, isBeforeOrSame } from '../date/date';
import { ActivityTransferEvent, EventType, Segment, SegmentResult } from './types';
import { AccountManager } from './account-manager';
import { Activity } from '../../data/activity/activity';
import { BalanceTracker } from './balance-tracker';
import { RothConversionManager } from './roth-conversion-manager';
import { TaxManager } from './tax-manager';
import type { DebugLogger } from './debug-logger';
import type { FlowAggregator } from './flow-aggregator';
import type { ManagerPayout } from './manager-payout';

/** Structural type for life insurance manager to avoid circular imports */
interface LifeInsuranceSurrenderSource {
  surrenderForAmount(needed: number, year: number, dateStr: string): ManagerPayout[];
}

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
  private rothConversionManager: RothConversionManager | null;
  private taxManager: TaxManager | null;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private flowAggregator: FlowAggregator | null;
  private lifeInsuranceManager: LifeInsuranceSurrenderSource | null;

  constructor(
    accountManager: AccountManager,
    balanceTracker: BalanceTracker,
    withdrawalStrategy?: 'manual' | 'taxOptimized',
    rothConversionManager?: RothConversionManager,
    taxManager?: TaxManager,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
    flowAggregator?: FlowAggregator | null,
    lifeInsuranceManager?: LifeInsuranceSurrenderSource | null,
  ) {
    this.accountManager = accountManager;
    this.balanceTracker = balanceTracker;
    this.withdrawalStrategy = withdrawalStrategy || 'manual';
    this.rothConversionManager = rothConversionManager || null;
    this.taxManager = taxManager || null;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.flowAggregator = flowAggregator ?? null;
    this.lifeInsuranceManager = lifeInsuranceManager ?? null;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'push-pull', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /**
   * Handles account push/pull events
   */
  handleAccountPushPulls(segmentResult: SegmentResult, segment: Segment, referenceDate: Date): boolean {
    this.currentDate = formatDate(segment.startDate);
    let pushPullEventAdded = false;
    // Track cumulative amounts already committed from each source account
    // so that multiple pull requests in the same segment don't overdraw
    const committedPulls = new Map<string, number>();

    for (const accountId of segment.affectedAccountIds) {
      const account = this.accountManager.getAccountById(accountId);
      if (!account) {
        this.log('account-not-found', { accountId, segmentId: segment.id });
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

      if (pushNeeded) {
        this.log('push-needed', {
          account: account.name,
          balance: min,
          maximum_balance: account.maximumBalance,
          push_amount: min - (account.maximumBalance ?? 0),
        });
      }
      if (pullNeeded) {
        this.log('pull-needed', {
          account: account.name,
          balance: min,
          minimum_balance: account.minimumBalance,
          deficit: Math.abs(min - (account.minimumBalance ?? 0)),
        });
      }

      // If push or pull is needed, add the corresponding event
      if (pushNeeded && performsPushes) {
        if (this.addPushEvents(segment, account, min)) {
          pushPullEventAdded = true;
        }
      } else if (pullNeeded && performsPulls) {
        if (this.addPullEvents(segment, account, min, committedPulls)) {
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
      this.log('push-account-not-found', { pushAccount: account.pushAccount, accountName: account.name });
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

    this.log('push-executed', {
      from_account: account.name,
      to_account: pushAccount.name,
      amount: pushAmount,
    });

    // Record auto-push transfer flow
    this.flowAggregator?.recordTransfer(segment.startDate.getUTCFullYear(), 'autoPushes', pushAmount);

    return true;
  }

  /**
   * Adds pull events to the segment
   */
  private addPullEvents(segment: Segment, account: Account, minBalance: number, committedPulls: Map<string, number> = new Map()): boolean {
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
      const pullableAccount = this.getNextPullableAccount(accountsChecked, segment.startDate, committedPulls);
      accountsChecked.add(pullableAccount?.id ?? '');
      if (!pullableAccount) {
        break;
      }

      // Calculate the amount available to pull from the pullable account,
      // accounting for amounts already committed from this source in this segment
      const pullableAccountBalance = this.balanceTracker.getAccountBalance(pullableAccount.id);
      const alreadyCommitted = committedPulls.get(pullableAccount.id) || 0;
      const availableAmount = Math.min(toPull, pullableAccountBalance - alreadyCommitted - (pullableAccount.minimumBalance ?? 0));

      this.log('source-selected', {
        source_account: pullableAccount.name,
        available_balance: pullableAccountBalance - alreadyCommitted,
        manual_priority: pullableAccount.pullPriority,
        tax_aware_priority: this.withdrawalStrategy === 'taxOptimized' ? this.getTaxAwarePriority(pullableAccount, segment.startDate) : null,
        strategy: this.withdrawalStrategy,
      });

      // If no amount is available from this account, try the next one
      if (availableAmount <= 0) {
        this.log('pull-cascade', {
          exhausted_account: pullableAccount.name,
          remaining_deficit: toPull,
        });
        continue;
      }

      // Update the amount to pull and the amount pulled
      pullAmount += availableAmount;
      toPull -= availableAmount;

      // Track the committed pull so subsequent requests see reduced availability
      committedPulls.set(pullableAccount.id, alreadyCommitted + availableAmount);

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

      this.log('pull-executed', {
        from_account: pullableAccount.name,
        to_account: account.name,
        amount: availableAmount,
        committed_total: alreadyCommitted + availableAmount,
      });

      // Record auto-pull transfer flow
      this.flowAggregator?.recordTransfer(segment.startDate.getUTCFullYear(), 'autoPulls', availableAmount);

      // If there's still more to pull after this source, log the cascade
      if (toPull > 0) {
        this.log('pull-cascade', {
          exhausted_account: pullableAccount.name,
          remaining_deficit: toPull,
        });
      }

      // Roth 5-year lot penalty: if pulling from a Roth account with conversion lots
      // still within the 5-year holding period, add a 10% penalty on the penaltyable portion
      this.applyRothConversionPenalty(pullableAccount, availableAmount, segment.startDate, account);
    }

    // Attempt whole life surrender as last resort before logging failure
    if (toPull > 0 && this.lifeInsuranceManager) {
      const dateStr = formatDate(segment.startDate);
      const year = segment.startDate.getUTCFullYear();
      const surrenderPayouts = this.lifeInsuranceManager.surrenderForAmount(toPull, year, dateStr);

      for (const payout of surrenderPayouts) {
        // Create pull event to deposit surrender proceeds into the requesting account
        const pullActivity = new Activity({
          id: `surrender-transfer-${payout.activity.id}`,
          name: `Surrender Transfer: ${payout.activity.name}`,
          amount: payout.activity.amount,
          amountIsVariable: false,
          amountVariable: null,
          date: dateStr,
          dateIsVariable: false,
          dateVariable: null,
          from: '',
          to: account.name,
          isTransfer: false,
          category: payout.activity.category,
          flag: true,
          flagColor: 'indigo',
        });

        const pullEvent: ActivityTransferEvent = {
          id: `surrender-transfer-${payout.activity.id}`,
          type: EventType.activityTransfer,
          date: segment.startDate,
          accountId: account.id,
          fromAccountId: account.id, // Proceeds go directly to requesting account
          toAccountId: account.id,
          priority: 0,
          originalActivity: pullActivity,
        };

        segment.events.push(pullEvent);
        const surrenderAmount = Number(payout.activity.amount);
        toPull -= surrenderAmount;
        pullAmount += surrenderAmount;

        this.log('surrender-pull', {
          policy: payout.activity.name,
          amount: surrenderAmount,
          remaining_deficit: Math.max(0, toPull),
        });
      }
    }

    // If still short after surrender attempts
    if (toPull > 0) {
      this.log('pull-failure', {
        account: account.name,
        requested: Math.abs(minBalance - (account.minimumBalance ?? 0)),
        shortfall: toPull,
      });
      this.pullFailures.push({
        date: segment.startDate,
        accountId: account.id,
        shortfall: toPull,
      });
    }

    return pullAmount > 0; // Return true if a pull event was added
  }

  /**
   * Apply 10% penalty for Roth conversion lots still within the 5-year holding period.
   * Withdrawals of conversion amounts within 5 years incur a 10% penalty only if under age 59½.
   */
  private applyRothConversionPenalty(
    sourceAccount: Account,
    withdrawalAmount: number,
    date: Date,
    destinationAccount: Account,
  ): void {
    if (!this.rothConversionManager || !this.taxManager) return;

    // Only applies to Roth accounts
    const isRoth = sourceAccount.name.toLowerCase().includes('roth');
    if (!isRoth) return;

    // No penalty if account owner is age 59½ or older
    const ageCheckPassed = !!(sourceAccount.earlyWithdrawalDate && date >= sourceAccount.earlyWithdrawalDate);
    if (ageCheckPassed) {
      this.log('roth-penalty-checked', {
        account: sourceAccount.name,
        withdrawal_amount: withdrawalAmount,
        penaltyable_balance: 0,
        penalty_amount: 0,
        age_check_passed: true,
      });
      return;
    }

    const currentYear = date.getUTCFullYear();
    const penaltyableBalance = this.rothConversionManager.getPenaltyableBalance(sourceAccount.id, currentYear);

    if (penaltyableBalance <= 0) return;

    // The penaltyable portion of this withdrawal is the lesser of the withdrawal
    // amount and the remaining penaltyable balance
    const penaltyablePortion = Math.min(withdrawalAmount, penaltyableBalance);
    if (penaltyablePortion <= 0) return;

    const penaltyAmount = penaltyablePortion * 0.10;

    this.log('roth-penalty-checked', {
      account: sourceAccount.name,
      withdrawal_amount: withdrawalAmount,
      penaltyable_balance: penaltyableBalance,
      penalty_amount: penaltyAmount,
      age_check_passed: false,
    });

    // Add penalty as a taxable occurrence via the TaxManager
    // The penalty is charged to the destination account (the account receiving funds)
    this.taxManager.addTaxableOccurrence(destinationAccount.name, {
      date,
      year: currentYear,
      amount: penaltyAmount,
      incomeType: 'penalty',
    });
  }

  private getNextPullableAccount(accountsChecked: Set<string>, segmentDate: Date, committedPulls: Map<string, number> = new Map()): Account | undefined {
    const pullable = this.accountManager
      .getPullableAccounts()
      .filter(
        (a) => {
          const committed = committedPulls.get(a.id) || 0;
          return this.balanceTracker.getAccountBalance(a.id) - committed > (a.minimumBalance ?? 0) && !accountsChecked.has(a.id);
        },
      );

    if (this.withdrawalStrategy === 'taxOptimized') {
      return pullable.sort((a, b) => {
        const scoreA = this.getTaxAwarePriority(a, segmentDate);
        const scoreB = this.getTaxAwarePriority(b, segmentDate);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.pullPriority - b.pullPriority; // Tiebreaker
      })[0] ?? undefined;
    }

    // Manual strategy: use pullPriority only
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
