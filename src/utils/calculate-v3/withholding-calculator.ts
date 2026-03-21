import { FilingStatus } from './bracket-calculator';
import { W4Config } from '../../data/bill/paycheck-types';
import { DebugLogger } from './debug-logger';

/**
 * Callback function that looks up federal tax for a given taxable income and filing status.
 * Typically provided by computeAnnualFederalTax or a bracket-based calculator.
 */
export type BracketLookup = (
  taxableIncome: number,
  filingStatus: FilingStatus,
  year: number,
) => number;

export class WithholdingCalculator {
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
      component: 'withholding-calculator',
      event,
      ...(this.currentDate ? { ts: this.currentDate } : {}),
      ...data,
    });
  }

  /**
   * Compute per-paycheck federal withholding using bracket-based estimate.
   *
   * @param taxableWagesPerPeriod - gross pay minus pre-tax deductions for this paycheck
   * @param periodsPerYear - number of pay periods (26 for biweekly, 12 for monthly, etc.)
   * @param filingStatus - from TaxProfile
   * @param w4Config - W-4 settings from PaycheckProfile (optional)
   * @param year - tax year
   * @param standardDeduction - annual standard deduction for the filing status
   * @param bracketLookup - callback to look up federal tax for taxable income
   */
  computeFederalWithholding(
    taxableWagesPerPeriod: number,
    periodsPerYear: number,
    filingStatus: FilingStatus,
    w4Config: W4Config | undefined,
    year: number,
    standardDeduction: number,
    bracketLookup: BracketLookup,
  ): number {
    // Step 1: Annualize wages
    const annualWages = taxableWagesPerPeriod * periodsPerYear;

    // Step 2: Subtract standard deduction to get taxable income
    // (W-4 percentage method uses standard deduction, not itemized)
    const taxableIncome = Math.max(0, annualWages - standardDeduction);

    // Step 3: Look up annual tax from brackets
    let filingStatusForLookup = filingStatus;
    let annualTax = bracketLookup(taxableIncome, filingStatusForLookup, year);

    // Step 4: W-4 adjustments
    if (w4Config?.multipleJobs) {
      // Higher withholding for multiple jobs — approximate by using single filer brackets
      // This roughly increases the withholding to account for combined income pushing into higher brackets
      annualTax = bracketLookup(taxableIncome, 'single', year);
    }

    // Step 5: Divide by periods to get per-paycheck amount
    let perPeriodWithholding = annualTax / periodsPerYear;

    // Step 6: Add extra withholding
    if (w4Config?.extraWithholding) {
      perPeriodWithholding += w4Config.extraWithholding;
    }

    this.log('federal-withholding-computed', {
      taxableWagesPerPeriod,
      periodsPerYear,
      filingStatus,
      year,
      annualWages,
      standardDeduction,
      taxableIncome,
      annualTax,
      perPeriodWithholding,
      multipleJobs: w4Config?.multipleJobs,
      extraWithholding: w4Config?.extraWithholding,
    });

    return Math.max(0, perPeriodWithholding);
  }

  /**
   * Compute per-paycheck bonus federal withholding at flat supplemental rate.
   *
   * @param bonusGross - gross bonus amount
   * @param preTaxDeductions - pre-tax deductions applied to bonus
   * @returns withholding amount at 22% flat supplemental rate
   */
  computeBonusWithholding(bonusGross: number, preTaxDeductions: number): number {
    const taxable = bonusGross - preTaxDeductions;
    const withholding = taxable * 0.22; // 22% flat supplemental rate
    this.log('bonus-withholding-computed', {
      bonusGross,
      preTaxDeductions,
      taxable,
      withholding,
    });
    return Math.max(0, withholding);
  }
}
