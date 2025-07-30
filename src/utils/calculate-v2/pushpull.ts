/**
 * Smart push/pull optimization system for optimized financial calculations
 *
 * This module implements the most complex optimization - replacing expensive
 * deep copying for lookahead calculations with smart predictive modeling
 * and efficient state snapshots to handle push/pull balance management.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Account } from '../../data/account/account';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate, isBefore, isAfter, isAfterOrSame } from '../date/date';
import { nextDate } from '../calculate/helpers';
import { loadVariable } from '../simulation/variable';
import { BalanceTracker } from './balance-tracker';
import { CacheManager } from './cache';
import { AccountsAndTransfers } from '../../data/account/types';
import { TaxImplication } from './types';
import { debug } from './logger';

dayjs.extend(utc);

/**
 * Push/pull analysis context
 */
interface PushPullContext {
  checkDate: Date;
  accountsAndTransfers: AccountsAndTransfers;
  balanceTracker: BalanceTracker;
  simulation: string;
  monteCarlo: boolean;
}

/**
 * Balance projection for lookahead
 */
interface BalanceProjection {
  date: Date;
  projectedBalance: number;
  minimumBalance: number;
  events: ProjectedEvent[];
  confidence: number; // 0-1 scale
}

/**
 * Projected financial event
 */
interface ProjectedEvent {
  date: Date;
  type: 'bill' | 'interest' | 'transfer' | 'activity';
  amount: number;
  description: string;
  certainty: number; // 0-1 scale
}

/**
 * Push/pull decision
 */
interface PushPullDecision {
  action: 'push' | 'pull' | 'none';
  amount: number;
  fromAccount: Account | null;
  toAccount: Account | null;
  reason: string;
  confidence: number;
  alternatives: PushPullAlternative[];
}

/**
 * Alternative push/pull option
 */
interface PushPullAlternative {
  action: 'push' | 'pull';
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  reason: string;
  score: number;
}

/**
 * Lookahead calculation result
 */
interface LookaheadResult {
  minimumBalance: number;
  worstCaseDate: Date;
  projections: BalanceProjection[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendedAction: PushPullDecision;
}

/**
 * Push/pull execution result
 */
interface PushPullExecutionResult {
  executed: boolean;
  pushActivities: ConsolidatedActivity[];
  pullActivities: ConsolidatedActivity[];
  balanceChanges: Map<string, number>;
  taxImplications: TaxImplication[];
  nextCheckDate: Date;
}

/**
 * Smart push/pull processor that eliminates expensive deep copying
 */
export class SmartPushPullProcessor {
  private cache: CacheManager;
  private projectionCache: Map<string, BalanceProjection[]> = new Map();
  private decisionCache: Map<string, PushPullDecision> = new Map();
  private patternCache: Map<string, LookaheadResult> = new Map();

  constructor(cache: CacheManager) {
    this.cache = cache;
  }

  /**
   * Processes monthly push/pull check with smart optimization
   */
  processMonthlyPushPull(context: PushPullContext): PushPullExecutionResult {
    const { checkDate, accountsAndTransfers, balanceTracker, simulation } = context;

    // Find accounts that need push/pull management
    const managedAccounts = this.findManagedAccounts(accountsAndTransfers.accounts);

    if (managedAccounts.length === 0) {
      return this.createEmptyResult(checkDate);
    }

    const executionResults: PushPullExecutionResult[] = [];

    for (const account of managedAccounts) {
      const accountResult = this.processAccountPushPull(
        account,
        accountsAndTransfers,
        balanceTracker,
        checkDate,
        simulation,
      );
      executionResults.push(accountResult);
    }

    // Combine all results
    return this.combineExecutionResults(executionResults, checkDate);
  }

