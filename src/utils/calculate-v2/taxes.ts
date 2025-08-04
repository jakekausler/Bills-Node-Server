/**
 * Advanced tax calculation module for optimized financial calculations
 *
 * This module handles complex tax calculations including withdrawal taxes,
 * early withdrawal penalties, interest taxes, and tax timing optimized
 * for the new event-based calculation system.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate, isAfter, isBefore } from '../date/date';
import { Account } from '../../data/account/account';

dayjs.extend(utc);

/**
 * Tax calculation context
 */
interface TaxCalculationContext {
  accountId: string;
  account: Account;
  taxYear: number;
  calculationDate: Date;
  currentBalance: number;
  activities: ConsolidatedActivity[];
}

/**
 * Tax event details
 */
interface TaxEvent {
  id: string;
  type: 'withdrawal' | 'earlyWithdrawal' | 'interest' | 'rmd';
  accountId: string;
  sourceActivityId: string;
  taxableAmount: number;
  taxRate: number;
  penaltyRate: number;
  transactionDate: Date;
  dueDate: Date;
}

/**
 * Tax calculation result
 */
interface TaxCalculationResult {
  totalTaxOwed: number;
  totalPenalties: number;
  taxEvents: TaxEvent[];
  activities: ConsolidatedActivity[];
  nextTaxDate: Date | null;
  metadata: {
    taxYear: number;
    withdrawalTaxes: number;
    earlyWithdrawalPenalties: number;
    interestTaxes: number;
    rmdTaxes: number;
  };
}

/**
 * Accumulated tax data for a year
 */
interface YearlyTaxAccumulation {
  year: number;
  withdrawalTaxes: Map<string, number>; // accountId -> amount
  earlyWithdrawalPenalties: Map<string, number>;
  interestTaxes: Map<string, number>;
  rmdTaxes: Map<string, number>;
  taxEvents: TaxEvent[];
}

/**
 * Advanced tax calculator
 */
export class TaxCalculator {
  private taxAccumulations: Map<number, YearlyTaxAccumulation> = new Map();
  private calculationCache: Map<string, TaxCalculationResult> = new Map();
  private taxEventCache: Map<string, TaxEvent[]> = new Map();

  /**
   * Calculates taxes for a specific context
   */
  async calculateTaxes(context: TaxCalculationContext): Promise<TaxCalculationResult> {
    const cacheKey = this.generateCalculationCacheKey(context);
    const cached = this.calculationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.performTaxCalculation(context);
    this.calculationCache.set(cacheKey, result);

    return result;
  }

  /**
   * Processes pull taxes (withdrawal taxes from retirement accounts)
   */
  async processPullTaxes(
    accounts: Account[],
    calculationDate: Date,
    currentBalances: Record<string, number>,
  ): Promise<TaxCalculationResult[]> {
    const results: TaxCalculationResult[] = [];
    const taxYear = dayjs.utc(calculationDate).year() - 1; // Previous year's taxes

    // Only calculate on April 1st
    if (calculationDate.getUTCMonth() !== 3 || calculationDate.getUTCDate() !== 1) {
      return results;
    }

    for (const account of accounts) {
      const taxContext: TaxCalculationContext = {
        accountId: account.id,
        account,
        taxYear,
        calculationDate,
        currentBalance: currentBalances[account.id] || 0,
        activities: account.consolidatedActivity,
      };

      const taxResult = await this.calculateWithdrawalTaxes(taxContext);
      if (taxResult.totalTaxOwed > 0 || taxResult.totalPenalties > 0) {
        results.push(taxResult);
      }
    }

    return results;
  }

  /**
   * Processes interest taxes (taxes on taxable interest income)
   */
  async processInterestTaxes(
    accounts: Account[],
    calculationDate: Date,
    currentBalances: Record<string, number>,
  ): Promise<TaxCalculationResult[]> {
    const results: TaxCalculationResult[] = [];
    const taxYear = dayjs.utc(calculationDate).year() - 1; // Previous year's taxes

    // Only calculate on April 1st
    if (calculationDate.getUTCMonth() !== 3 || calculationDate.getUTCDate() !== 1) {
      return results;
    }

    for (const account of accounts) {
      // Only tax interest from taxable accounts
      if (this.isTaxDeferredAccount(account)) {
        continue;
      }

      const taxContext: TaxCalculationContext = {
        accountId: account.id,
        account,
        taxYear,
        calculationDate,
        currentBalance: currentBalances[account.id] || 0,
        activities: account.consolidatedActivity,
      };

      const taxResult = await this.calculateInterestTaxes(taxContext);
      if (taxResult.totalTaxOwed > 0) {
        results.push(taxResult);
      }
    }

    return results;
  }

