import { TaxableOccurrence, FilingStatus } from './types';
import { computeAnnualFederalTax } from './bracket-calculator';
import type { DebugLogger } from './debug-logger';

export class TaxManager {
  // Map of years to account ids to taxable events
  private taxableOccurrences: Map<number, Map<string, TaxableOccurrence[]>>;
  // Cache of computed tax amounts per year
  private taxCache: Map<number, number>;
  private debugLogger: DebugLogger | null;

  constructor(debugLogger?: DebugLogger | null) {
    this.taxableOccurrences = new Map<number, Map<string, TaxableOccurrence[]>>();
    this.taxCache = new Map<number, number>();
    this.debugLogger = debugLogger ?? null;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(0, { component: 'tax', event, ...data });
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

    const result = computeAnnualFederalTax(ordinaryIncome, ssIncome, filingStatus, year, bracketInflationRate);
    const totalTax = result.tax + penaltyTotal;

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
}
