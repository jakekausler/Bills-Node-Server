import { TaxableOccurrence, FilingStatus, MCRateGetter, WithholdingOccurrence, TaxReconciliation } from './types';
import { computeAnnualFederalTax, calculateTaxableSS, calculateProgressiveTax, getBracketDataForYear, calculateLongTermCapitalGainsTax, calculateNIIT } from './bracket-calculator';
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
  // Map of years to FICA occurrences (Social Security + Medicare taxes)
  private ficaOccurrences: Map<number, Array<{ source: string; ssTax: number; medicareTax: number }>> = new Map();
  private capitalLossCarryforward: number = 0;
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

  /**
   * Get the current capital loss carryforward amount (for testing/inspection).
   */
  public getCapitalLossCarryforward(): number {
    return this.capitalLossCarryforward;
  }

  /**
   * Set the capital loss carryforward amount (for testing or year-boundary resets).
   */
  public setCapitalLossCarryforward(amount: number): void {
    this.capitalLossCarryforward = amount;
  }

  // Calculate total tax owed for a year using progressive brackets.
  // Includes CG, NIIT, and loss netting for accurate Roth conversion bracket-space.
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
    let shortTermGains = 0;
    let longTermGains = 0;
    let qualifiedDividends = 0;
    let ordinaryDividends = 0;

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
          penaltyTotal += occurrence.amount;
          break;
        case 'shortTermCapitalGain':
          shortTermGains += occurrence.amount;
          break;
        case 'longTermCapitalGain':
          longTermGains += occurrence.amount;
          break;
        case 'qualifiedDividend':
          qualifiedDividends += occurrence.amount;
          break;
        case 'ordinaryDividend':
          ordinaryDividends += occurrence.amount;
          break;
        default:
          // Exhaustiveness check — if a new IncomeType is added, this will be caught
          this.log('unknown-income-type', { type: occurrence.incomeType });
          break;
      }
    }

    // Add ordinary dividends to ordinary income (they use progressive brackets)
    ordinaryIncome += ordinaryDividends;

    // Simple CG netting for bracket-space calculation (no carryforward mutation here)
    let netST = shortTermGains;
    let netLT = longTermGains;

    // Cross-net
    if (netST < 0 && netLT > 0) {
      netLT += netST;
      netST = 0;
    } else if (netLT < 0 && netST > 0) {
      netST += netLT;
      netLT = 0;
    }

    // Net ST gains go to ordinary income
    if (netST > 0) {
      ordinaryIncome += netST;
    } else if (netST < 0 || netLT < 0) {
      // Net loss: up to $3K offset
      const totalNetLoss = Math.min(0, netST) + Math.min(0, netLT);
      const ordinaryOffset = Math.min(3000, Math.abs(totalNetLoss));
      ordinaryIncome -= ordinaryOffset;
    }

    this.log('income-aggregated', { year, ordinary_income: ordinaryIncome, ss_income: ssIncome, penalty_total: penaltyTotal, st_gains: shortTermGains, lt_gains: longTermGains });

    const result = computeAnnualFederalTax(ordinaryIncome, ssIncome, filingStatus, year, bracketInflationRate, mcRateGetter);
    let totalTax = result.tax + penaltyTotal;

    // Add CG tax on net long-term gains + qualified dividends
    const netLTForTax = Math.max(0, netLT);
    if (netLTForTax > 0 || qualifiedDividends > 0) {
      const cgResult = calculateLongTermCapitalGainsTax(
        result.taxableIncome, netLTForTax, qualifiedDividends, filingStatus, year, bracketInflationRate, mcRateGetter ?? null,
      );
      totalTax += cgResult.tax;
    }

    // Add NIIT
    const magi = ordinaryIncome + Math.max(0, netLT) + qualifiedDividends + ssIncome * 0.5;
    const interestIncome = allOccurrences.filter(o => o.incomeType === 'interest').reduce((s, o) => s + o.amount, 0);
    const investmentIncome = interestIncome + qualifiedDividends + ordinaryDividends + Math.max(0, netST) + Math.max(0, netLT);
    const niit = calculateNIIT(investmentIncome, magi, filingStatus);
    totalTax += niit;

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
   * Get income grouped by account and income type for a given year.
   * Returns a map of accountId -> { incomeType -> totalAmount }.
   */
  public getIncomeByAccount(year: number): Record<string, Record<string, number>> {
    const yearMap = this.taxableOccurrences.get(year);
    if (!yearMap) return {};
    const result: Record<string, Record<string, number>> = {};
    for (const [accountId, occurrences] of yearMap) {
      const byType: Record<string, number> = {};
      for (const occ of occurrences) {
        byType[occ.incomeType] = (byType[occ.incomeType] ?? 0) + occ.amount;
      }
      result[accountId] = byType;
    }
    return result;
  }

  /**
   * Get withholding grouped by source for a given year.
   * Returns array of { source, federal, state } objects.
   */
  public getWithholdingBySource(year: number): Array<{ source: string; federal: number; state: number }> {
    const withholdings = this.withholdingOccurrences.get(year) || [];
    const bySource = new Map<string, { federal: number; state: number }>();
    for (const w of withholdings) {
      const existing = bySource.get(w.source) ?? { federal: 0, state: 0 };
      existing.federal += w.federalAmount;
      existing.state += w.stateAmount;
      bySource.set(w.source, existing);
    }
    return Array.from(bySource.entries()).map(([source, amounts]) => ({
      source,
      federal: amounts.federal,
      state: amounts.state,
    }));
  }

  /**
   * Record a FICA occurrence (called from paycheck processor alongside withholding)
   */
  public addFicaOccurrence(year: number, source: string, ssTax: number, medicareTax: number): void {
    if (!this.ficaOccurrences.has(year)) {
      this.ficaOccurrences.set(year, []);
    }
    this.ficaOccurrences.get(year)!.push({ source, ssTax, medicareTax });
  }

  /**
   * Get FICA totals for a year
   */
  public getFicaTotals(year: number): { totalSSTax: number; totalMedicareTax: number; totalFICA: number; bySource: Array<{ source: string; ssTax: number; medicareTax: number }> } {
    const occurrences = this.ficaOccurrences.get(year) || [];
    let totalSSTax = 0;
    let totalMedicareTax = 0;
    const bySource = new Map<string, { ssTax: number; medicareTax: number }>();
    for (const occ of occurrences) {
      totalSSTax += occ.ssTax;
      totalMedicareTax += occ.medicareTax;
      const existing = bySource.get(occ.source) ?? { ssTax: 0, medicareTax: 0 };
      existing.ssTax += occ.ssTax;
      existing.medicareTax += occ.medicareTax;
      bySource.set(occ.source, existing);
    }
    return {
      totalSSTax,
      totalMedicareTax,
      totalFICA: totalSSTax + totalMedicareTax,
      bySource: Array.from(bySource.entries()).map(([source, amounts]) => ({ source, ...amounts })),
    };
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

    // Serialize FICA occurrences
    const ficaObj: Record<number, Array<{ source: string; ssTax: number; medicareTax: number }>> = {};
    for (const [year, occurrences] of this.ficaOccurrences) {
      ficaObj[year] = occurrences;
    }

    const checkpoint = { taxableOccurrences: taxObj, withholdingOccurrences: withObj, ficaOccurrences: ficaObj, capitalLossCarryforward: this.capitalLossCarryforward };
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
      ficaOccurrences?: Record<number, Array<{ source: string; ssTax: number; medicareTax: number }>>;
      capitalLossCarryforward?: number;
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

    // Restore FICA occurrences
    this.ficaOccurrences = new Map();
    if (checkpoint.ficaOccurrences) {
      for (const yearStr of Object.keys(checkpoint.ficaOccurrences)) {
        this.ficaOccurrences.set(Number(yearStr), checkpoint.ficaOccurrences[yearStr]);
      }
    }

    // Restore capital loss carryforward (backward compatible)
    this.capitalLossCarryforward = checkpoint.capitalLossCarryforward ?? 0;

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
    let shortTermGains = 0;
    let longTermGains = 0;
    let qualifiedDividends = 0;
    let ordinaryDividends = 0;
    let interestIncome = 0;

    for (const occurrence of allOccurrences) {
      switch (occurrence.incomeType) {
        case 'ordinary':
        case 'retirement':
          totalOrdinaryIncome += occurrence.amount;
          break;
        case 'interest':
          totalOrdinaryIncome += occurrence.amount;
          interestIncome += occurrence.amount;
          break;
        case 'socialSecurity':
          totalSSIncome += occurrence.amount;
          break;
        case 'penalty':
          penaltyTotal += occurrence.amount;
          break;
        case 'shortTermCapitalGain':
          shortTermGains += occurrence.amount;
          break;
        case 'longTermCapitalGain':
          longTermGains += occurrence.amount;
          break;
        case 'qualifiedDividend':
          qualifiedDividends += occurrence.amount;
          break;
        case 'ordinaryDividend':
          ordinaryDividends += occurrence.amount;
          break;
        default:
          // Exhaustiveness check — if a new IncomeType is added, this will be caught
          this.log('unknown-income-type', { type: occurrence.incomeType });
          break;
      }
    }

    // Ordinary dividends are taxed at ordinary rates
    totalOrdinaryIncome += ordinaryDividends;

    // --- Capital Gains Netting (IRS 4-step algorithm) ---

    // Step N1: Net within each category (already summed above; positive = gain, negative = loss)
    let netShortTerm = shortTermGains;
    let netLongTerm = longTermGains;

    // Step N2: Apply prior-year carryforward (carryforward is a positive number representing loss)
    let carryforwardUsed = 0;
    let remainingCarryforward = this.capitalLossCarryforward;
    if (remainingCarryforward > 0) {
      carryforwardUsed = remainingCarryforward;
      // Apply to short-term first
      netShortTerm -= remainingCarryforward;
      if (netShortTerm < 0) {
        // Excess not absorbed by ST goes to LT
        remainingCarryforward = Math.abs(netShortTerm);
        netShortTerm = 0;
        netLongTerm -= remainingCarryforward;
        remainingCarryforward = 0;
      } else {
        remainingCarryforward = 0;
      }
    }

    // Step N3: Cross-net if one category is net loss
    if (netShortTerm < 0 && netLongTerm > 0) {
      netLongTerm += netShortTerm; // loss reduces gain
      netShortTerm = 0;
    } else if (netLongTerm < 0 && netShortTerm > 0) {
      netShortTerm += netLongTerm; // loss reduces gain
      netLongTerm = 0;
    }

    // Step N4: If overall net loss, apply $3K ordinary offset + update carryforward
    let capitalLossOrdinaryOffset = 0;
    let newCarryforward = 0;
    const totalNetCG = Math.min(0, netShortTerm) + Math.min(0, netLongTerm);
    if (totalNetCG < 0) {
      const absLoss = Math.abs(totalNetCG);
      capitalLossOrdinaryOffset = Math.min(3000, absLoss);
      newCarryforward = absLoss - capitalLossOrdinaryOffset;
    }

    // Apply capital loss offset to ordinary income
    totalOrdinaryIncome -= capitalLossOrdinaryOffset;
    totalOrdinaryIncome = Math.max(0, totalOrdinaryIncome);

    // Update carryforward for next year
    this.capitalLossCarryforward = newCarryforward;

    // Net short-term gains are added to ordinary income (taxed at progressive rates)
    const netSTForOrdinary = Math.max(0, netShortTerm);
    totalOrdinaryIncome += netSTForOrdinary;

    // Net long-term gains for CG tax computation
    const netLTForTax = Math.max(0, netLongTerm);

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
      st_gains: shortTermGains,
      lt_gains: longTermGains,
      net_st: netShortTerm,
      net_lt: netLongTerm,
      carryforward_used: carryforwardUsed,
      new_carryforward: newCarryforward,
    });

    // Step 4: Get standard deduction for filing status
    const bracketResult = computeAnnualFederalTax(0, 0, taxProfile.filingStatus, year, bracketInflationRate, mcRateGetter);
    const standardDeduction = bracketResult.standardDeduction;

    // Step 4a: Get personal exemption and compute total deduction base
    const bracketDataForExemption = getBracketDataForYear(year, taxProfile.filingStatus, bracketInflationRate, mcRateGetter);
    const personalExemption = bracketDataForExemption.personalExemption || 0;

    // Number of people: filing status determines base count, then add dependents
    let totalPersonalExemptions = 0;
    if (personalExemption > 0) {
      let numberOfPeople = 1;
      if (taxProfile.filingStatus === 'mfj') {
        numberOfPeople = 2;
      }
      if (taxProfile.dependents && taxProfile.dependents.length > 0) {
        numberOfPeople += taxProfile.dependents.length;
      }
      totalPersonalExemptions = personalExemption * numberOfPeople;
    }

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
      deductionUsed = itemizedDeduction > standardDeduction ? 'itemized' : 'standard';
      deductionAmount = Math.max(standardDeduction, itemizedDeduction);
    }

    // Step 7-8: Compute federal ordinary tax using bracket calculator
    const yearData = getBracketDataForYear(year, taxProfile.filingStatus, bracketInflationRate, mcRateGetter);
    const brackets = yearData.brackets[taxProfile.filingStatus];

    // Compute taxable SS using AGI
    const taxableSS = calculateTaxableSS(totalSSIncome, agi, taxProfile.filingStatus, yearData.ssProvisionalThresholds[taxProfile.filingStatus]);

    // Total income for bracket calculation = AGI + taxable portion of SS
    const totalIncomeForBrackets = agi + taxableSS;

    // Apply deduction and personal exemptions — this is the ordinary taxable income
    const ordinaryTaxableIncome = Math.max(0, totalIncomeForBrackets - deductionAmount - totalPersonalExemptions);

    // Progressive tax on ordinary income only
    const federalOrdinaryTax = calculateProgressiveTax(ordinaryTaxableIncome, brackets);

    // Step 8a: Capital gains tax (stacked on top of ordinary income)
    let longTermCapitalGainsTax = 0;
    if (netLTForTax > 0 || qualifiedDividends > 0) {
      const cgResult = calculateLongTermCapitalGainsTax(
        ordinaryTaxableIncome, netLTForTax, qualifiedDividends,
        taxProfile.filingStatus, year, bracketInflationRate, mcRateGetter ?? null,
      );
      longTermCapitalGainsTax = cgResult.tax;
    }

    // Step 8b: NIIT on investment income above threshold
    // MAGI includes all income sources
    const magi = agi + netLTForTax + qualifiedDividends;
    const investmentIncome = interestIncome + qualifiedDividends + ordinaryDividends
      + Math.max(0, netShortTerm) + Math.max(0, netLongTerm);
    const niitTax = calculateNIIT(investmentIncome, magi, taxProfile.filingStatus);

    // Step 9: State tax on broader income base
    // ordinaryTaxableIncome already includes net ST gains (added in netting step).
    // Add net LT gains + qualified dividends + ordinary dividends for state purposes.
    const stateTaxBase = ordinaryTaxableIncome + netLTForTax + qualifiedDividends;
    const stateTax = Math.max(0, stateTaxBase * taxProfile.stateTaxRate);

    // Step 10: Child Tax Credit ($2,000 per qualifying child)
    let childTaxCredit = 0;
    if (taxProfile.dependents) {
      const qualifyingChildren = taxProfile.dependents.filter(
        d => d.relationship === 'child' && (year - d.birthYear) < 17,
      );
      childTaxCredit = qualifyingChildren.length * 2000;
    }

    // Step 11: Total tax owed = ordinary federal + CG federal + NIIT + state + penalties - credits
    const credits = childTaxCredit;
    const totalTaxOwed = Math.max(0, federalOrdinaryTax + longTermCapitalGainsTax + niitTax + stateTax + penaltyTotal - credits);

    // Step 12: Get withholding
    const withholding = this.getTotalWithholding(year);
    const totalFederalWithheld = withholding.federal;
    const totalStateWithheld = withholding.state;
    const totalWithheld = totalFederalWithheld + totalStateWithheld;

    // Step 13: FICA reconciliation
    const ficaOverpayment = 0;

    // Step 14: Settlement
    const settlement = totalTaxOwed - totalWithheld - ficaOverpayment;

    this.log('reconciliation-complete', {
      year,
      standard_ded: standardDeduction,
      itemized_ded: itemizedDeduction,
      deduction_used: deductionUsed,
      deduction_amount: deductionAmount,
      ordinary_taxable_income: ordinaryTaxableIncome,
      federal_ordinary_tax: federalOrdinaryTax,
      lt_cg_tax: longTermCapitalGainsTax,
      niit_tax: niitTax,
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
      personalExemption: totalPersonalExemptions,
      taxableIncome: ordinaryTaxableIncome,
      federalTax: federalOrdinaryTax,
      ssTax: taxableSS,
      stateTax,
      credits,
      totalTaxOwed,
      totalFederalWithheld,
      totalStateWithheld,
      totalWithheld,
      ficaOverpayment,
      shortTermCapitalGains: shortTermGains,
      longTermCapitalGains: longTermGains,
      qualifiedDividends,
      ordinaryDividends,
      niitTax,
      capitalLossCarryforwardUsed: carryforwardUsed,
      capitalLossCarryforwardRemaining: newCarryforward,
      longTermCapitalGainsTax,
      settlement,
    };
  }
}
