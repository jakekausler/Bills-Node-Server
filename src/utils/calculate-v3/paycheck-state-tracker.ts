import type { DebugLogger } from './debug-logger';

/**
 * Tracks YTD state for paycheck processing, including:
 * - Social Security wage cap tracking per person per year
 * - Medicare wage threshold tracking per person per year
 * - Paycheck count per bill per month (for deduction frequency logic)
 * - Checkpoint/restore for push/pull reprocessing
 */
export class PaycheckStateTracker {
  // YTD SS wages per person (keyed by DOB timestamp string)
  private ytdSSWages: Map<string, Map<number, number>> = new Map();
  // YTD Medicare wages per person
  private ytdMedicareWages: Map<string, Map<number, number>> = new Map();
  // Paycheck count per bill name per month (YYYY-MM key)
  private paycheckCountInMonth: Map<string, Map<string, number>> = new Map();

  private checkpointData: string | null = null;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, {
      component: 'paycheck-state',
      event,
      ...(this.currentDate ? { ts: this.currentDate } : {}),
      ...data,
    });
  }

  /**
   * Add SS wages for a person in a given year.
   * Returns the amount that fits under the annual cap.
   * If adding `amount` would exceed the cap, returns only the portion that fits.
   */
  addSSWages(personKey: string, year: number, amount: number, annualCap: number): number {
    if (amount <= 0) return 0;
    if (annualCap <= 0) return 0;
    if (!this.ytdSSWages.has(personKey)) {
      this.ytdSSWages.set(personKey, new Map());
    }
    const yearMap = this.ytdSSWages.get(personKey)!;
    const currentYTD = yearMap.get(year) ?? 0;

    if (currentYTD >= annualCap) {
      this.log('ss-wages-at-cap', { personKey, year, currentYTD, annualCap, added: 0 });
      return 0; // already at cap
    }

    const room = annualCap - currentYTD;
    const taxableAmount = Math.min(amount, room);
    yearMap.set(year, currentYTD + taxableAmount);

    this.log('ss-wages-added', {
      personKey,
      year,
      amount,
      taxableAmount,
      newYTD: currentYTD + taxableAmount,
      annualCap,
    });
    return taxableAmount;
  }

  /**
   * Add Medicare wages for a person in a given year.
   * Returns whether the additional Medicare threshold has been exceeded.
   * The threshold is $200K single / $250K MFJ.
   */
  addMedicareWages(personKey: string, year: number, amount: number, additionalMedicareThreshold: number): {
    totalMedicareWages: number;
    additionalMedicareApplies: boolean;
    wagesAboveThreshold: number;
    wagesBelowThreshold: number;
  } {
    if (amount <= 0) return { totalMedicareWages: this.getYTDMedicareWages(personKey, year), additionalMedicareApplies: false, wagesAboveThreshold: 0, wagesBelowThreshold: 0 };
    if (!this.ytdMedicareWages.has(personKey)) {
      this.ytdMedicareWages.set(personKey, new Map());
    }
    const yearMap = this.ytdMedicareWages.get(personKey)!;
    const previousYTD = yearMap.get(year) ?? 0;
    const newYTD = previousYTD + amount;
    yearMap.set(year, newYTD);

    // Compute how much of THIS paycheck's wages are above vs below the threshold
    let wagesAboveThreshold = 0;
    let wagesBelowThreshold = amount;

    if (newYTD > additionalMedicareThreshold) {
      if (previousYTD >= additionalMedicareThreshold) {
        // Entirely above threshold
        wagesAboveThreshold = amount;
        wagesBelowThreshold = 0;
      } else {
        // Crosses threshold this paycheck
        wagesBelowThreshold = additionalMedicareThreshold - previousYTD;
        wagesAboveThreshold = amount - wagesBelowThreshold;
      }
    }

    this.log('medicare-wages-added', {
      personKey,
      year,
      amount,
      newYTD,
      additionalMedicareThreshold,
      wagesAboveThreshold,
    });

    return {
      totalMedicareWages: newYTD,
      additionalMedicareApplies: newYTD > additionalMedicareThreshold,
      wagesAboveThreshold,
      wagesBelowThreshold,
    };
  }

  /**
   * Get and increment the paycheck count for a bill in a given month.
   * Returns the count BEFORE incrementing (0-indexed: 0 = first paycheck, 1 = second, 2 = third).
   * Used for deduction frequency logic: monthly deductions skip when count >= 2.
   */
  getAndIncrementPaycheckCount(billName: string, yearMonth: string): number {
    if (!this.paycheckCountInMonth.has(billName)) {
      this.paycheckCountInMonth.set(billName, new Map());
    }
    const monthMap = this.paycheckCountInMonth.get(billName)!;
    const currentCount = monthMap.get(yearMonth) ?? 0;
    monthMap.set(yearMonth, currentCount + 1);

    this.log('paycheck-count', { billName, yearMonth, count: currentCount });
    return currentCount;
  }

  /**
   * Check if a deduction should apply for this paycheck based on frequency.
   * @param frequency - 'perPaycheck' | 'monthly' | 'annual'
   * @param paycheckIndex - 0-indexed count of paycheck in month (from getAndIncrementPaycheckCount)
   * @param isFirstPaycheckOfYear - whether this is the first paycheck of the year
   */
  shouldApplyDeduction(frequency: 'perPaycheck' | 'monthly' | 'annual', paycheckIndex: number, isFirstPaycheckOfYear: boolean): boolean {
    switch (frequency) {
      case 'perPaycheck':
        return true;
      case 'monthly':
        return paycheckIndex < 2; // skip 3rd+ paycheck of month
      case 'annual':
        return isFirstPaycheckOfYear;
      default:
        return true; // default to perPaycheck behavior
    }
  }

  /**
   * Get YTD SS wages for a person in a given year.
   */
  getYTDSSWages(personKey: string, year: number): number {
    return this.ytdSSWages.get(personKey)?.get(year) ?? 0;
  }

  /**
   * Get YTD Medicare wages for a person in a given year.
   */
  getYTDMedicareWages(personKey: string, year: number): number {
    return this.ytdMedicareWages.get(personKey)?.get(year) ?? 0;
  }

  /**
   * Checkpoint current state for push/pull reprocessing.
   * Follows ContributionLimitManager pattern.
   */
  checkpoint(): void {
    const ssWagesObj: Record<string, Record<string, number>> = {};
    this.ytdSSWages.forEach((yearMap, personKey) => {
      ssWagesObj[personKey] = {};
      yearMap.forEach((amount, year) => {
        ssWagesObj[personKey][year.toString()] = amount;
      });
    });

    const medicareWagesObj: Record<string, Record<string, number>> = {};
    this.ytdMedicareWages.forEach((yearMap, personKey) => {
      medicareWagesObj[personKey] = {};
      yearMap.forEach((amount, year) => {
        medicareWagesObj[personKey][year.toString()] = amount;
      });
    });

    const paycheckCountObj: Record<string, Record<string, number>> = {};
    this.paycheckCountInMonth.forEach((monthMap, billName) => {
      paycheckCountObj[billName] = {};
      monthMap.forEach((count, yearMonth) => {
        paycheckCountObj[billName][yearMonth] = count;
      });
    });

    this.checkpointData = JSON.stringify({
      ssWages: ssWagesObj,
      medicareWages: medicareWagesObj,
      paycheckCount: paycheckCountObj,
    });
    this.log('checkpoint-saved');
  }

  /**
   * Restore state from checkpoint.
   */
  restore(): void {
    if (!this.checkpointData) return;

    const data = JSON.parse(this.checkpointData);

    this.ytdSSWages = new Map();
    for (const personKey of Object.keys(data.ssWages)) {
      const yearMap = new Map<number, number>();
      for (const yearStr of Object.keys(data.ssWages[personKey])) {
        yearMap.set(parseInt(yearStr, 10), data.ssWages[personKey][yearStr]);
      }
      this.ytdSSWages.set(personKey, yearMap);
    }

    this.ytdMedicareWages = new Map();
    for (const personKey of Object.keys(data.medicareWages)) {
      const yearMap = new Map<number, number>();
      for (const yearStr of Object.keys(data.medicareWages[personKey])) {
        yearMap.set(parseInt(yearStr, 10), data.medicareWages[personKey][yearStr]);
      }
      this.ytdMedicareWages.set(personKey, yearMap);
    }

    this.paycheckCountInMonth = new Map();
    for (const billName of Object.keys(data.paycheckCount)) {
      const monthMap = new Map<string, number>();
      for (const yearMonth of Object.keys(data.paycheckCount[billName])) {
        monthMap.set(yearMonth, data.paycheckCount[billName][yearMonth]);
      }
      this.paycheckCountInMonth.set(billName, monthMap);
    }

    this.log('checkpoint-restored');
  }

  /**
   * Clear YTD accumulators for a given year. Memory optimization for long-horizon simulations.
   */
  resetYear(year: number): void {
    for (const [, yearMap] of this.ytdSSWages) {
      yearMap.delete(year);
    }
    for (const [, yearMap] of this.ytdMedicareWages) {
      yearMap.delete(year);
    }
    const yearPrefix = `${year}-`;
    for (const [, monthMap] of this.paycheckCountInMonth) {
      for (const key of monthMap.keys()) {
        if (key.startsWith(yearPrefix)) {
          monthMap.delete(key);
        }
      }
    }
    this.log('year-reset', { year });
  }
}
