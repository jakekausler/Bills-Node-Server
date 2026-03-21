import { TaxableOccurrence, FilingStatus, MCRateGetter, WithholdingOccurrence } from './types';
import { computeAnnualFederalTax } from './bracket-calculator';
import type { DebugLogger } from './debug-logger';

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
}
