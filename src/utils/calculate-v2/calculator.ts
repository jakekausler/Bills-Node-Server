/**
 * Core calculation logic for processing financial events
 * 
 * This module contains the actual calculation logic for different event types,
 * replacing the complex nested loops in the original system with focused,
 * event-specific processing functions.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ActivityEvent,
  BillEvent,
  InterestEvent,
  TransferEvent,
  PushPullEvent,
  CalculationConfig,
} from './types';
import { CacheManager } from './cache';
import { DependencyGraph } from './dependency';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';
import { AccountsAndTransfers } from '../../data/account/types';
import { loadVariable } from '../simulation/variable';

dayjs.extend(utc);

/**
 * Handles the actual calculation logic for different event types
 */
export class Calculator {
  private config: CalculationConfig;
  private cache: CacheManager;
  private dependencyGraph: DependencyGraph;
  private balanceTracker: any;

  constructor(config: CalculationConfig, cache: CacheManager, dependencyGraph: DependencyGraph, balanceTracker: any) {
    this.config = config;
    this.cache = cache;
    this.dependencyGraph = dependencyGraph;
    this.balanceTracker = balanceTracker;
  }

  /**
   * Processes an activity event (manual transaction)
   */
  async processActivityEvent(event: ActivityEvent, segmentResult: any): Promise<void> {
    try {
      console.log(`[Calculator] Processing activity event: ${event.id}`);
      
      const activity = event.activity;
      const accountId = event.accountId;

      if (!activity) {
        throw new Error(`Activity is undefined for event ${event.id}`);
      }
      if (!accountId) {
        throw new Error(`AccountId is undefined for event ${event.id}`);
      }

      console.log(`[Calculator] Activity: ${activity.name}, Amount: ${activity.amount}, Account: ${accountId}`);

      // Add the activity to the segment result
      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId).push(activity);

      // Update balance in segment result
      const balanceChange = activity.amount as number;
      const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, currentChange + balanceChange);
      