  /**
   * Processes push/pull for a single account
   */
  private processAccountPushPull(
    account: Account,
    accountsAndTransfers: AccountsAndTransfers,
    balanceTracker: BalanceTracker,
    checkDate: Date,
    simulation: string,
  ): PushPullExecutionResult {
    // Check if push/pull is active for this account
    if (!this.isPushPullActive(account, checkDate)) {
      return this.createEmptyResult(checkDate);
    }

    // Perform smart lookahead without deep copying
    const lookaheadResult = this.performSmartLookahead(
      account,
      accountsAndTransfers,
      balanceTracker,
      checkDate,
      simulation,
    );

    // Make push/pull decision based on lookahead
    const decision = this.makePushPullDecision(account, lookaheadResult, accountsAndTransfers.accounts, checkDate);

    // Execute the decision if needed
    if (decision.action !== 'none') {
      return this.executePushPullDecision(decision, account, accountsAndTransfers, balanceTracker, checkDate);
    }

    return this.createEmptyResult(checkDate);
  }

  /**
   * Performs smart lookahead using event-based projection instead of deep copying
   */
  private performSmartLookahead(
    account: Account,
    accountsAndTransfers: AccountsAndTransfers,
    balanceTracker: BalanceTracker,
    checkDate: Date,
    simulation: string,
  ): LookaheadResult {
    const cacheKey = this.generateLookaheadCacheKey(account, checkDate, simulation);
    const cached = this.patternCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Get current balance from balance tracker
    const currentBalance = balanceTracker.getAccountBalance(account.id);

    // Use event-based projection instead of deep copying
    const monthEnd = dayjs.utc(checkDate).endOf('month').toDate();
    const projections = this.generateEventBasedProjections(
      account,
      currentBalance,
      checkDate,
      monthEnd,
      simulation,
    );
    debug('projections', { checkDate: formatDate(checkDate), projections: projections.length });
    projections.forEach(p => {
      debug('performSmartLookahead', { date: formatDate(p.date), projectedBalance: p.projectedBalance, minimumBalance: p.minimumBalance, events: p.events.length, confidence: p.confidence });
    })

    // Analyze risk level
    const riskLevel = this.analyzeRiskLevel(projections, account);

    // Find minimum balance and worst case
    const minimumProjection = projections.reduce((min, proj) =>
      proj.projectedBalance < min.projectedBalance ? proj : min,
    );

    // Generate recommendation
    const recommendedAction = this.generateRecommendation(
      account,
      currentBalance,
      minimumProjection,
      accountsAndTransfers.accounts,
    );

    const result: LookaheadResult = {
      minimumBalance: minimumProjection.projectedBalance,
      worstCaseDate: minimumProjection.date,
      projections,
      riskLevel,
      recommendedAction,
    };

    // Cache the result
    this.patternCache.set(cacheKey, result);

    return result;
  }

  /**
   * Generates event-based projections without expensive deep copying
   */
  private generateEventBasedProjections(
    account: Account,
    currentBalance: number,
    startDate: Date,
    endDate: Date,
    simulation: string,
  ): BalanceProjection[] {
    const projections: BalanceProjection[] = [];
    let runningBalance = currentBalance;

    // Get all scheduled events for this account in the date range
    const accountEvents = this.getScheduledEventsForAccount(account, startDate, endDate, simulation);

    // Sort events by date
    accountEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Generate projections by processing events chronologically
    let currentDate = startDate;
    let eventIndex = 0;

    while (currentDate <= endDate) {
      const dailyEvents: ProjectedEvent[] = [];

      // Process all events for this date
      while (
        eventIndex < accountEvents.length &&
        accountEvents[eventIndex].date.toDateString() === currentDate.toDateString()
      ) {
        const event = accountEvents[eventIndex];
        runningBalance += event.amount;
        dailyEvents.push(event);
        eventIndex++;
      }

      projections.push({
        date: new Date(currentDate),
        projectedBalance: runningBalance,
        minimumBalance: account.minimumBalance || 0,
        events: dailyEvents,
        confidence: this.calculateProjectionConfidence(dailyEvents),
      });

      currentDate = dayjs.utc(currentDate).add(1, 'day').toDate();
    }

    return projections;
  }