  /**
   * Calculates withdrawal taxes for an account
   */
  private async calculateWithdrawalTaxes(context: TaxCalculationContext): Promise<TaxCalculationResult> {
    const { account, taxYear, calculationDate, activities } = context;

    const taxEvents: TaxEvent[] = [];
    let totalWithdrawalTax = 0;
    let totalEarlyWithdrawalPenalty = 0;

    // Find all withdrawal activities in the tax year
    const taxYearStart = new Date(taxYear, 0, 1);
    const taxYearEnd = new Date(taxYear, 11, 31);

    for (const activity of activities.filter((a) => a != null)) {
      if (activity && activity.date && activity.date >= taxYearStart && activity.date <= taxYearEnd) {
        // Check for auto-pull activities and RMDs
        if (
          activity.id &&
          typeof activity.id === 'string' &&
          (activity.id.startsWith('AUTO-PULL') || activity.id.startsWith('RMD'))
        ) {
          const sourceAccount = this.findSourceAccountFromActivity(activity);

          if (sourceAccount && this.isRetirementAccount(sourceAccount)) {
            const withdrawalAmount = Math.abs(activity.amount as number);

            // Calculate withdrawal tax
            const taxRate = sourceAccount.withdrawalTaxRate || 0;
            if (taxRate > 0) {
              const taxAmount = withdrawalAmount * taxRate;
              totalWithdrawalTax += taxAmount;

              taxEvents.push({
                id: `WTAX-${activity.id}-${calculationDate.getTime()}`,
                type: 'withdrawal',
                accountId: account.id,
                sourceActivityId: activity.id,
                taxableAmount: withdrawalAmount,
                taxRate,
                penaltyRate: 0,
                transactionDate: activity.date,
                dueDate: calculationDate,
              });
            }

            // Calculate early withdrawal penalty
            if (sourceAccount.earlyWithdrawlDate && isBefore(activity.date, sourceAccount.earlyWithdrawlDate)) {
              const penaltyRate = sourceAccount.earlyWithdrawlPenalty || 0;
              if (penaltyRate > 0) {
                const penaltyAmount = withdrawalAmount * penaltyRate;
                totalEarlyWithdrawalPenalty += penaltyAmount;

                taxEvents.push({
                  id: `EWPEN-${activity.id}-${calculationDate.getTime()}`,
                  type: 'earlyWithdrawal',
                  accountId: account.id,
                  sourceActivityId: activity.id,
                  taxableAmount: withdrawalAmount,
                  taxRate: 0,
                  penaltyRate,
                  transactionDate: activity.date,
                  dueDate: calculationDate,
                });
              }
            }
          }
        }
      }
    }

    // Create tax activities
    const taxActivities: ConsolidatedActivity[] = [];

    if (totalWithdrawalTax > 0) {
      taxActivities.push(
        this.createTaxActivity(account.id, 'Withdrawal Tax', -totalWithdrawalTax, calculationDate, 'Banking.Taxes'),
      );
    }

    if (totalEarlyWithdrawalPenalty > 0) {
      taxActivities.push(
        this.createTaxActivity(
          account.id,
          'Early Withdrawal Penalty',
          -totalEarlyWithdrawalPenalty,
          calculationDate,
          'Banking.Penalties',
        ),
      );
    }

    return {
      totalTaxOwed: totalWithdrawalTax,
      totalPenalties: totalEarlyWithdrawalPenalty,
      taxEvents,
      activities: taxActivities,
      nextTaxDate: this.calculateNextTaxDate(calculationDate),
      metadata: {
        taxYear,
        withdrawalTaxes: totalWithdrawalTax,
        earlyWithdrawalPenalties: totalEarlyWithdrawalPenalty,
        interestTaxes: 0,
        rmdTaxes: 0,
      },
    };
  }

