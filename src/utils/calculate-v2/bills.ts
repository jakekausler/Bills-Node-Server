/**
 * Advanced bill processing module for optimized financial calculations
 *
 * This module handles recurring bill scheduling, inflation adjustments,
 * variable amounts, and complex frequency patterns optimized for the
 * new event-based calculation system.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Bill } from '../../data/bill/bill';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';
import { loadVariable } from '../simulation/variable';
import { nextDate } from '../calculate/helpers';
import { debug, warn } from './logger';

dayjs.extend(utc);

/**
 * Bill calculation context
 */
interface BillCalculationContext {
  accountId: string;
  bill: Bill;
  calculationDate: Date;
  simulation: string;
  inflationRates: Map<number, number>;
  variableCache: Map<string, any>;
}

/**
 * Bill calculation result
 */
interface BillCalculationResult {
  amount: number;
  inflationAdjustedAmount: number;
  effectiveInflationRate: number;
  nextOccurrenceDate: Date | null;
  activity: ConsolidatedActivity;
  metadata: {
    originalAmount: number;
    yearsFromStart: number;
    cumulativeInflation: number;
    variableResolved: boolean;
  };
}

/**
 * Bill scheduling information
 */
interface BillSchedule {
  billId: string;
  accountId: string;
  occurrences: BillOccurrence[];
  totalOccurrences: number;
  scheduleComplete: boolean;
}

/**
 * Individual bill occurrence
 */
interface BillOccurrence {
  date: Date;
  amount: number;
  inflationRate: number;
  occurrence: number;
}

/**
 * Advanced bill processor with optimization features
 */
export class BillProcessor {
  private inflationCache: Map<string, Map<number, number>> = new Map();
  private variableCache: Map<string, any> = new Map();
  private scheduleCache: Map<string, BillSchedule> = new Map();
  private calculationCache: Map<string, BillCalculationResult> = new Map();

  /**
   * Processes a bill for a specific date and context
   */
  async processBill(context: BillCalculationContext): Promise<BillCalculationResult> {
    const cacheKey = this.generateCalculationCacheKey(context);
    const cached = this.calculationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.performBillCalculation(context);
    this.calculationCache.set(cacheKey, result);

    return result;
  }

  /**
   * Performs the actual bill calculation
   */
  private async performBillCalculation(context: BillCalculationContext): Promise<BillCalculationResult> {
    const { accountId, bill, calculationDate, simulation } = context;

    // Calculate base amount (handling variables)
    const baseAmount = await this.calculateBaseAmount(bill, simulation);

    // Apply inflation if configured
    const inflationResult = await this.applyInflation(bill, baseAmount, calculationDate);

    // Create consolidated activity
    const activity = this.createBillActivity(
      accountId,
      bill,
      inflationResult.adjustedAmount,
      calculationDate,
      simulation,
    );

    // Calculate next occurrence
    const nextOccurrence = this.calculateNextOccurrence(bill, calculationDate);

    return {
      amount: baseAmount,
      inflationAdjustedAmount: inflationResult.adjustedAmount,
      effectiveInflationRate: inflationResult.effectiveRate,
      nextOccurrenceDate: nextOccurrence,
      activity,
      metadata: {
        originalAmount: typeof bill.amount === 'number' ? bill.amount : 0,
        yearsFromStart: inflationResult.yearsFromStart,
        cumulativeInflation: inflationResult.cumulativeInflation,
        variableResolved: bill.amountIsVariable || false,
      },
    };
  }

  /**
   * Calculates the base amount for a bill (before inflation)
   */
  private calculateBaseAmount(bill: Bill, simulation: string): number {
    // Handle direct amount first (convert string literals to numbers)
    let baseAmount: number;
    if (typeof bill.amount === 'number') {
      baseAmount = bill.amount;
    } else {
      // Handle string literal amounts
      switch (bill.amount) {
        case '{HALF}':
          baseAmount = 0.5;
          break;
        case '{FULL}':
          baseAmount = 1.0;
          break;
        case '-{HALF}':
          baseAmount = -0.5;
          break;
        case '-{FULL}':
          baseAmount = -1.0;
          break;
        default:
          baseAmount = 0;
      }
    }

    if (!bill.amountIsVariable || !bill.amountVariable) {
      return baseAmount;
    }

    // Check variable cache first
    const cacheKey = `${bill.amountVariable}_${simulation}`;
    let variableValue = this.variableCache.get(cacheKey);

    if (variableValue === undefined) {
      variableValue = loadVariable(bill.amountVariable, simulation);
      this.variableCache.set(cacheKey, variableValue);
    }

    if (typeof variableValue === 'number') {
      return variableValue;
    }

    // Handle special fraction values from variables
    if (typeof variableValue === 'string') {
      switch (variableValue) {
        case '{HALF}':
          return baseAmount * 0.5;
        case '{FULL}':
          return baseAmount;
        case '-{HALF}':
          return -baseAmount * 0.5;
        case '-{FULL}':
          return -baseAmount;
        default:
          return baseAmount;
      }
    }

    return baseAmount;
  }