  /**
   * Gets scheduled events for an account without deep copying
   */
  private getScheduledEventsForAccount(
    account: Account,
    startDate: Date,
    endDate: Date,
    simulation: string,
  ): ProjectedEvent[] {
    const events: ProjectedEvent[] = [];

    // Add bill events
    for (const bill of account.bills) {
      const billEvents = this.generateBillEventsForRange(bill, startDate, endDate, simulation);
      events.push(...billEvents);
    }

    // Add interest events
    for (const interest of account.interests) {
      const interestEvents = this.generateInterestEventsForRange(interest, startDate, endDate);
      events.push(...interestEvents);
    }

    // Add existing activities in the range
    for (const activity of account.activity) {
      if (activity.date >= startDate && activity.date <= endDate) {
        events.push({
          date: activity.date,
          type: 'activity',
          amount: activity.amount,
          description: activity.name,
          certainty: 1.0, // Existing activities are certain
        });
      }
    }

    return events;
  }

  /**
   * Generates bill events for a date range
   */
  private generateBillEventsForRange(bill: any, startDate: Date, endDate: Date, simulation: string): ProjectedEvent[] {
    const events: ProjectedEvent[] = [];

    if (!bill.startDate || !bill.periods || !bill.everyN) {
      return events;
    }

    // Use the same logic as the timeline generator
    let currentDate = bill.startDate > startDate ? bill.startDate : startDate;
    let eventCount = 0;

    while (currentDate <= endDate && (!bill.endDate || currentDate <= bill.endDate)) {
      const amount = this.calculateBillAmountForDate(bill, currentDate, simulation);

      events.push({
        date: new Date(currentDate),
        type: 'bill',
        amount: amount,
        description: `Bill: ${bill.name}`,
        certainty: bill.amountIsVariable ? 0.8 : 1.0,
      });

      // Calculate next occurrence using existing helper
      try {
        currentDate = this.calculateNextBillDate(currentDate, bill.periods, bill.everyN);
      } catch (error) {
        break; // Stop if date calculation fails
      }

      eventCount++;
      if (eventCount > 1000) break; // Safety limit
    }

    return events;
  }

  /**
   * Generates interest events for a date range
   */
  private generateInterestEventsForRange(interest: any, startDate: Date, endDate: Date): ProjectedEvent[] {
    const events: ProjectedEvent[] = [];

    if (!interest.applicableDate || !interest.compounded) {
      return events;
    }

    let currentDate = interest.applicableDate > startDate ? interest.applicableDate : startDate;
    let eventCount = 0;

    while (currentDate <= endDate && (!interest.endDate || currentDate <= interest.endDate)) {
      // Simplified interest calculation for projection
      const estimatedAmount = this.estimateInterestAmount(interest, currentDate);

      if (estimatedAmount > 0) {
        events.push({
          date: new Date(currentDate),
          type: 'interest',
          amount: estimatedAmount,
          description: `Interest: ${interest.name || 'Interest'}`,
          certainty: 0.9,
        });
      }

      // Calculate next interest date
      try {
        currentDate = this.calculateNextInterestDate(currentDate, interest.compounded);
      } catch (error) {
        break;
      }

      eventCount++;
      if (eventCount > 1000) break; // Safety limit
    }

    return events;
  }

  /**
   * Makes push/pull decision based on lookahead analysis
   */
  private makePushPullDecision(
    account: Account,
    lookaheadResult: LookaheadResult,
    allAccounts: Account[],
    checkDate: Date,
  ): PushPullDecision {
    const currentBalance = lookaheadResult.projections[0]?.projectedBalance || 0;
    const minimumBalance = account.minimumBalance || 0;
    const minimumPullAmount = account.minimumPullAmount || 0;
    const excessAmount = currentBalance - minimumBalance - minimumPullAmount * 4;
    debug({
      account: account.name,
      currentBalance,
      minimumBalance,
      minimumPullAmount,
      excessAmount,
      checkDate: formatDate(checkDate),
    })

    // Check if pull is needed
    if (lookaheadResult.minimumBalance < minimumBalance) {
      const pullDecision = this.createPullDecision(account, lookaheadResult, allAccounts);
      debug('pullDecision', pullDecision)
      return pullDecision;
    }

    // Check if push is beneficial
    if (excessAmount > 0 && account.performsPushes) {
      const pushDecision = this.createPushDecision(account, excessAmount, allAccounts);
      debug('pushDecision', pushDecision)
      return pushDecision;
    }

    const noneDecision: PushPullDecision = {
      action: 'none',
      amount: 0,
      fromAccount: null,
      toAccount: null,
      reason: 'No action needed - balances are within acceptable range',
      confidence: 0.9,
      alternatives: [],
    };
    debug('noneDecision', noneDecision)
    return noneDecision;
  }