  /**
   * Calculates interest taxes for an account
   */
  private async calculateInterestTaxes(context: TaxCalculationContext): Promise<TaxCalculationResult> {
    const { account, taxYear, calculationDate, activities } = context;

    const taxEvents: TaxEvent[] = [];
    let totalInterestTax = 0;

    // Find all interest activities in the tax year
    const taxYearStart = new Date(taxYear, 0, 1);
    const taxYearEnd = new Date(taxYear, 11, 31);

    for (const activity of activities.filter((a) => a != null)) {
      if (activity && activity.date && activity.date >= taxYearStart && activity.date <= taxYearEnd) {
        // Check for interest activities
        if (
          activity.id &&
          typeof activity.id === 'string' &&
          activity.id.startsWith('INTEREST-') &&
          (activity.amount as number) > 0
        ) {
          const interestAmount = activity.amount as number;

          // Apply standard interest tax rate (would be based on tax bracket in real system)
          const taxRate = this.getInterestTaxRate(account, interestAmount);

          if (taxRate > 0) {
            const taxAmount = interestAmount * taxRate;
            totalInterestTax += taxAmount;

            taxEvents.push({
              id: `ITAX-${activity.id}-${calculationDate.getTime()}`,
              type: 'interest',
              accountId: account.id,
              sourceActivityId: activity.id,
              taxableAmount: interestAmount,
              taxRate,
              penaltyRate: 0,
              transactionDate: activity.date,
              dueDate: calculationDate,
            });
          }
        }
      }
    }

    // Create tax activity
    const taxActivities: ConsolidatedActivity[] = [];

    if (totalInterestTax > 0) {
      taxActivities.push(
        this.createTaxActivity(account.id, 'Interest Tax', -totalInterestTax, calculationDate, 'Banking.Taxes'),
      );
    }

    return {
      totalTaxOwed: totalInterestTax,
      totalPenalties: 0,
      taxEvents,
      activities: taxActivities,
      nextTaxDate: this.calculateNextTaxDate(calculationDate),
      metadata: {
        taxYear,
        withdrawalTaxes: 0,
        earlyWithdrawalPenalties: 0,
        interestTaxes: totalInterestTax,
        rmdTaxes: 0,
      },
    };
  }

  /**
   * Performs the main tax calculation
   */
  private async performTaxCalculation(context: TaxCalculationContext): Promise<TaxCalculationResult> {
    // This method combines withdrawal and interest tax calculations
    const withdrawalResult = await this.calculateWithdrawalTaxes(context);
    const interestResult = await this.calculateInterestTaxes(context);

    return {
      totalTaxOwed: withdrawalResult.totalTaxOwed + interestResult.totalTaxOwed,
      totalPenalties: withdrawalResult.totalPenalties + interestResult.totalPenalties,
      taxEvents: [...withdrawalResult.taxEvents, ...interestResult.taxEvents],
      activities: [...withdrawalResult.activities, ...interestResult.activities],
      nextTaxDate: withdrawalResult.nextTaxDate,
      metadata: {
        taxYear: context.taxYear,
        withdrawalTaxes: withdrawalResult.metadata.withdrawalTaxes,
        earlyWithdrawalPenalties: withdrawalResult.metadata.earlyWithdrawalPenalties,
        interestTaxes: interestResult.metadata.interestTaxes,
        rmdTaxes: 0, // Would be calculated separately for RMDs
      },
    };
  }

  /**
   * Creates a tax activity
   */
  private createTaxActivity(
    accountId: string,
    taxType: string,
    amount: number,
    date: Date,
    category: string,
  ): ConsolidatedActivity {
    return new ConsolidatedActivity({
      id: `TAX-${taxType.replace(/\s+/g, '')}-${accountId}-${date.getTime()}`,
      name: taxType,
      amount: amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: category,
      flag: true,
      flagColor: 'orange',
    });
  }

  /**
   * Finds the source account from a transfer activity
   */
  private findSourceAccountFromActivity(activity: ConsolidatedActivity): Account | null {
    // This would need to be implemented with access to the accounts list
    // For now, return null as a placeholder
    return null;
  }

