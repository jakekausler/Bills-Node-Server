import { TaxableOccurrence } from './types';

export class TaxManager {
  // Map of years to account ids to taxable events
  private taxableOccurrences: Map<number, Map<string, TaxableOccurrence[]>>;

  constructor() {
    this.taxableOccurrences = new Map<number, Map<string, TaxableOccurrence[]>>();
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

  // Calculate total tax owed for an account in a specific year
  // NOTE: This is a legacy implementation. Task 5 will replace this with progressive bracket calculation.
  // For now, we aggregate by income type but don't calculate final tax (that's done in Task 5 with BracketCalculator).
  public calculateTotalTaxOwed(accountId: string, year: number): number {
    // TEMPORARY: Return 0 until Task 5 implements bracket-based calculation
    // The new system aggregates income by type and calculates via BracketCalculator, not per-account flat rates
    return 0;
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
  }

  // Clear all taxable events for all accounts in a specific year
  public clearAllTaxableOccurrences(year: number): void {
    this.taxableOccurrences.delete(year);
  }

  // Get all accounts that have taxable events in a specific year
  public getAccountsWithTaxableEvents(year: number): string[] {
    const yearMap = this.taxableOccurrences.get(year);
    return yearMap ? Array.from(yearMap.keys()) : [];
  }
}