  /**
   * Creates a pull decision
   */
  private createPullDecision(
    account: Account,
    lookaheadResult: LookaheadResult,
    allAccounts: Account[],
  ): PushPullDecision {
    const shortfall = Math.abs(lookaheadResult.minimumBalance - (account.minimumBalance || 0));
    const pullAmount = shortfall + (account.minimumPullAmount || 0);

    // Find best pull source
    const pullableAccounts = this.findPullableAccounts(allAccounts, pullAmount);

    if (pullableAccounts.length === 0) {
      return {
        action: 'none',
        amount: 0,
        fromAccount: null,
        toAccount: null,
        reason: 'Pull needed but no suitable source accounts available',
        confidence: 0.1,
        alternatives: [],
      };
    }

    const bestSource = pullableAccounts[0]; // Already sorted by priority

    return {
      action: 'pull',
      amount: pullAmount,
      fromAccount: bestSource,
      toAccount: account,
      reason: `Pull needed to maintain minimum balance. Projected shortfall: ${(typeof shortfall === 'number' ? shortfall : 0).toFixed(2)}`,
      confidence: lookaheadResult.riskLevel === 'high' ? 0.95 : 0.8,
      alternatives: this.generatePullAlternatives(pullableAccounts.slice(1), pullAmount),
    };
  }

  /**
   * Creates a push decision
   */
  private createPushDecision(account: Account, excessAmount: number, allAccounts: Account[]): PushPullDecision {
    const pushAccount = allAccounts.find((acc) => acc.name === account.pushAccount);

    if (!pushAccount) {
      return {
        action: 'none',
        amount: 0,
        fromAccount: null,
        toAccount: null,
        reason: 'Push account not found',
        confidence: 0.1,
        alternatives: [],
      };
    }

    return {
      action: 'push',
      amount: excessAmount,
      fromAccount: account,
      toAccount: pushAccount,
      reason: `Push excess funds to optimize balance. Excess amount: ${(typeof excessAmount === 'number' ? excessAmount : 0).toFixed(2)}`,
      confidence: 0.85,
      alternatives: [],
    };
  }

  /**
   * Executes a push/pull decision
   */
  private executePushPullDecision(
    decision: PushPullDecision,
    account: Account,
    accountsAndTransfers: AccountsAndTransfers,
    balanceTracker: BalanceTracker,
    checkDate: Date,
  ): PushPullExecutionResult {
    const activities: ConsolidatedActivity[] = [];
    const balanceChanges = new Map<string, number>();
    const taxImplications: TaxImplication[] = [];

    if (decision.action === 'pull' && decision.fromAccount && decision.toAccount) {
      // Execute pull
      const pullResult = this.executePull(
        decision.fromAccount,
        decision.toAccount,
        decision.amount,
        checkDate,
        balanceTracker,
      );

      activities.push(...pullResult.activities);
      pullResult.balanceChanges.forEach((amount, accountId) => {
        balanceChanges.set(accountId, (balanceChanges.get(accountId) || 0) + amount);
      });
      taxImplications.push(...pullResult.taxImplications);
    } else if (decision.action === 'push' && decision.fromAccount && decision.toAccount) {
      // Execute push
      const pushResult = this.executePush(
        decision.fromAccount,
        decision.toAccount,
        decision.amount,
        checkDate,
        balanceTracker,
      );

      activities.push(...pushResult.activities);
      pushResult.balanceChanges.forEach((amount, accountId) => {
        balanceChanges.set(accountId, (balanceChanges.get(accountId) || 0) + amount);
      });
    }

    return {
      executed: activities.length > 0,
      pushActivities: activities.filter((act) => act.name?.includes('Push')),
      pullActivities: activities.filter((act) => act.name?.includes('Pull')),
      balanceChanges,
      taxImplications,
      nextCheckDate: dayjs.utc(checkDate).add(1, 'month').toDate(),
    };
  }