  /**
   * Checks if an account is a retirement account
   */
  private isRetirementAccount(account: Account): boolean {
    return ['401k', 'IRA', 'Roth IRA', 'Pension'].includes(account.type);
  }

  /**
   * Checks if an account is tax-deferred
   */
  private isTaxDeferredAccount(account: Account): boolean {
    return ['401k', 'IRA', 'Pension'].includes(account.type);
  }

  /**
   * Gets the interest tax rate for an account
   */
  private getInterestTaxRate(account: Account, interestAmount: number): number {
    // This would be based on tax brackets and account type
    // For now, use a simplified rate
    if (account.type === 'Checking' || account.type === 'Savings') {
      return 0.22; // 22% tax rate
    }
    return 0; // Tax-deferred accounts don't pay current taxes on interest
  }

  /**
   * Calculates the next tax date (next April 1st)
   */
  private calculateNextTaxDate(currentDate: Date): Date {
    const nextYear = dayjs.utc(currentDate).year() + 1;
    return new Date(nextYear, 3, 1); // April 1st of next year
  }

  /**
   * Accumulates tax data for a year
   */
  accumulateTaxData(taxYear: number, taxEvents: TaxEvent[]): void {
    let accumulation = this.taxAccumulations.get(taxYear);

    if (!accumulation) {
      accumulation = {
        year: taxYear,
        withdrawalTaxes: new Map(),
        earlyWithdrawalPenalties: new Map(),
        interestTaxes: new Map(),
        rmdTaxes: new Map(),
        taxEvents: [],
      };
      this.taxAccumulations.set(taxYear, accumulation);
    }

    // Add new tax events
    accumulation.taxEvents.push(...taxEvents);

    // Accumulate amounts by account and type
    for (const event of taxEvents) {
      const amount = event.taxableAmount * (event.taxRate + event.penaltyRate);

      switch (event.type) {
        case 'withdrawal':
          const currentWithdrawal = accumulation.withdrawalTaxes.get(event.accountId) || 0;
          accumulation.withdrawalTaxes.set(event.accountId, currentWithdrawal + amount);
          break;

        case 'earlyWithdrawal':
          const currentPenalty = accumulation.earlyWithdrawalPenalties.get(event.accountId) || 0;
          accumulation.earlyWithdrawalPenalties.set(event.accountId, currentPenalty + amount);
          break;

        case 'interest':
          const currentInterest = accumulation.interestTaxes.get(event.accountId) || 0;
          accumulation.interestTaxes.set(event.accountId, currentInterest + amount);
          break;

        case 'rmd':
          const currentRmd = accumulation.rmdTaxes.get(event.accountId) || 0;
          accumulation.rmdTaxes.set(event.accountId, currentRmd + amount);
          break;
      }
    }
  }

  /**
   * Gets tax summary for a year
   */
  getTaxSummaryForYear(taxYear: number): {
    totalTaxes: number;
    totalPenalties: number;
    byType: {
      withdrawalTaxes: number;
      earlyWithdrawalPenalties: number;
      interestTaxes: number;
      rmdTaxes: number;
    };
    eventCount: number;
  } {
    const accumulation = this.taxAccumulations.get(taxYear);

    if (!accumulation) {
      return {
        totalTaxes: 0,
        totalPenalties: 0,
        byType: {
          withdrawalTaxes: 0,
          earlyWithdrawalPenalties: 0,
          interestTaxes: 0,
          rmdTaxes: 0,
        },
        eventCount: 0,
      };
    }

    const withdrawalTaxes = Array.from(accumulation.withdrawalTaxes.values()).reduce((sum, amount) => sum + amount, 0);
    const earlyWithdrawalPenalties = Array.from(accumulation.earlyWithdrawalPenalties.values()).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const interestTaxes = Array.from(accumulation.interestTaxes.values()).reduce((sum, amount) => sum + amount, 0);
    const rmdTaxes = Array.from(accumulation.rmdTaxes.values()).reduce((sum, amount) => sum + amount, 0);

    return {
      totalTaxes: withdrawalTaxes + interestTaxes + rmdTaxes,
      totalPenalties: earlyWithdrawalPenalties,
      byType: {
        withdrawalTaxes,
        earlyWithdrawalPenalties,
        interestTaxes,
        rmdTaxes,
      },
      eventCount: accumulation.taxEvents.length,
    };
  }

