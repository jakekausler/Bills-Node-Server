/**
 * Advanced transfer handling module for optimized financial calculations
 * 
 * This module handles money movements between accounts including one-time transfers,
 * recurring transfers, complex transfer rules, and dependency management optimized
 * for the new event-based calculation system.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Transfer } from './types';
// Transfer data is handled through AccountsAndTransfers.transfers
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';
import { loadVariable } from '../simulation/variable';
import { nextDate } from '../calculate/helpers';
import { Account } from '../../data/account/account';

dayjs.extend(utc);

/**
 * Transfer calculation context
 */
interface TransferCalculationContext {
  transfer: Transfer;
  fromAccountId: string;
  toAccountId: string;
  calculationDate: Date;
  simulation: string;
  fromBalance: number;
  toBalance: number;
  variableCache: Map<string, any>;
}

/**
 * Transfer calculation result
 */
interface TransferCalculationResult {
  amount: number;
  actualAmount: number;
  transferExecuted: boolean;
  reason: string;
  fromActivity: ConsolidatedActivity | null;
  toActivity: ConsolidatedActivity | null;
  nextOccurrenceDate: Date | null;
  metadata: {
    originalAmount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
    variableResolved: boolean;
    balanceConstraintApplied: boolean;
    taxImplications: TaxImplication[];
  };
}

/**
 * Tax implications for transfers
 */
interface TaxImplication {
  accountId: string;
  taxType: 'withdrawal' | 'earlyWithdrawal' | 'rmd';
  taxableAmount: number;
  taxRate: number;
  penaltyRate: number;
  dueDate: Date;
}

/**
 * Transfer validation result
 */
interface TransferValidationResult {
  valid: boolean;
  canExecute: boolean;
  errors: string[];
  warnings: string[];
  suggestedAmount?: number;
}

/**
 * Transfer schedule for recurring transfers
 */
interface TransferSchedule {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  occurrences: TransferOccurrence[];
  totalOccurrences: number;
  scheduleComplete: boolean;
}

/**
 * Individual transfer occurrence
 */
interface TransferOccurrence {
  date: Date;
  amount: number;
  occurrence: number;
  estimated: boolean;
}

/**
 * Advanced transfer processor with optimization features
 */
export class TransferProcessor {
  private variableCache: Map<string, any> = new Map();
  private scheduleCache: Map<string, TransferSchedule> = new Map();
  private calculationCache: Map<string, TransferCalculationResult> = new Map();
  private accountCache: Map<string, Account> = new Map();

