import { TaxableOccurrence, FilingStatus, MCRateGetter, WithholdingOccurrence, TaxReconciliation } from './types';
import { computeAnnualFederalTax, calculateTaxableSS, calculateProgressiveTax, getBracketDataForYear } from './bracket-calculator';
import type { DebugLogger } from './debug-logger';
import type { DeductionTracker } from './deduction-tracker';
import type { TaxProfile } from './tax-profile-types';

export class TaxManager {
  // Map of years to account ids to taxable events
  private taxableOccurrences: Map<number, Map<string, TaxableOccurrence[]>>;
  // Cache of computed tax amounts per year
  private taxCache: Map<number, number>;
  // Map of years to withholding occurrences
  private withholdingOccurrences: Map<number, WithholdingOccurrence[]> = new Map();
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private checkpointData: string | null = null;

  constructor(debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.taxableOccurrences = new Map<number, Map<string, TaxableOccurrence[]>>();
    this.taxCache = new Map<number, number>();
    this.withholdingOccurrences = new Map<number, WithholdingOccurrence[]>();
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'tax', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  // Add multiple taxable occurences for an account
  public addTaxableOccurrences(accountId: string, events: TaxableOccurrence[]): void {
    for (const event of events) {
      this.addTaxableOccurrence(accountId, event);
    }
  }

  // Add a taxable event for an account
  public addTaxableOccurrence(accountId: string, event: TaxableOccurrence): void {
    if (!this.taxableOccurrences.has(event.year)) {
      this.taxableOccurrences.set(event.year, new Map<string, TaxableOccurrence[]>());
    }

    const yearMap = this.taxableOccurrences.get(event.year)!;
    if (!yearMap.has(accountId)) {
      yearMap.set(accountId, []);
    }
    yearMap.get(accountId)?.push(event);
    this.log('occurrence-added', { account: accountId, year: event.year, amount: event.amount, income_type: event.incomeType });
  }

  // Get all taxable events for an account in a specific year
  public getTaxableOccurrences(accountId: string, year: number): TaxableOccurrence[] {
    const yearMap = this.taxableOccurrences.get(year);
    if (!yearMap) {
      return [];
    }
    return yearMap.get(accountId) || [];
  }

  // Get all taxable occurrences across all accounts for a given year
  public getAllOccurrencesForYear(year: number): TaxableOccurrence[] {
    const yearMap = this.taxableOccurrences.get(year);
    if (!yearMap) return [];
    const all: TaxableOccurrence[] = [];
    for (const occurrences of yearMap.values()) {
      all.push(...occurrences);
    }
    return all;
  }

  // Calculate total tax owed for a year using progressive brackets
  public calculateTotalTaxOwed(
    year: number,
    filingStatus: FilingStatus = 'mfj',
    bracketInflationRate: number = 0.03,
    mcRateGetter?: MCRateGetter | null,
  ): number {
    // Check cache first
    if (this.taxCache.has(year)) {
      return this.taxCache.get(year)!;
    }

    const allOccurrences = this.getAllOccurrencesForYear(year);

    let ordinaryIncome = 0;
    let ssIncome = 0;
    let penaltyTotal = 0;

    for (const occurrence of allOccurrences) {
      switch (occurrence.incomeType) {
        case 'ordinary':
        case 'retirement':
        case 'interest':
          ordinaryIncome += occurrence.amount;
          break;
        case 'socialSecurity':
          ssIncome += occurrence.amount;
          break;
        case 'penalty':
          penaltyTotal += occurrence.amount; // Pre-computed dollar amount
          break;
      }
    }

    this.log('income-aggregated', { year, ordinary_income: ordinaryIncome, ss_income: ssIncome, penalty_total: penaltyTotal });

    const result = computeAnnualFederalTax(ordinaryIncome, ssIncome, filingStatus, year, bracketInflationRate, mcRateGetter);
    const totalTax = result.tax + penaltyTotal;

    // Determine SS taxation tier based on provisional income vs thresholds
    const provisionalIncome = ordinaryIncome + ssIncome * 0.5;
    let ssTier: string;
    if (provisionalIncome <= result.ssThresholds.tier1) {
      ssTier = '0%';
    } else if (provisionalIncome <= result.ssThresholds.tier2) {
      ssTier = '50%';
    } else {
      ssTier = '85%';
    }
    this.log('ss-taxation-computed', { year, ss_income: ssIncome, provisional_income: provisionalIncome, taxable_ss: result.taxableSS, tier: ssTier });

    const effectiveRate = (ordinaryIncome + ssIncome) > 0 ? totalTax / (ordinaryIncome + ssIncome) : 0;
    this.log('annual-tax-calculated', { year, taxable_income: result.taxableIncome, total_tax: totalTax, effective_rate: effectiveRate });

    // Cache the result
    this.taxCache.set(year, totalTax);
    return totalTax;
  }

  // Clear all taxable events for an account in a specific year
  public clearTaxableOccurrences(accountId: string, year: number): void {
    const yearMap = this.taxableOccurrences.get(year);
    if (yearMap) {
      yearMap.delete(accountId);
      // Clean up empty year maps
      if (yearMap.size === 0) {
        this.taxableOccurrences.delete(year);
      }
    }
    // Invalidate cache for this year
    this.taxCache.delete(year);
    this.log('cache-invalidated', { account: accountId, year });
  }

  // Clear all taxable events for all accounts in a specific year
  public clearAllTaxableOccurrences(year: number): void {
    this.taxableOccurrences.delete(year);
    // Invalidate cache for this year
    this.taxCache.delete(year);
  }

  // Get all accounts that have taxable events in a specific year
  public getAccountsWithTaxableEvents(year: number): string[] {
    const yearMap = this.taxableOccurrences.get(year);
    return yearMap ? Array.from(yearMap.keys()) : [];
  }

  /**
   * Save a checkpoint of tax manager state.
   * Used for push/pull reprocessing to restore state if segment needs to be recomputed.
   */
  public checkpoint(): void {
    // Deep-clone taxableOccurrences via JSON serialization
    // Must convert Date objects to ISO strings
    const taxObj: Record<number, Record<string, Array<{ date: string; year: number; amount: number; incomeType: string }>>> = {};
    for (const [year, accountMap] of this.taxableOccurrences) {
      taxObj[year] = {};
      for (const [accountId, occurrences] of accountMap) {
        taxObj[year][accountId] = occurrences.map(occ => ({
          date: occ.date.toISOString(),
          year: occ.year,
          amount: occ.amount,
          incomeType: occ.incomeType,
        }));
      }
    }

    // Serialize withholdingOccurrences (convert Dates to ISO strings)
    const withObj: Record<number, Array<{ date: string; year: number; federalAmount: number; stateAmount: number; source: string }>> = {};
    for (const [year, withholdings] of this.withholdingOccurrences) {
      withObj[year] = withholdings.map(w => ({
        date: w.date.toISOString(),
        year: w.year,
        federalAmount: w.federalAmount,
        stateAmount: w.stateAmount,
        source: w.source,
      }));
    }

    const checkpoint = { taxableOccurrences: taxObj, withholdingOccurrences: withObj };
    this.checkpointData = JSON.stringify(checkpoint);
  }

  /**
   * Restore tax manager state from the last checkpoint.
   * Used when segment is reprocessed after push/pull handling.
   */
  public restore(): void {
    if (!this.checkpointData) return;

    const checkpoint = JSON.parse(this.checkpointData) as {
      taxableOccurrences: Record<number, Record<string, Array<{ date: string; year: number; amount: number; incomeType: string }>>>;
      withholdingOccurrences: Record<number, Array<{ date: string; year: number; federalAmount: number; stateAmount: number; source: string }>>;
    };

    // Restore taxable occurrences
    this.taxableOccurrences = new Map();
    for (const yearStr of Object.keys(checkpoint.taxableOccurrences)) {
      const year = Number(yearStr);
      const accountMap = new Map<string, TaxableOccurrence[]>();
      for (const accountId of Object.keys(checkpoint.taxableOccurrences[year])) {
        const occurrences = checkpoint.taxableOccurrences[year][accountId].map(occ => ({
          date: new Date(occ.date),
          year: occ.year,
          amount: occ.amount,
          incomeType: occ.incomeType as any,
        }));
        accountMap.set(accountId, occurrences);
      }
      this.taxableOccurrences.set(year, accountMap);
    }

    // Restore withholding occurrences
    this.withholdingOccurrences = new Map();
    for (const yearStr of Object.keys(checkpoint.withholdingOccurrences)) {
      const year = Number(yearStr);
      const withholdings = checkpoint.withholdingOccurrences[year].map(w => ({
        date: new Date(w.date),
        year: w.year,
        federalAmount: w.federalAmount,
        stateAmount: w.stateAmount,
        source: w.source,
      }));
      this.withholdingOccurrences.set(year, withholdings);
    }

    // Clear cache after restoration
    this.taxCache.clear();
  }

  /**
   * Add a withholding occurrence (e.g., from paycheck)
   */
  public addWithholdingOccurrence(occurrence: WithholdingOccurrence): void {
    if (!this.withholdingOccurrences.has(occurrence.year)) {
      this.withholdingOccurrences.set(occurrence.year, []);
    }
    this.withholdingOccurrences.get(occurrence.year)!.push(occurrence);
    this.log('withholding-added', { year: occurrence.year, federal: occurrence.federalAmount, state: occurrence.stateAmount, source: occurrence.source });
  }

  /**
   * Get total withholding for a given year
   */
  public getTotalWithholding(year: number): { federal: number; state: number } {
    const withholdings = this.withholdingOccurrences.get(year) || [];
    let federal = 0;
    let state = 0;
    for (const w of withholdings) {
      federal += w.federalAmount;
      state += w.stateAmount;
    }
    return { federal, state };
  }

  /**
   * Clear all withholding occurrences
   */
  public clearWithholdingOccurrences(): void {
    this.withholdingOccurrences.clear();
    this.log('withholding-cleared', {});
  }

  /**
   * Compute unified year-end tax reconciliation.
   * Aggregates all income, computes tax with deductions/credits, subtracts withholding,
   * and returns settlement amount (positive = owes, negative = refund).
   */
  public computeReconciliation(
    year: number,
    taxProfile: TaxProfile,
    deductionTracker: DeductionTracker,
    bracketInflationRate: number = 0.03,
    mcRateGetter?: MCRateGetter | null,
  ): TaxReconciliation {
    // Step 1: Get all taxable occurrences for year
    const allOccurrences = this.getAllOccurrencesForYear(year);

    // Step 2: Sum by income type
    let totalOrdinaryIncome = 0;
    let totalSSIncome = 0;
    let penaltyTotal = 0;

    for (const occurrence of allOccurrences) {
      switch (occurrence.incomeType) {
        case 'ordinary':
        case 'retirement':
        case 'interest':
          totalOrdinaryIncome += occurrence.amount;
          break;
        case 'socialSecurity':
          totalSSIncome += occurrence.amount;
          break;
        case 'penalty':
          penaltyTotal += occurrence.amount;
          break;
      }
    }

    const totalIncome = totalOrdinaryIncome + totalSSIncome;

    // Step 3: Calculate AGI (above-the-line deductions)
    const aboveTheLineDeductions = deductionTracker.getAboveTheLineTotal(year);
    const agi = Math.max(0, totalIncome - aboveTheLineDeductions);

    this.log('reconciliation-income', {
      year,
      total_ordinary: totalOrdinaryIncome,
      total_ss: totalSSIncome,
      total_income: totalIncome,
      above_the_line_ded: aboveTheLineDeductions,
      agi,
    });

    // Step 4: Get standard deduction for filing status
    const bracketResult = computeAnnualFederalTax(0, 0, taxProfile.filingStatus, year, bracketInflationRate, mcRateGetter);
    const standardDeduction = bracketResult.standardDeduction;

    // Step 5: Get itemized deduction
    const itemizedDeduction = deductionTracker.getItemizedTotal(year);

    // Step 6: Choose deduction based on mode
    let deductionUsed: 'standard' | 'itemized';
    let deductionAmount: number;

    if (taxProfile.itemizationMode === 'standard') {
      deductionUsed = 'standard';
      deductionAmount = standardDeduction;
    } else if (taxProfile.itemizationMode === 'itemized') {
      deductionUsed = 'itemized';
      deductionAmount = itemizedDeduction;
    } else {
      // auto mode: use max
      deductionUsed = itemizedDeduction > standardDeduction ? 'itemized' : 'standard';
      deductionAmount = Math.max(standardDeduction, itemizedDeduction);
    }

    // Step 7-8: Compute federal tax using bracket calculator
    // IMPORTANT: Reconciliation computes taxable income by applying deductions to AGI.
    // To avoid double-deduction in computeAnnualFederalTax (which applies standard deduction internally),
    // we use the bracket calculator's lower-level functions directly:
    // - calculateTaxableSS: Applies 0/50/85% rule based on provisional income (AGI + 0.5*SS)
    // - calculateProgressiveTax: Applies bracket lookup directly on already-deducted income

    // Get bracket data for the year
    const yearData = getBracketDataForYear(year, taxProfile.filingStatus, bracketInflationRate, mcRateGetter);
    const brackets = yearData.brackets[taxProfile.filingStatus];

    // Compute taxable SS using AGI (not total ordinary income, since AGI has above-the-line deductions applied)
    const taxableSS = calculateTaxableSS(totalSSIncome, agi, taxProfile.filingStatus, yearData.ssProvisionalThresholds[taxProfile.filingStatus]);

    // Total income for bracket calculation = AGI + taxable portion of SS
    const totalIncomeForBrackets = agi + taxableSS;

    // Apply deduction (standard or itemized, already chosen in Step 6)
    const taxableIncome = Math.max(0, totalIncomeForBrackets - deductionAmount);

    // Apply progressive tax brackets directly (deduction already applied above)
    const federalTax = calculateProgressiveTax(taxableIncome, brackets);

    // Step 9: State tax (simple model: apply state tax rate to taxable income)
    const stateTax = Math.max(0, taxableIncome * taxProfile.stateTaxRate);

    // Step 10: Child Tax Credit ($2,000 per qualifying child)
    let childTaxCredit = 0;
    if (taxProfile.dependents) {
      const qualifyingChildren = taxProfile.dependents.filter(
        d => d.relationship === 'child' && (year - d.birthYear) < 17,
      );
      childTaxCredit = qualifyingChildren.length * 2000;
    }

    // Step 11: Total tax owed
    const credits = childTaxCredit;
    const totalTaxOwed = Math.max(0, federalTax + stateTax + penaltyTotal - credits);

    // Step 12: Get withholding
    const withholding = this.getTotalWithholding(year);
    const totalFederalWithheld = withholding.federal;
    const totalStateWithheld = withholding.state;
    const totalWithheld = totalFederalWithheld + totalStateWithheld;

    // Step 13: FICA reconciliation (set to 0 for now; would need PaycheckStateTracker data)
    const ficaOverpayment = 0;

    // Step 14: Settlement
    const settlement = totalTaxOwed - totalWithheld - ficaOverpayment;

    this.log('reconciliation-complete', {
      year,
      standard_ded: standardDeduction,
      itemized_ded: itemizedDeduction,
      deduction_used: deductionUsed,
      deduction_amount: deductionAmount,
      taxable_income: taxableIncome,
      federal_tax: federalTax,
      taxable_ss: taxableSS,
      state_tax: stateTax,
      child_tax_credit: childTaxCredit,
      total_tax_owed: totalTaxOwed,
      total_federal_withheld: totalFederalWithheld,
      total_state_withheld: totalStateWithheld,
      settlement,
    });

    return {
      year,
      totalOrdinaryIncome,
      totalSSIncome,
      totalIncome,
      aboveTheLineDeductions,
      agi,
      standardDeduction,
      itemizedDeduction,
      deductionUsed,
      deductionAmount,
      taxableIncome,
      federalTax,
      ssTax: taxableSS, // The amount of SS that is taxable (used for computing tax on it)
      stateTax,
      credits,
      totalTaxOwed,
      totalFederalWithheld,
      totalStateWithheld,
      totalWithheld,
      ficaOverpayment,
      settlement,
    };
  }
}