  /**
   * Applies inflation to a bill amount
   */
  private async applyInflation(
    bill: Bill,
    baseAmount: number,
    calculationDate: Date,
  ): Promise<{
    adjustedAmount: number;
    effectiveRate: number;
    yearsFromStart: number;
    cumulativeInflation: number;
  }> {
    if (!bill.increaseBy || bill.increaseBy <= 0 || !bill.startDate) {
      return {
        adjustedAmount: baseAmount,
        effectiveRate: 0,
        yearsFromStart: 0,
        cumulativeInflation: 0,
      };
    }

    const yearsFromStart = dayjs.utc(calculationDate).diff(dayjs.utc(bill.startDate), 'year', true);

    if (yearsFromStart <= 0) {
      return {
        adjustedAmount: baseAmount,
        effectiveRate: bill.increaseBy,
        yearsFromStart: 0,
        cumulativeInflation: 0,
      };
    }

    // Get effective inflation rate (could be variable in the future)
    const effectiveRate = await this.getEffectiveInflationRate(bill, calculationDate);

    // Calculate compound inflation: A = P(1 + r)^t
    const inflationMultiplier = Math.pow(1 + effectiveRate / 100, yearsFromStart);
    const adjustedAmount = baseAmount * inflationMultiplier;
    const cumulativeInflation = (inflationMultiplier - 1) * 100;

    return {
      adjustedAmount,
      effectiveRate,
      yearsFromStart,
      cumulativeInflation,
    };
  }

  /**
   * Gets the effective inflation rate for a bill at a specific date
   */
  private getEffectiveInflationRate(bill: Bill, _date: Date): number {
    // For now, just return the fixed rate
    // In the future, this could support variable inflation rates
    return bill.increaseBy || 0;
  }

  /**
   * Creates a consolidated activity for a bill
   */
  private createBillActivity(
    _accountId: string,
    bill: Bill,
    amount: number,
    date: Date,
    _simulation: string,
  ): ConsolidatedActivity {
    return new ConsolidatedActivity({
      id: `BILL-${bill.id}-${date.getTime()}`,
      name: bill.name,
      amount: amount,
      amountIsVariable: bill.amountIsVariable || false,
      amountVariable: bill.amountVariable,
      date: formatDate(date),
      dateIsVariable: bill.startDateIsVariable || false,
      dateVariable: bill.startDateVariable,
      from: bill.fro,
      to: bill.to,
      isTransfer: bill.isTransfer || false,
      category: bill.category,
      flag: bill.flag || false,
      flagColor: bill.flagColor || null,
    });
  }

  /**
   * Calculates the next occurrence date for a bill
   */
  private calculateNextOccurrence(bill: Bill, currentDate: Date): Date | null {
    if (!bill.periods || !bill.everyN) return null;

    try {
      const nextOccurrence = nextDate(currentDate, bill.periods, bill.everyN);

      // Check if we've passed the end date
      if (bill.endDate && nextOccurrence > bill.endDate) {
        return null;
      }

      return nextOccurrence;
    } catch (error) {
      warn(`Error calculating next occurrence for bill ${bill.id}:`, error);
      return null;
    }
  }

  /**
   * Generates a complete schedule for a bill
   */
  generateBillSchedule(bill: Bill, accountId: string, endDate: Date, simulation: string = 'Default'): BillSchedule {
    const cacheKey = `${bill.id}_${accountId}_${endDate.getTime()}_${simulation}`;
    const cached = this.scheduleCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const schedule = this.createBillSchedule(bill, accountId, endDate, simulation);
    this.scheduleCache.set(cacheKey, schedule);

    return schedule;
  }