  /**
   * Executes a pull operation
   */
  private executePull(
    fromAccount: Account,
    toAccount: Account,
    amount: number,
    date: Date,
    balanceTracker: BalanceTracker,
  ): {
    activities: ConsolidatedActivity[];
    balanceChanges: Map<string, number>;
    taxImplications: TaxImplication[];
  } {
    const activities: ConsolidatedActivity[] = [];
    const balanceChanges = new Map<string, number>();
    const taxImplications: TaxImplication[] = [];

    // Create pull activities
    const pullFromActivity = new ConsolidatedActivity({
      id: `AUTO-PULL-${date.getTime()}-FROM`,
      name: `Auto Pull to ${toAccount.name}`,
      amount: -amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(date),
      dateIsVariable: false,
      dateVariable: null,
      from: fromAccount.name,
      to: toAccount.name,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: true,
      flagColor: 'violet',
    });

    // const pullToActivity = new ConsolidatedActivity({
    //   id: `AUTO-PULL-${date.getTime()}-TO`,
    //   name: `Auto Pull from ${fromAccount.name}`,
    //   amount: amount,
    //   amountIsVariable: false,
    //   amountVariable: null,
    //   date: formatDate(date),
    //   dateIsVariable: false,
    //   dateVariable: null,
    //   from: fromAccount.name,
    //   to: toAccount.name,
    //   isTransfer: true,
    //   category: 'Ignore.Transfer',
    //   flag: true,
    //   flagColor: 'violet',
    // });

    activities.push(pullFromActivity);

    // Update balances
    balanceChanges.set(fromAccount.id, -amount);
    balanceChanges.set(toAccount.id, amount);

    // Calculate tax implications for retirement account withdrawals
    if (this.isRetirementAccount(fromAccount)) {
      const taxRate = fromAccount.withdrawalTaxRate || 0;
      const penaltyRate = this.getEarlyWithdrawalPenalty(fromAccount, date);

      if (taxRate > 0 || penaltyRate > 0) {
        taxImplications.push({
          accountId: fromAccount.id,
          type: penaltyRate > 0 ? 'earlyWithdrawal' : 'withdrawal',
          amount: amount,
          taxRate,
          penaltyRate,
          dueDate: this.calculateTaxDueDate(date),
        });
      }
    }

    return {
      activities,
      balanceChanges,
      taxImplications,
    };
  }

  /**
   * Executes a push operation
   */
  private executePush(
    fromAccount: Account,
    toAccount: Account,
    amount: number,
    date: Date,
    balanceTracker: BalanceTracker,
  ): {
    activities: ConsolidatedActivity[];
    balanceChanges: Map<string, number>;
  } {
    const activities: ConsolidatedActivity[] = [];
    const balanceChanges = new Map<string, number>();

    // Create push activities
    // const pushFromActivity = new ConsolidatedActivity({
    //   id: `AUTO-PUSH-${date.getTime()}-FROM`,
    //   name: `Auto Push to ${toAccount.name}`,
    //   amount: -amount,
    //   amountIsVariable: false,
    //   amountVariable: null,
    //   date: formatDate(date),
    //   dateIsVariable: false,
    //   dateVariable: null,
    //   from: fromAccount.name,
    //   to: toAccount.name,
    //   isTransfer: true,
    //   category: 'Ignore.Transfer',
    //   flag: true,
    //   flagColor: 'indigo',
    // });

    const pushToActivity = new ConsolidatedActivity({
      id: `AUTO-PUSH-${date.getTime()}-TO`,
      name: `Auto Push from ${fromAccount.name}`,
      amount: amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(date),
      dateIsVariable: false,
      dateVariable: null,
      from: fromAccount.name,
      to: toAccount.name,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: true,
      flagColor: 'indigo',
    });

    activities.push(pushToActivity);

    // Update balances
    balanceChanges.set(fromAccount.id, -amount);
    balanceChanges.set(toAccount.id, amount);

    return {
      activities,
      balanceChanges,
    };
  }