  /**
   * Validates tax configuration
   */
  validateTaxConfig(account: Account): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.isRetirementAccount(account)) {
      if (account.withdrawalTaxRate && (account.withdrawalTaxRate < 0 || account.withdrawalTaxRate > 1)) {
        errors.push('Withdrawal tax rate must be between 0 and 1');
      }

      if (account.earlyWithdrawlPenalty && (account.earlyWithdrawlPenalty < 0 || account.earlyWithdrawlPenalty > 1)) {
        errors.push('Early withdrawal penalty must be between 0 and 1');
      }

      if (account.earlyWithdrawlDate && account.earlyWithdrawlDate <= new Date()) {
        errors.push('Early withdrawal date should be in the future');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gets tax calculation statistics
   */
  getStats(): {
    calculationsPerformed: number;
    taxYearsTracked: number;
    totalTaxEvents: number;
    cacheSize: number;
    averageTaxAmount: number;
  } {
    const calculations = Array.from(this.calculationCache.values());
    const totalTaxAmount = calculations.reduce((sum, calc) => sum + calc.totalTaxOwed + calc.totalPenalties, 0);
    const totalEvents = Array.from(this.taxAccumulations.values()).reduce((sum, acc) => sum + acc.taxEvents.length, 0);

    return {
      calculationsPerformed: calculations.length,
      taxYearsTracked: this.taxAccumulations.size,
      totalTaxEvents: totalEvents,
      cacheSize: this.calculationCache.size,
      averageTaxAmount: calculations.length > 0 ? totalTaxAmount / calculations.length : 0,
    };
  }

  /**
   * Clears all caches and accumulations
   */
  clearCache(): void {
    this.calculationCache.clear();
    this.taxEventCache.clear();
    this.taxAccumulations.clear();
  }

  /**
   * Generates a cache key for tax calculations
   */
  private generateCalculationCacheKey(context: TaxCalculationContext): string {
    const parts = [
      context.accountId,
      context.taxYear.toString(),
      context.calculationDate.getTime().toString(),
      context.currentBalance.toString(),
      context.activities.length.toString(),
    ];

    return parts.join('|');
  }

  /**
   * Estimates annual tax liability
   */
  estimateAnnualTaxLiability(
    accounts: Account[],
    projectedWithdrawals: Map<string, number>,
    projectedInterest: Map<string, number>,
    taxYear: number,
  ): {
    estimatedTaxes: number;
    estimatedPenalties: number;
    byAccount: Map<string, { taxes: number; penalties: number }>;
  } {
    let totalTaxes = 0;
    let totalPenalties = 0;
    const byAccount = new Map<string, { taxes: number; penalties: number }>();

    for (const account of accounts) {
      let accountTaxes = 0;
      let accountPenalties = 0;

      // Calculate withdrawal taxes
      const withdrawalAmount = projectedWithdrawals.get(account.id) || 0;
      if (withdrawalAmount > 0 && this.isRetirementAccount(account)) {
        const taxRate = account.withdrawalTaxRate || 0;
        accountTaxes += withdrawalAmount * taxRate;

        // Check for early withdrawal penalty
        if (account.earlyWithdrawlDate && account.earlyWithdrawlDate.getFullYear() > taxYear) {
          const penaltyRate = account.earlyWithdrawlPenalty || 0;
          accountPenalties += withdrawalAmount * penaltyRate;
        }
      }

      // Calculate interest taxes
      const interestAmount = projectedInterest.get(account.id) || 0;
      if (interestAmount > 0 && !this.isTaxDeferredAccount(account)) {
        const taxRate = this.getInterestTaxRate(account, interestAmount);
        accountTaxes += interestAmount * taxRate;
      }

      if (accountTaxes > 0 || accountPenalties > 0) {
        byAccount.set(account.id, { taxes: accountTaxes, penalties: accountPenalties });
      }

      totalTaxes += accountTaxes;
      totalPenalties += accountPenalties;
    }

    return {
      estimatedTaxes: totalTaxes,
      estimatedPenalties: totalPenalties,
      byAccount,
    };
  }
}