  /**
   * Creates a bill schedule
   */
  private createBillSchedule(bill: Bill, accountId: string, endDate: Date, _simulation: string): BillSchedule {
    const occurrences: BillOccurrence[] = [];

    if (!bill.startDate || !bill.periods || !bill.everyN) {
      return {
        billId: bill.id,
        accountId,
        occurrences: [],
        totalOccurrences: 0,
        scheduleComplete: true,
      };
    }

    let currentDate = bill.startDate;
    let occurrenceCount = 0;
    const maxOccurrences = 10000; // Safety limit

    while (
      currentDate <= endDate &&
      (!bill.endDate || currentDate <= bill.endDate) &&
      occurrenceCount < maxOccurrences
    ) {
      // Calculate amount for this occurrence
      const yearsFromStart = dayjs.utc(currentDate).diff(dayjs.utc(bill.startDate), 'year', true);

      // Convert bill.amount to number if it's a string literal
      let baseAmount: number;
      if (typeof bill.amount === 'number') {
        baseAmount = bill.amount;
      } else {
        // Handle string literal amounts
        switch (bill.amount) {
          case '{HALF}':
            baseAmount = 0.5;
            break;
          case '{FULL}':
            baseAmount = 1.0;
            break;
          case '-{HALF}':
            baseAmount = -0.5;
            break;
          case '-{FULL}':
            baseAmount = -1.0;
            break;
          default:
            baseAmount = 0;
        }
      }

      let adjustedAmount = baseAmount;
      let inflationRate = 0;

      if (bill.increaseBy && bill.increaseBy > 0 && yearsFromStart > 0) {
        inflationRate = bill.increaseBy;
        const inflationMultiplier = Math.pow(1 + inflationRate / 100, yearsFromStart);
        adjustedAmount = baseAmount * inflationMultiplier;
      }

      occurrences.push({
        date: new Date(currentDate),
        amount: adjustedAmount,
        inflationRate,
        occurrence: occurrenceCount,
      });

      // Calculate next occurrence
      try {
        currentDate = nextDate(currentDate, bill.periods, bill.everyN);
      } catch (error) {
        warn(`Error calculating next date for bill ${bill.id}:`, error);
        break;
      }

      occurrenceCount++;
    }

    return {
      billId: bill.id,
      accountId,
      occurrences,
      totalOccurrences: occurrenceCount,
      scheduleComplete: occurrenceCount < maxOccurrences,
    };
  }