      console.log(`[Calculator] Balance change: ${balanceChange}, New total change: ${currentChange + balanceChange}`);
    } catch (error) {
      console.error(`[Calculator] Error processing activity event ${event.id}:`, error);
      throw error;
    }
  }

  /**
   * Processes a bill event (recurring payment/income)
   */
  async processBillEvent(event: BillEvent, segmentResult: any): Promise<void> {
    const bill = event.bill;
    const accountId = event.accountId;
    const amount = event.amount;

    // Create consolidated activity for the bill
    const billActivity = new ConsolidatedActivity({
      id: `BILL-${bill.id}-${event.date.getTime()}`,
      name: bill.name,
      amount: amount,
      amountIsVariable: event.isVariable,
      amountVariable: bill.amountVariable,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: bill.category,
      flag: bill.flag || false,
      flagColor: bill.flagColor || null
    });

    // Add to segment result
    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId).push(billActivity);

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + amount);
  }

  /**
   * Processes an interest event (compound interest application)
   */
  async processInterestEvent(event: InterestEvent, segmentResult: any): Promise<void> {
    const interest = event.interest;
    const accountId = event.accountId;

    // Get current balance (including changes in this segment)
    const currentBalance = this.getCurrentSegmentBalance(accountId, segmentResult);

    // Calculate interest amount
    const interestAmount = this.calculateInterestAmount(currentBalance, event.rate, interest.compounded);

    // Only create activities for amounts >= $0.00001 (filter out floating-point noise)
    if (Math.abs(interestAmount) < 0.00001) {
      return;
    }
    
    // Create consolidated activity for interest
    const interestActivity = new ConsolidatedActivity({
        id: `INTEREST-${interest.id}-${event.date.getTime()}`,
        name: `Interest - ${interest.id}`,
        amount: interestAmount,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(event.date),
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        isTransfer: false,
        category: 'Banking.Interest',
        flag: false,
        flagColor: null
      });

      // Add to segment result
      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId).push(interestActivity);

      // Update balance
      const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, currentChange + interestAmount);

    // Track taxable interest if not tax-deferred
    if (!event.taxDeferred) {
      this.addTaxableInterest(accountId, interestAmount, segmentResult);
    }
  }

  /**
   * Processes a transfer event (money movement between accounts)
   */
  async processTransferEvent(event: TransferEvent, segmentResult: any): Promise<void> {
    const transfer = event.transfer;
    const fromAccountId = event.fromAccountId;
    const toAccountId = event.toAccountId;
    
    // Calculate actual transfer amount, resolving {FULL} and {HALF} based on current balance
    let amount = event.amount;
    
    // Check if this is a {FULL} or {HALF} transfer that needs balance resolution
    if ((transfer.amountIsVariable && transfer.amountVariable) || typeof transfer.amount === 'string') {
      const toAccountBalance = this.getCurrentAccountBalance(toAccountId, segmentResult);
      
      // Handle variable amounts
      if (transfer.amountIsVariable && transfer.amountVariable) {
        switch (transfer.amountVariable) {
          case '{FULL}':
            // Transfer enough to zero out the destination account
            amount = -toAccountBalance;
            break;
          case '{HALF}':
            // Transfer half of what's needed to zero out the destination account
            amount = -toAccountBalance * 0.5;
            break;
          case '-{FULL}':
            // Reverse: transfer the full balance of destination account
            amount = toAccountBalance;
            break;
          case '-{HALF}':
            // Reverse: transfer half the balance of destination account
            amount = toAccountBalance * 0.5;
            break;
        }
      }
      // Handle direct string amounts
      else if (typeof transfer.amount === 'string') {
        switch (transfer.amount) {
          case '{FULL}':
            // Transfer enough to zero out the destination account
            amount = -toAccountBalance;
            break;
          case '{HALF}':
            // Transfer half of what's needed to zero out the destination account
            amount = -toAccountBalance * 0.5;
            break;
          case '-{FULL}':
            // Reverse: transfer the full balance of destination account
            amount = toAccountBalance;
            break;
          case '-{HALF}':
            // Reverse: transfer half the balance of destination account
            amount = toAccountBalance * 0.5;
            break;
        }
      }
    }

    // Create activities for both accounts
    const fromActivity = new ConsolidatedActivity({
      id: `TRANSFER-${transfer.id}-${event.date.getTime()}-FROM`,
      name: transfer.name, // Use the original transfer name
      amount: -amount,
      amountIsVariable: transfer.amountIsVariable || false,
      amountVariable: transfer.amountVariable || null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: transfer.from,
      to: transfer.to,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: transfer.flag || false,
      flagColor: transfer.flagColor || 'blue'
    });

    const toActivity = new ConsolidatedActivity({
      id: `TRANSFER-${transfer.id}-${event.date.getTime()}-TO`,
      name: transfer.name, // Use the original transfer name
      amount: amount,
      amountIsVariable: transfer.amountIsVariable || false,
      amountVariable: transfer.amountVariable || null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: transfer.from,
      to: transfer.to,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: transfer.flag || false,
      flagColor: transfer.flagColor || 'blue'
    });

    // Add activities to segment result
    if (!segmentResult.activitiesAdded.has(fromAccountId)) {
      segmentResult.activitiesAdded.set(fromAccountId, []);
    }
    if (!segmentResult.activitiesAdded.has(toAccountId)) {
      segmentResult.activitiesAdded.set(toAccountId, []);
    }

    segmentResult.activitiesAdded.get(fromAccountId).push(fromActivity);
    segmentResult.activitiesAdded.get(toAccountId).push(toActivity);

    // Update balances
    const fromCurrentChange = segmentResult.balanceChanges.get(fromAccountId) || 0;
    const toCurrentChange = segmentResult.balanceChanges.get(toAccountId) || 0;

    segmentResult.balanceChanges.set(fromAccountId, fromCurrentChange - amount);
    segmentResult.balanceChanges.set(toAccountId, toCurrentChange + amount);
  }

  /**
   * Processes a pension event
   */
  async processPensionEvent(_event: any, _segmentResult: any): Promise<void> {
    // TODO: Implement pension processing
    // This would integrate with the existing pension calculation logic
    console.log('Pension event processing not yet implemented');
  }

  /**
   * Processes a social security event
   */
  async processSocialSecurityEvent(_event: any, _segmentResult: any): Promise<void> {
    // TODO: Implement social security processing
    // This would integrate with the existing social security calculation logic
    console.log('Social Security event processing not yet implemented');
  }

  /**
   * Processes a tax event
   */
  async processTaxEvent(_event: any, _segmentResult: any): Promise<void> {
    // TODO: Implement tax processing
    // This would handle pull taxes, interest taxes, etc.
    console.log('Tax event processing not yet implemented');
  }

  /**
   * Processes an RMD (Required Minimum Distribution) event
   */
  async processRMDEvent(_event: any, _segmentResult: any): Promise<void> {
    // TODO: Implement RMD processing
    // This would integrate with the existing RMD calculation logic
    console.log('RMD event processing not yet implemented');
  }

  /**
   * Processes a push/pull check event (monthly balance optimization)
   */
  async processPushPullEvent(
    event: PushPullEvent,
    accountsAndTransfers: AccountsAndTransfers,
    options: any,
    segmentResult: any
  ): Promise<void> {
    // Get the SmartPushPullProcessor from the engine
    const pushPullProcessor = options.pushPullProcessor;
    if (!pushPullProcessor) {
      console.warn('Push/Pull processor not available, skipping');
      return;
    }

    // Create context for push/pull processing
    const context = {
      checkDate: event.date,
      accountsAndTransfers,
      balanceTracker: options.balanceTracker,
      simulation: options.simulation || 'Default',
      monteCarlo: options.monteCarlo || false
    };

    try {
      // Process monthly push/pull operations
      const result = await pushPullProcessor.processMonthlyPushPull(context);

      // Apply the results to segment result
      if (result.executed) {
        // Add push activities
        for (const activity of result.pushActivities) {
          this.addActivityToSegmentResult(activity, segmentResult);
        }

        // Add pull activities  
        for (const activity of result.pullActivities) {
          this.addActivityToSegmentResult(activity, segmentResult);
        }

        // Apply balance changes
        for (const [accountId, change] of result.balanceChanges) {
          const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
          segmentResult.balanceChanges.set(accountId, currentChange + change);
        }

        // Store tax implications for later processing
        if (result.taxImplications.length > 0) {
          if (!segmentResult.taxImplications) {
            segmentResult.taxImplications = [];
          }
          segmentResult.taxImplications.push(...result.taxImplications);
        }
      }

    } catch (error) {
      console.error('Push/Pull processing failed:', error);
      // Continue processing - don't fail the entire calculation for push/pull issues
    }
  }

  // Helper methods

  /**
   * Adds an activity to the segment result
   */
  private addActivityToSegmentResult(activity: ConsolidatedActivity, segmentResult: any): void {
    // Determine which account this activity belongs to based on the activity's from/to
    let _accountId = '';
    
    // For transfers, we need to add to both accounts
    if (activity.isTransfer && activity.fro && activity.to) {
      // Convert amount to number for calculations
      const activityAmount = typeof activity.amount === 'number' ? activity.amount : 0;
      
      // Find the accounts by name
      const fromAccount = segmentResult.accountsAndTransfers?.accounts?.find((acc: any) => acc.name === activity.fro);
      const toAccount = segmentResult.accountsAndTransfers?.accounts?.find((acc: any) => acc.name === activity.to);
      
      if (fromAccount) {
        if (!segmentResult.activitiesAdded.has(fromAccount.id)) {
          segmentResult.activitiesAdded.set(fromAccount.id, []);
        }
        // Create a copy for the from account (negative amount)
        const fromActivity = new ConsolidatedActivity({
          ...activity.serialize(),
          amount: -Math.abs(activityAmount)
        });
        segmentResult.activitiesAdded.get(fromAccount.id).push(fromActivity);
      }
      
      if (toAccount) {
        if (!segmentResult.activitiesAdded.has(toAccount.id)) {
          segmentResult.activitiesAdded.set(toAccount.id, []);
        }
        // Create a copy for the to account (positive amount)
        const toActivity = new ConsolidatedActivity({
          ...activity.serialize(),
          amount: Math.abs(activityAmount)
        });
        segmentResult.activitiesAdded.get(toAccount.id).push(toActivity);
      }
    } else {
      // For non-transfer activities, try to determine the account from context
      // This is a fallback - the push/pull processor should handle account assignment
      console.warn('Non-transfer activity in push/pull result - may need account assignment logic');
    }
  }

  /**
   * Gets the current balance for an account including segment changes
   */
  private getCurrentSegmentBalance(accountId: string, segmentResult: any): number {
    // Get the current balance from the balance tracker
    const currentBalance = this.balanceTracker.getAccountBalance(accountId);
    
    // Add any changes made in this segment
    const segmentChanges = segmentResult.balanceChanges.get(accountId) || 0;
    
    return currentBalance + segmentChanges;
  }

  /**
   * Calculates interest amount based on balance, rate, and frequency
   */
  private calculateInterestAmount(balance: number, annualRate: number, frequency: string): number {
    if (balance === 0 || annualRate === 0) return 0;

    // Convert annual rate to period rate based on frequency
    let periodsPerYear = 1;

    // Add defensive check for undefined frequency
    if (!frequency || typeof frequency !== 'string') {
      frequency = 'month'; // Default to monthly
    }

    switch (frequency.toLowerCase()) {
      case 'day':
      case 'daily':
        periodsPerYear = 365;
        break;
      case 'week':
      case 'weekly':
        periodsPerYear = 52;
        break;
      case 'month':
      case 'monthly':
        periodsPerYear = 12;
        break;
      case 'quarter':
      case 'quarterly':
        periodsPerYear = 4;
        break;
      case 'year':
      case 'yearly':
      case 'annual':
        periodsPerYear = 1;
        break;
      default:
        // Try to parse as number (e.g., "6 months" -> 2 periods per year)
        const match = frequency.match(/(\d+)\s*(month|day|week|year)/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];

          switch (unit) {
            case 'day':
              periodsPerYear = 365 / amount;
              break;
            case 'week':
              periodsPerYear = 52 / amount;
              break;
            case 'month':
              periodsPerYear = 12 / amount;
              break;
            case 'year':
              periodsPerYear = 1 / amount;
              break;
          }
        } else {
          // Fall back to monthly if we can't parse
          periodsPerYear = 12;
        }
    }

    const periodRate = annualRate / periodsPerYear;
    const interest = balance * periodRate;
    
    // Return raw calculation without rounding to match original behavior exactly
    return interest;
  }

  /**
   * Adds taxable interest for later tax calculation
   */
  private addTaxableInterest(accountId: string, amount: number, segmentResult: any): void {
    if (!segmentResult.interestStateChanges.has(accountId)) {
      segmentResult.interestStateChanges.set(accountId, {});
    }

    const stateChanges = segmentResult.interestStateChanges.get(accountId);
    stateChanges.accumulatedTaxableInterest = (stateChanges.accumulatedTaxableInterest || 0) + amount;
  }

  /**
   * Resolves variable values for calculations
   */
  private resolveVariable(variable: string | null, simulation: string): number {
    if (!variable) return 0;

    const value = loadVariable(variable, simulation);

    if (typeof value === 'number') {
      return value;
    }

    // Handle special fraction values
    if (typeof value === 'string') {
      switch (value) {
        case '{HALF}':
          return 0.5;
        case '{FULL}':
          return 1.0;
        case '-{HALF}':
          return -0.5;
        case '-{FULL}':
          return -1.0;
        default:
          return 0;
      }
    }

    return 0;
  }

  /**
   * Creates a standardized activity ID
   */
  private createActivityId(type: string, sourceId: string, date: Date, suffix?: string): string {
    try {
      if (!type) {
        throw new Error('Type is undefined');
      }
      if (!sourceId) {
        throw new Error('SourceId is undefined');
      }
      if (!date) {
        throw new Error('Date is undefined');
      }
      
      const timestamp = date.getTime();
      if (isNaN(timestamp)) {
        throw new Error(`Invalid date: ${date}`);
      }
      
      const parts = [type.toUpperCase(), sourceId, timestamp.toString()];

      if (suffix) {
        parts.push(suffix);
      }

      return parts.join('-');
    } catch (error) {
      console.error(`[Calculator] Error creating activity ID:`, { type, sourceId, date, suffix });
      throw new Error(`Failed to create activity ID: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates that an amount is reasonable
   */
  private validateAmount(amount: number, context: string): boolean {
    if (!isFinite(amount)) {
      console.warn(`Invalid amount (${amount}) in ${context}`);
      return false;
    }

    // Check for unreasonably large amounts (> $1B)
    if (Math.abs(amount) > 1_000_000_000) {
      console.warn(`Unreasonably large amount (${amount}) in ${context}`);
      return false;
    }

    return true;
  }

  /**
   * Formats currency amount for display
   */
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  /**
   * Gets performance metrics for the calculator
   */
  getMetrics(): {
    eventsProcessed: number;
    averageProcessingTime: number;
    errorCount: number;
  } {
    // TODO: Implement metrics tracking
    return {
      eventsProcessed: 0,
      averageProcessingTime: 0,
      errorCount: 0
    };
  }

  /**
   * Validates a segment result for consistency
   */
  validateSegmentResult(segmentResult: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check that balance changes are finite numbers
    for (const [accountId, change] of segmentResult.balanceChanges) {
      if (!isFinite(change)) {
        errors.push(`Invalid balance change for account ${accountId}: ${change}`);
      }
    }

    // Check that activities have required fields
    for (const [accountId, activities] of segmentResult.activitiesAdded) {
      for (const activity of activities) {
        if (!activity.id) {
          errors.push(`Activity missing ID for account ${accountId}`);
        }
        if (!activity.name) {
          errors.push(`Activity missing name for account ${accountId}`);
        }
        if (!isFinite(activity.amount)) {
          errors.push(`Activity has invalid amount for account ${accountId}: ${activity.amount}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Gets the current balance of an account including changes made during the current segment
   */
  private getCurrentAccountBalance(accountId: string, segmentResult: any): number {
    // Get the account's starting balance from the balance tracker
    const startingBalance = this.balanceTracker?.getAccountBalance(accountId) || 0;
    
    // Add any balance changes accumulated during this segment
    const balanceChanges = segmentResult.balanceChanges.get(accountId) || 0;
    
    return startingBalance + balanceChanges;
  }
}