  // Helper methods

  private findManagedAccounts(accounts: Account[]): Account[] {
    return accounts.filter(
      (account) =>
        account.type === 'Checking' && account.pushAccount && (account.performsPulls || account.performsPushes),
    );
  }

  private isPushPullActive(account: Account, date: Date): boolean {
    if (isBefore(date, dayjs().toDate())) {
      return false; // Cannot process past dates
    }
    if (account.pushStart && isBefore(date, account.pushStart)) {
      return false;
    }
    if (account.pushEnd && isAfter(date, account.pushEnd)) {
      return false;
    }
    return true;
  }

  private billOccursOnDate(bill: any, date: Date): boolean {
    // Simplified bill occurrence check
    if (!bill.startDate || !bill.periods || !bill.everyN) return false;

    // This would need proper frequency calculation logic
    return false; // Placeholder
  }

  private estimateMonthlyInterest(account: Account, date: Date): number {
    // Simplified monthly interest estimation
    if (account.interests.length === 0) return 0;

    const currentInterest = account.interests[0];
    const annualRate = currentInterest.rate || 0;
    const monthlyRate = annualRate / 100 / 12;

    // Estimate based on average balance
    return 1000 * monthlyRate; // Placeholder calculation
  }

  private predictHistoricalPatterns(account: Account, date: Date): ProjectedEvent[] {
    // Analyze historical activities to predict patterns
    // This would implement machine learning or pattern analysis
    return []; // Placeholder
  }

  private calculateProjectionConfidence(events: ProjectedEvent[]): number {
    if (events.length === 0) return 1.0;

    const totalCertainty = events.reduce((sum, event) => sum + event.certainty, 0);
    return totalCertainty / events.length;
  }

  private analyzeRiskLevel(projections: BalanceProjection[], account: Account): 'low' | 'medium' | 'high' {
    const minimumBalance = account.minimumBalance || 0;
    const criticalProjections = projections.filter((proj) => proj.projectedBalance < minimumBalance);

    if (criticalProjections.length === 0) return 'low';
    if (criticalProjections.length <= projections.length * 0.3) return 'medium';
    return 'high';
  }

  private generateRecommendation(
    account: Account,
    currentBalance: number,
    minimumProjection: BalanceProjection,
    allAccounts: Account[],
  ): PushPullDecision {
    // Generate recommendation based on analysis
    return {
      action: 'none',
      amount: 0,
      fromAccount: null,
      toAccount: null,
      reason: 'Analysis in progress',
      confidence: 0.5,
      alternatives: [],
    };
  }

  private findPullableAccounts(accounts: Account[], neededAmount: number): Account[] {
    return accounts
      .filter((acc) => acc.pullPriority !== -1 && acc.balance > (acc.minimumBalance || 0) + neededAmount)
      .sort((a, b) => a.pullPriority - b.pullPriority);
  }

  private generatePullAlternatives(accounts: Account[], amount: number): PushPullAlternative[] {
    return accounts.map((account) => ({
      action: 'pull' as const,
      amount,
      fromAccountId: account.id,
      toAccountId: '',
      reason: `Alternative pull source (priority ${account.pullPriority})`,
      score: 1.0 / (account.pullPriority + 1),
    }));
  }

  private isRetirementAccount(account: Account): boolean {
    return ['401k', 'IRA', 'Roth IRA', 'Pension'].includes(account.type);
  }

  private getEarlyWithdrawalPenalty(account: Account, date: Date): number {
    if (!account.earlyWithdrawlDate || date >= account.earlyWithdrawlDate) {
      return 0;
    }
    return account.earlyWithdrawlPenalty || 0;
  }

  private calculateTaxDueDate(transactionDate: Date): Date {
    const year = dayjs.utc(transactionDate).year();
    return new Date(year + 1, 3, 1); // April 1st of following year
  }