  /**
   * Batch processes multiple bills
   */
  async batchProcessBills(contexts: BillCalculationContext[]): Promise<Map<string, BillCalculationResult>> {
    const results = new Map<string, BillCalculationResult>();

    // Pre-load all required variables
    const variablesToLoad = new Set<string>();
    for (const context of contexts) {
      if (
        context.bill.amountIsVariable &&
        context.bill.amountVariable &&
        typeof context.bill.amountVariable === 'string'
      ) {
        variablesToLoad.add(`${context.bill.amountVariable}_${context.simulation}`);
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

    // Process all bills
    for (const context of contexts) {
      const result = await this.processBill(context);
      const key = `${context.accountId}_${context.bill.id}_${context.calculationDate.getTime()}`;
      results.set(key, result);
    }

    return results;
  }

  /**
   * Validates bill configuration
   */
  validateBillConfig(bill: Bill): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!bill.id) {
      errors.push('Bill must have an ID');
    }

    if (!bill.name) {
      errors.push('Bill must have a name');
    }

    if (bill.amount === undefined || bill.amount === null) {
      errors.push('Bill must have an amount');
    }

    if (!bill.periods) {
      errors.push('Bill must have periods');
    } else if (!this.isValidPeriod(bill.periods)) {
      errors.push(`Invalid period: ${bill.periods}`);
    }

    if (!bill.everyN || bill.everyN < 1) {
      errors.push('Bill must have everyN >= 1');
    }

    if (bill.amountIsVariable && !bill.amountVariable) {
      errors.push('Variable amount bills must specify amountVariable');
    }

    if (bill.increaseBy && (bill.increaseBy < 0 || bill.increaseBy > 100)) {
      errors.push('Inflation rate must be between 0 and 100');
    }

    if (bill.endDate && bill.startDate && bill.endDate <= bill.startDate) {
      errors.push('End date must be after start date');
    }

    if (bill.isTransfer) {
      if (!bill.fro || !bill.to) {
        errors.push('Transfer bills must specify both from and to accounts');
      }
      if (bill.fro === bill.to) {
        errors.push('Transfer bills cannot have the same from and to account');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Checks if a period string is valid
   */
  private isValidPeriod(period: string): boolean {
    const validPeriods = ['day', 'week', 'month', 'year'];
    return validPeriods.includes(period);
  }

  /**
   * Gets bill processing statistics
   */
  getStats(): {
    billsProcessed: number;
    cacheSize: number;
    scheduleCacheSize: number;
    variableCacheSize: number;
    averageAmount: number;
    totalInflationAdjustment: number;
  } {
    const calculations = Array.from(this.calculationCache.values());
    const totalAmount = calculations.reduce((sum, calc) => sum + calc.inflationAdjustedAmount, 0);
    const totalInflation = calculations.reduce((sum, calc) => sum + calc.metadata.cumulativeInflation, 0);

    return {
      billsProcessed: calculations.length,
      cacheSize: this.calculationCache.size,
      scheduleCacheSize: this.scheduleCache.size,
      variableCacheSize: this.variableCache.size,
      averageAmount: calculations.length > 0 ? totalAmount / calculations.length : 0,
      totalInflationAdjustment: totalInflation,
    };
  }

  /**
   * Estimates the impact of inflation on a bill over time
   */
  estimateInflationImpact(
    bill: Bill,
    years: number,
  ): {
    originalAmount: number;
    inflatedAmount: number;
    totalIncrease: number;
    percentageIncrease: number;
  } {
    // Convert bill.amount to number
    const originalAmount = typeof bill.amount === 'number' ? bill.amount : 0;
    const inflationRate = bill.increaseBy || 0;

    if (inflationRate <= 0 || years <= 0) {
      return {
        originalAmount,
        inflatedAmount: originalAmount,
        totalIncrease: 0,
        percentageIncrease: 0,
      };
    }

    const inflatedAmount = originalAmount * Math.pow(1 + inflationRate / 100, years);
    const totalIncrease = inflatedAmount - originalAmount;
    const percentageIncrease = (totalIncrease / originalAmount) * 100;

    return {
      originalAmount,
      inflatedAmount,
      totalIncrease,
      percentageIncrease,
    };
  }

  /**
   * Finds bills that occur on a specific date
   */
  findBillsForDate(bills: Bill[], targetDate: Date): Bill[] {
    return bills.filter((bill) => {
      if (!bill.startDate || !bill.periods || !bill.everyN) return false;

      let currentDate = bill.startDate;
      const maxIterations = 1000; // Safety limit
      let iterations = 0;

      while (
        currentDate <= targetDate &&
        (!bill.endDate || currentDate <= bill.endDate) &&
        iterations < maxIterations
      ) {
        if (dayjs.utc(currentDate).isSame(dayjs.utc(targetDate), 'day')) {
          return true;
        }

        try {
          currentDate = nextDate(currentDate, bill.periods, bill.everyN);
        } catch (_error) {
          break;
        }

        iterations++;
      }

      return false;
    });
  }

  /**
   * Clears all caches
   */
  clearCache(): void {
    this.calculationCache.clear();
    this.scheduleCache.clear();
    this.variableCache.clear();
    this.inflationCache.clear();
  }

  /**
   * Clears specific cache types
   */
  clearCacheType(type: 'calculation' | 'schedule' | 'variable' | 'inflation'): void {
    switch (type) {
      case 'calculation':
        this.calculationCache.clear();
        break;
      case 'schedule':
        this.scheduleCache.clear();
        break;
      case 'variable':
        this.variableCache.clear();
        break;
      case 'inflation':
        this.inflationCache.clear();
        break;
    }
  }

  /**
   * Generates a cache key for bill calculations
   */
  private generateCalculationCacheKey(context: BillCalculationContext): string {
    const parts = [
      context.accountId,
      context.bill.id,
      context.calculationDate.getTime().toString(),
      context.simulation,
      context.bill.amount.toString(),
      (context.bill.increaseBy || 0).toString(),
    ];

    return parts.join('|');
  }

  /**
   * Pre-loads variable values for a simulation
   */
  preloadVariables(variableNames: string[], simulation: string): void {
    for (const variable of variableNames) {
      const cacheKey = `${variable}_${simulation}`;
      if (!this.variableCache.has(cacheKey)) {
        const value = loadVariable(variable, simulation);
        this.variableCache.set(cacheKey, value);
      }
    }
  }

  /**
   * Gets the next N occurrences for a bill
   */
  getNextOccurrences(bill: Bill, startDate: Date, count: number): Date[] {
    const occurrences: Date[] = [];

    if (!bill.periods || !bill.everyN || count <= 0) {
      return occurrences;
    }

    let currentDate = startDate;
    let iterations = 0;
    const maxIterations = Math.min(count * 2, 1000); // Safety limit

    while (occurrences.length < count && iterations < maxIterations) {
      if (currentDate >= (bill.startDate || startDate) && (!bill.endDate || currentDate <= bill.endDate)) {
        occurrences.push(new Date(currentDate));
      }

      try {
        currentDate = nextDate(currentDate, bill.periods, bill.everyN);
      } catch (_error) {
        break;
      }

      iterations++;
    }

    return occurrences;
  }
}