  /**
   * Processes a transfer for a specific context
   */
  async processTransfer(context: TransferCalculationContext): Promise<TransferCalculationResult> {
    const cacheKey = this.generateCalculationCacheKey(context);
    const cached = this.calculationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.performTransferCalculation(context);
    this.calculationCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Performs the actual transfer calculation
   */
  private async performTransferCalculation(context: TransferCalculationContext): Promise<TransferCalculationResult> {
    const { transfer, fromAccountId, toAccountId, calculationDate, simulation, fromBalance, toBalance } = context;

    // Calculate base amount (handling variables)
    const baseAmount = await this.calculateTransferAmount(transfer, simulation, fromBalance);
    
    // Validate transfer constraints
    const validation = await this.validateTransfer(transfer, fromAccountId, toAccountId, baseAmount, fromBalance, toBalance);
    
    if (!validation.canExecute) {
      return this.createFailedTransferResult(transfer, fromAccountId, toAccountId, baseAmount, validation.errors.join('; '), calculationDate);
    }

    // Apply balance constraints if necessary
    const actualAmount = validation.suggestedAmount || baseAmount;
    const balanceConstraintApplied = actualAmount !== baseAmount;

    // Create transfer activities
    const { fromActivity, toActivity } = this.createTransferActivities(
      transfer,
      fromAccountId,
      toAccountId,
      actualAmount,
      calculationDate,
      simulation
    );

    // Calculate tax implications
    const taxImplications = await this.calculateTaxImplications(
      transfer,
      fromAccountId,
      toAccountId,
      actualAmount,
      calculationDate
    );

    // Calculate next occurrence for recurring transfers
    const nextOccurrence = this.calculateNextOccurrence(transfer, calculationDate);

    return {
      amount: baseAmount,
      actualAmount,
      transferExecuted: true,
      reason: 'Transfer completed successfully',
      fromActivity,
      toActivity,
      nextOccurrenceDate: nextOccurrence,
      metadata: {
        originalAmount: transfer.amount,
        variableResolved: transfer.amountIsVariable || false,
        balanceConstraintApplied,
        taxImplications
      }
    };
  }

  /**
   * Calculates the transfer amount (handling variables)
   */
  private async calculateTransferAmount(transfer: Transfer, simulation: string, fromBalance: number = 0): Promise<number> {
    // Handle direct amount first (convert string literals to numbers)
    let baseAmount: number;
    if (typeof transfer.amount === 'number') {
      baseAmount = transfer.amount;
    } else {
      // Handle string literal amounts
      switch (transfer.amount) {
        case '{HALF}':
          baseAmount = fromBalance * 0.5;
          break;
        case '{FULL}':
          baseAmount = fromBalance;
          break;
        case '-{HALF}':
          baseAmount = -fromBalance * 0.5;
          break;
        case '-{FULL}':
          baseAmount = -fromBalance;
          break;
        default:
          baseAmount = 0;
      }
    }

    if (!transfer.amountIsVariable || !transfer.amountVariable) {
      return baseAmount;
    }

    // Check variable cache first
    const cacheKey = `${transfer.amountVariable}_${simulation}`;
    let variableValue = this.variableCache.get(cacheKey);

    if (variableValue === undefined) {
      variableValue = loadVariable(transfer.amountVariable, simulation);
      this.variableCache.set(cacheKey, variableValue);
    }

    if (typeof variableValue === 'number') {
      return variableValue;
    }

    // Handle special fraction values from variables
    if (typeof variableValue === 'string') {
      switch (variableValue) {
        case '{HALF}':
          return fromBalance * 0.5;
        case '{FULL}':
          return fromBalance;
        case '-{HALF}':
          return -fromBalance * 0.5;
        case '-{FULL}':
          return -fromBalance;
        default:
          return baseAmount;
      }
    }

    return baseAmount;
  }

  /**
   * Validates a transfer for execution
   */
  private async validateTransfer(
    transfer: Transfer,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    fromBalance: number,
    toBalance: number
  ): Promise<TransferValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let suggestedAmount: number | undefined;

    // Basic validation
    if (amount <= 0) {
      errors.push('Transfer amount must be positive');
    }

    if (fromAccountId === toAccountId) {
      errors.push('Cannot transfer to the same account');
    }

    // Get account information for advanced validation
    const fromAccount = this.accountCache.get(fromAccountId);
    const toAccount = this.accountCache.get(toAccountId);

    // Balance validation for source account
    if (fromAccount) {
      const minimumBalance = fromAccount.minimumBalance || 0;
      const availableBalance = fromBalance - minimumBalance;

      if (amount > availableBalance) {
        if (availableBalance > 0) {
          suggestedAmount = availableBalance;
          warnings.push(`Transfer amount reduced to ${availableBalance} due to minimum balance constraint`);
        } else {
          errors.push('Insufficient funds for transfer');
        }
      }

      // Check withdrawal limits for retirement accounts
      if (this.isRetirementAccount(fromAccount) && !this.isQualifiedWithdrawal(fromAccount, new Date())) {
        warnings.push('Early withdrawal penalties may apply');
      }
    }

    // Destination account validation
    if (toAccount) {
      // Check contribution limits for retirement accounts
      if (this.isRetirementAccount(toAccount)) {
        const contributionLimit = this.getAnnualContributionLimit(toAccount, new Date());
        if (amount > contributionLimit) {
          warnings.push(`Transfer exceeds annual contribution limit of ${contributionLimit}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      canExecute: errors.length === 0,
      errors,
      warnings,
      suggestedAmount
    };
  }

  /**
   * Creates transfer activities for both accounts
   */
  private createTransferActivities(
    transfer: Transfer,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    date: Date,
    simulation: string
  ): { fromActivity: ConsolidatedActivity; toActivity: ConsolidatedActivity } {
    const timestamp = date.getTime();
    
    const fromActivity = new ConsolidatedActivity({
      id: `TRANSFER-${transfer.id}-${timestamp}-FROM`,
      name: `Transfer to ${transfer.to}`,
      amount: -amount,
      amountIsVariable: transfer.amountIsVariable || false,
      amountVariable: transfer.amountVariable || null,
      date: formatDate(date),
      dateIsVariable: transfer.dateIsVariable || false,
      dateVariable: transfer.dateVariable || null,
      from: transfer.from,
      to: transfer.to,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: transfer.flag || false,
      flagColor: transfer.flagColor || 'blue'
    });

    const toActivity = new ConsolidatedActivity({
      id: `TRANSFER-${transfer.id}-${timestamp}-TO`,
      name: `Transfer from ${transfer.from}`,
      amount: amount,
      amountIsVariable: transfer.amountIsVariable || false,
      amountVariable: transfer.amountVariable || null,
      date: formatDate(date),
      dateIsVariable: transfer.dateIsVariable || false,
      dateVariable: transfer.dateVariable || null,
      from: transfer.from,
      to: transfer.to,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: transfer.flag || false,
      flagColor: transfer.flagColor || 'blue'
    });

    return { fromActivity, toActivity };
  }

  /**
   * Calculates tax implications for a transfer
   */
  private async calculateTaxImplications(
    transfer: Transfer,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    date: Date
  ): Promise<TaxImplication[]> {
    const implications: TaxImplication[] = [];
    
    const fromAccount = this.accountCache.get(fromAccountId);
    
    if (!fromAccount) {
      return implications;
    }

    // Check for withdrawal taxes from retirement accounts
    if (this.isRetirementAccount(fromAccount)) {
      const taxRate = fromAccount.withdrawalTaxRate || 0;
      
      if (taxRate > 0) {
        const taxDueDate = this.calculateTaxDueDate(date);
        
        implications.push({
          accountId: fromAccountId,
          taxType: 'withdrawal',
          taxableAmount: amount,
          taxRate,
          penaltyRate: 0,
          dueDate: taxDueDate
        });
      }

      // Check for early withdrawal penalties
      if (fromAccount.earlyWithdrawlDate && date < fromAccount.earlyWithdrawlDate) {
        const penaltyRate = fromAccount.earlyWithdrawlPenalty || 0;
        
        if (penaltyRate > 0) {
          const taxDueDate = this.calculateTaxDueDate(date);
          
          implications.push({
            accountId: fromAccountId,
            taxType: 'earlyWithdrawal',
            taxableAmount: amount,
            taxRate: 0,
            penaltyRate,
            dueDate: taxDueDate
          });
        }
      }
    }

    return implications;
  }

  /**
   * Calculates the next occurrence date for recurring transfers
   */
  private calculateNextOccurrence(transfer: Transfer, currentDate: Date): Date | null {
    if (!transfer.periods || !transfer.everyN) return null;

    try {
      const nextOccurrence = nextDate(currentDate, transfer.periods, transfer.everyN);
      
      // Check if we've passed the end date
      if (transfer.endDate && nextOccurrence > transfer.endDate) {
        return null;
      }

      return nextOccurrence;
    } catch (error) {
      console.warn(`Error calculating next occurrence for transfer ${transfer.id}:`, error);
      return null;
    }
  }

  /**
   * Creates a failed transfer result
   */
  private createFailedTransferResult(
    transfer: Transfer,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason: string,
    date: Date
  ): TransferCalculationResult {
    return {
      amount,
      actualAmount: 0,
      transferExecuted: false,
      reason,
      fromActivity: null,
      toActivity: null,
      nextOccurrenceDate: this.calculateNextOccurrence(transfer, date),
      metadata: {
        originalAmount: transfer.amount,
        variableResolved: transfer.amountIsVariable || false,
        balanceConstraintApplied: false,
        taxImplications: []
      }
    };
  }

  /**
   * Generates a complete schedule for a recurring transfer
   */
  generateTransferSchedule(
    transfer: Transfer,
    fromAccountId: string,
    toAccountId: string,
    endDate: Date,
    simulation: string = 'Default'
  ): TransferSchedule {
    const cacheKey = `${transfer.id}_${fromAccountId}_${toAccountId}_${endDate.getTime()}_${simulation}`;
    const cached = this.scheduleCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const schedule = this.createTransferSchedule(transfer, fromAccountId, toAccountId, endDate, simulation);
    this.scheduleCache.set(cacheKey, schedule);
    
    return schedule;
  }

  /**
   * Creates a transfer schedule
   */
  private createTransferSchedule(
    transfer: Transfer,
    fromAccountId: string,
    toAccountId: string,
    endDate: Date,
    simulation: string
  ): TransferSchedule {
    const occurrences: TransferOccurrence[] = [];
    
    if (!transfer.startDate || !transfer.periods || !transfer.everyN) {
      return {
        transferId: transfer.id,
        fromAccountId,
        toAccountId,
        occurrences: [],
        totalOccurrences: 0,
        scheduleComplete: true
      };
    }

    let currentDate = transfer.startDate;
    let occurrenceCount = 0;
    const maxOccurrences = 10000; // Safety limit

    while (currentDate <= endDate && 
           (!transfer.endDate || currentDate <= transfer.endDate) &&
           occurrenceCount < maxOccurrences) {

      // Calculate amount for this occurrence
      let baseAmount: number;
      if (typeof transfer.amount === 'number') {
        baseAmount = transfer.amount;
      } else {
        // For schedule generation, we can't know the actual balance, so use placeholder
        baseAmount = 0; // This will need proper handling later
      }

      occurrences.push({
        date: new Date(currentDate),
        amount: baseAmount,
        occurrence: occurrenceCount,
        estimated: transfer.amountIsVariable || typeof transfer.amount !== 'number'
      });

      // Calculate next occurrence
      try {
        currentDate = nextDate(currentDate, transfer.periods, transfer.everyN);
      } catch (error) {
        console.warn(`Error calculating next date for transfer ${transfer.id}:`, error);
        break;
      }

      occurrenceCount++;
    }

    return {
      transferId: transfer.id,
      fromAccountId,
      toAccountId,
      occurrences,
      totalOccurrences: occurrenceCount,
      scheduleComplete: occurrenceCount < maxOccurrences
    };
  }

  /**
   * Batch processes multiple transfers
   */
  async batchProcessTransfers(
    contexts: TransferCalculationContext[]
  ): Promise<Map<string, TransferCalculationResult>> {
    const results = new Map<string, TransferCalculationResult>();

    // Pre-load all required variables
    const variablesToLoad = new Set<string>();
    for (const context of contexts) {
      if (context.transfer.amountIsVariable && context.transfer.amountVariable && typeof context.transfer.amountVariable === 'string') {
        variablesToLoad.add(`${context.transfer.amountVariable}_${context.simulation}`);
      }
    }

    // Load variables in batch
    for (const variableKey of variablesToLoad) {
      if (!this.variableCache.has(variableKey) && typeof variableKey === 'string' && variableKey.includes('_')) {
        const [variable, simulation] = variableKey.split('_');
        const value = loadVariable(variable, simulation);
        this.variableCache.set(variableKey, value);
      }
    }

    // Process all transfers
    for (const context of contexts) {
      const result = await this.processTransfer(context);
      const key = `${context.fromAccountId}_${context.toAccountId}_${context.transfer.id}_${context.calculationDate.getTime()}`;
      results.set(key, result);
    }

    return results;
  }

  /**
   * Sets account cache for validation
   */
  setAccountCache(accounts: Account[]): void {
    this.accountCache.clear();
    for (const account of accounts) {
      this.accountCache.set(account.id, account);
    }
  }

  /**
   * Validates transfer configuration
   */
  validateTransferConfig(transfer: Transfer): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!transfer.id) {
      errors.push('Transfer must have an ID');
    }

    if (transfer.amount === undefined || transfer.amount === null) {
      errors.push('Transfer must have an amount');
    } else if (typeof transfer.amount === 'number' && transfer.amount <= 0) {
      errors.push('Transfer amount must be positive');
    }

    if (!transfer.from) {
      errors.push('Transfer must have a from account');
    }

    if (!transfer.to) {
      errors.push('Transfer must have a to account');
    }

    if (transfer.from === transfer.to) {
      errors.push('Transfer cannot have the same from and to account');
    }

    if (transfer.amountIsVariable && !transfer.amountVariable) {
      errors.push('Variable amount transfers must specify amountVariable');
    }

    if (transfer.endDate && transfer.startDate && transfer.endDate <= transfer.startDate) {
      errors.push('End date must be after start date');
    }

    if (!transfer.periods) {
      errors.push('Transfer must have periods');
    } else if (!this.isValidPeriod(transfer.periods)) {
      errors.push(`Invalid period: ${transfer.periods}`);
    }
    
    if (!transfer.everyN || transfer.everyN < 1) {
      errors.push('Transfer must have everyN >= 1');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Helper methods

  private isRetirementAccount(account: Account): boolean {
    return ['401k', 'IRA', 'Roth IRA', 'Pension'].includes(account.type);
  }

  private isQualifiedWithdrawal(account: Account, date: Date): boolean {
    if (!account.earlyWithdrawlDate) return true;
    return date >= account.earlyWithdrawlDate;
  }

  private getAnnualContributionLimit(account: Account, year: Date): number {
    // This would be based on IRS limits for the year and account type
    // For now, return a placeholder
    const yearNum = dayjs.utc(year).year();
    
    switch (account.type) {
      case '401k':
        return yearNum >= 2024 ? 23000 : 22500;
      case 'IRA':
      case 'Roth IRA':
        return yearNum >= 2024 ? 7000 : 6500;
      default:
        return Number.MAX_SAFE_INTEGER; // No limit
    }
  }

  private calculateTaxDueDate(transactionDate: Date): Date {
    // Taxes are typically due on April 1st of the following year
    const year = dayjs.utc(transactionDate).year();
    return dayjs.utc(`${year + 1}-04-01`).toDate();
  }

  private isValidPeriod(period: string): boolean {
    const validPeriods = ['day', 'week', 'month', 'year'];
    return validPeriods.includes(period);
  }

  private generateCalculationCacheKey(context: TransferCalculationContext): string {
    const parts = [
      context.fromAccountId,
      context.toAccountId,
      context.transfer.id,
      context.calculationDate.getTime().toString(),
      context.simulation,
      context.transfer.amount.toString(),
      context.fromBalance.toString(),
      context.toBalance.toString()
    ];
    
    return parts.join('|');
  }

  /**
   * Gets transfer processing statistics
   */
  getStats(): {
    transfersProcessed: number;
    successfulTransfers: number;
    failedTransfers: number;
    cacheSize: number;
    scheduleCacheSize: number;
    variableCacheSize: number;
    averageAmount: number;
    totalTaxImplications: number;
  } {
    const calculations = Array.from(this.calculationCache.values());
    const successful = calculations.filter(calc => calc.transferExecuted);
    const failed = calculations.filter(calc => !calc.transferExecuted);
    const totalAmount = successful.reduce((sum, calc) => sum + calc.actualAmount, 0);
    const totalTaxImplications = calculations.reduce((sum, calc) => sum + calc.metadata.taxImplications.length, 0);

    return {
      transfersProcessed: calculations.length,
      successfulTransfers: successful.length,
      failedTransfers: failed.length,
      cacheSize: this.calculationCache.size,
      scheduleCacheSize: this.scheduleCache.size,
      variableCacheSize: this.variableCache.size,
      averageAmount: successful.length > 0 ? totalAmount / successful.length : 0,
      totalTaxImplications
    };
  }

  /**
   * Clears all caches
   */
  clearCache(): void {
    this.calculationCache.clear();
    this.scheduleCache.clear();
    this.variableCache.clear();
  }

  /**
   * Pre-loads variable values for a simulation
   */
  async preloadVariables(variableNames: string[], simulation: string): Promise<void> {
    for (const variable of variableNames) {
      const cacheKey = `${variable}_${simulation}`;
      if (!this.variableCache.has(cacheKey)) {
        const value = loadVariable(variable, simulation);
        this.variableCache.set(cacheKey, value);
      }
    }
  }

  /**
   * Finds transfers that occur on a specific date
   */
  findTransfersForDate(transfers: Transfer[], targetDate: Date): Transfer[] {
    return transfers.filter(transfer => {
      if (!transfer.startDate || !transfer.periods || !transfer.everyN) {
        // One-time transfer
        return transfer.startDate && dayjs.utc(transfer.startDate).isSame(dayjs.utc(targetDate), 'day');
      }
      
      let currentDate = transfer.startDate;
      const maxIterations = 1000; // Safety limit
      let iterations = 0;

      while (currentDate <= targetDate && 
             (!transfer.endDate || currentDate <= transfer.endDate) &&
             iterations < maxIterations) {
        
        if (dayjs.utc(currentDate).isSame(dayjs.utc(targetDate), 'day')) {
          return true;
        }

        try {
          currentDate = nextDate(currentDate, transfer.periods, transfer.everyN);
        } catch (_error) {
          break;
        }

        iterations++;
      }

      return false;
    });
  }
}