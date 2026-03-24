import { W4Config } from '../../data/bill/paycheck-types';
import { DebugLogger } from './debug-logger';
import * as fs from 'fs';
import * as path from 'path';

type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

type WithholdingBracket = {
  min: number;
  max: number | null;
  base: number;
  rate: number;
};

type WithholdingSchedule = {
  standardDeduction: number;
  brackets: WithholdingBracket[];
};

type YearTables = {
  standard: Record<FilingStatus, WithholdingSchedule>;
  step2: Record<FilingStatus, WithholdingSchedule>;
};

/**
 * Callback function that looks up federal tax for a given taxable income and filing status.
 * Retained for backward compatibility with existing code that passes bracketLookup.
 */
export type BracketLookup = (
  taxableIncome: number,
  filingStatus: FilingStatus,
  year: number,
) => number;

let cachedTables: Record<string, YearTables> | null = null;

function loadWithholdingTables(): Record<string, YearTables> {
  if (cachedTables) return cachedTables;
  try {
    const filePath = path.join(__dirname, '../../../data/federalWithholdingTables.json');
    cachedTables = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return cachedTables!;
  } catch {
    // Fallback: try relative to compiled dist
    try {
      const filePath = path.join(__dirname, '../../data/federalWithholdingTables.json');
      cachedTables = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return cachedTables!;
    } catch {
      cachedTables = {};
      return cachedTables;
    }
  }
}

function getTablesForYear(year: number): YearTables | null {
  const tables = loadWithholdingTables();
  // Try exact year, then fall back to most recent available
  if (tables[String(year)]) return tables[String(year)];
  const available = Object.keys(tables).map(Number).sort((a, b) => b - a);
  const closest = available.find(y => y <= year) || available[0];
  return closest ? tables[String(closest)] : null;
}

function lookupBracketTax(adjustedAnnualWage: number, brackets: WithholdingBracket[]): number {
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (adjustedAnnualWage >= bracket.min) {
      const excess = adjustedAnnualWage - bracket.min;
      return bracket.base + excess * bracket.rate;
    }
  }
  return 0;
}

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
   * Compute per-paycheck federal withholding using IRS Worksheet 1A (2020+ W-4).
   *
   * @param taxableWagesPerPeriod - gross pay minus pre-tax deductions for this paycheck
   * @param periodsPerYear - number of pay periods (26 for biweekly, 12 for monthly, etc.)
   * @param filingStatus - from W-4 Step 1(c)
   * @param w4Config - W-4 settings from PaycheckProfile
   * @param year - tax year
   * @param standardDeduction - unused, retained for backward compatibility
   * @param bracketLookup - unused, retained for backward compatibility
   */
  computeFederalWithholding(
    taxableWagesPerPeriod: number,
    periodsPerYear: number,
    filingStatus: FilingStatus,
    w4Config: W4Config | undefined,
    year: number,
    standardDeduction?: number,
    bracketLookup?: BracketLookup,
  ): number {
    const yearTables = getTablesForYear(year);
    if (!yearTables) {
      // Fallback to old method if no tables available
      if (bracketLookup && standardDeduction !== undefined) {
        return this.fallbackCompute(taxableWagesPerPeriod, periodsPerYear, filingStatus, w4Config, year, standardDeduction, bracketLookup);
      }
      return 0;
    }

    const useStep2 = w4Config?.multipleJobs ?? false;
    const tableSet = useStep2 ? yearTables.step2 : yearTables.standard;
    const schedule = tableSet[filingStatus] || tableSet['single'];

    // Step 1: Adjust the employee's payment amount
    // 1a: taxableWagesPerPeriod (gross - pre-tax deductions)
    // 1b: periodsPerYear
    // 1c: Annualize
    const annualWages = taxableWagesPerPeriod * periodsPerYear;

    // 1d: Step 4(a) other income
    const otherIncome = w4Config?.otherIncome ?? 0;

    // 1e: Add
    const line1e = annualWages + otherIncome;

    // 1f: Step 4(b) deductions
    const additionalDeductions = w4Config?.deductions ?? 0;

    // 1g: Standard deduction (from table — $12,900 MFJ / $8,600 otherwise if not Step 2; $0 if Step 2)
    const withholdingStdDeduction = schedule.standardDeduction;

    // 1h: Add 1f and 1g
    const line1h = additionalDeductions + withholdingStdDeduction;

    // 1i: Adjusted Annual Wage Amount
    const adjustedAnnualWage = Math.max(0, line1e - line1h);

    // Step 2: Figure the Tentative Withholding Amount
    const annualTax = lookupBracketTax(adjustedAnnualWage, schedule.brackets);

    // 2h: Divide by pay periods
    const tentativeWithholding = annualTax / periodsPerYear;

    // Step 3: Account for tax credits
    const dependentCredit = w4Config?.dependentCredit ?? 0;
    const creditPerPeriod = dependentCredit / periodsPerYear;
    const afterCredits = Math.max(0, tentativeWithholding - creditPerPeriod);

    // Step 4: Final amount
    const extraWithholding = w4Config?.extraWithholding ?? 0;
    const finalWithholding = afterCredits + extraWithholding;

    this.log('federal-withholding-computed', {
      taxableWagesPerPeriod,
      periodsPerYear,
      filingStatus,
      year,
      annualWages,
      otherIncome,
      additionalDeductions,
      withholdingStdDeduction,
      adjustedAnnualWage,
      annualTax,
      tentativeWithholding,
      dependentCredit,
      afterCredits,
      extraWithholding,
      finalWithholding,
      useStep2,
    });

    return Math.max(0, finalWithholding);
  }

  /**
   * Fallback computation when no withholding tables are available.
   * Uses the old bracket-lookup method.
   */
  private fallbackCompute(
    taxableWagesPerPeriod: number,
    periodsPerYear: number,
    filingStatus: FilingStatus,
    w4Config: W4Config | undefined,
    year: number,
    standardDeduction: number,
    bracketLookup: BracketLookup,
  ): number {
    const annualWages = taxableWagesPerPeriod * periodsPerYear;
    const taxableIncome = Math.max(0, annualWages - standardDeduction);
    let annualTax = bracketLookup(taxableIncome, filingStatus, year);
    if (w4Config?.multipleJobs) {
      annualTax = bracketLookup(taxableIncome, 'single', year);
    }
    let perPeriod = annualTax / periodsPerYear;
    if (w4Config?.extraWithholding) {
      perPeriod += w4Config.extraWithholding;
    }
    return Math.max(0, perPeriod);
  }

  /**
   * Compute per-paycheck bonus federal withholding at flat supplemental rate.
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