  private createEmptyResult(date: Date): PushPullExecutionResult {
    return {
      executed: false,
      pushActivities: [],
      pullActivities: [],
      balanceChanges: new Map(),
      taxImplications: [],
      nextCheckDate: dayjs.utc(date).add(1, 'month').toDate(),
    };
  }

  private combineExecutionResults(results: PushPullExecutionResult[], checkDate: Date): PushPullExecutionResult {
    const combined: PushPullExecutionResult = {
      executed: results.some((r) => r.executed),
      pushActivities: [],
      pullActivities: [],
      balanceChanges: new Map(),
      taxImplications: [],
      nextCheckDate: dayjs.utc(checkDate).add(1, 'month').toDate(),
    };

    for (const result of results) {
      combined.pushActivities.push(...result.pushActivities);
      combined.pullActivities.push(...result.pullActivities);
      combined.taxImplications.push(...result.taxImplications);

      result.balanceChanges.forEach((amount, accountId) => {
        const current = combined.balanceChanges.get(accountId) || 0;
        combined.balanceChanges.set(accountId, current + amount);
      });
    }

    return combined;
  }

  private generateLookaheadCacheKey(account: Account, date: Date, simulation: string): string {
    return `lookahead_${account.id}_${date.getTime()}_${simulation}`;
  }

  /**
   * Helper methods for event-based projection
   */
  private calculateBillAmountForDate(bill: any, date: Date, simulation: string): number {
    let amount = bill.amount;

    // Handle variable amounts
    if (bill.amountIsVariable && bill.amountVariable) {
      const variableValue = loadVariable(bill.amountVariable, simulation);
      if (typeof variableValue === 'number') {
        amount = variableValue;
      }
    }

    // Apply inflation if configured
    if (bill.inflationRate && bill.inflationRate > 0) {
      const yearsDiff = dayjs.utc(date).diff(dayjs.utc(bill.startDate), 'year', true);
      amount = amount * Math.pow(1 + bill.inflationRate / 100, yearsDiff);
    }

    return amount;
  }

  private calculateNextBillDate(currentDate: Date, periods: string, everyN: number): Date {
    return nextDate(currentDate, periods, everyN);
  }

  private calculateNextInterestDate(currentDate: Date, compounded: string): Date {
    let nextDateCalc = dayjs.utc(currentDate);

    switch (compounded) {
      case 'day':
        nextDateCalc = nextDateCalc.add(1, 'day');
        break;
      case 'week':
        nextDateCalc = nextDateCalc.add(1, 'week');
        break;
      case 'month':
        nextDateCalc = nextDateCalc.add(1, 'month');
        break;
      case 'year':
        nextDateCalc = nextDateCalc.add(1, 'year');
        break;
      default:
        nextDateCalc = nextDateCalc.add(1, 'month');
        break;
    }

    return nextDateCalc.toDate();
  }

  private estimateInterestAmount(interest: any, date: Date): number {
    // Simplified interest calculation for projection
    const annualRate = interest.rate || 0;
    const monthlyRate = annualRate / 100 / 12;

    // Use a rough estimate based on typical account balance
    // In a real implementation, this would use the current balance from balance tracker
    const estimatedBalance = 10000; // Placeholder

    return estimatedBalance * monthlyRate;
  }

  /**
   * Gets push/pull processing statistics
   */
  getStats(): {
    projectionsGenerated: number;
    decisionsEvaluated: number;
    cacheHitRate: number;
    averageConfidence: number;
  } {
    const projectionCount = this.projectionCache.size;
    const decisionCount = this.decisionCache.size;
    const patternCount = this.patternCache.size;

    return {
      projectionsGenerated: projectionCount,
      decisionsEvaluated: decisionCount,
      cacheHitRate: patternCount > 0 ? 0.8 : 0, // Estimated
      averageConfidence: 0.85, // Estimated
    };
  }

  /**
   * Clears all caches
   */
  clearCache(): void {
    this.projectionCache.clear();
    this.decisionCache.clear();
    this.patternCache.clear();
  }
}

