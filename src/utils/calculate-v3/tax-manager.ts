import { TaxableOccurence } from './types';

export class TaxManager {
  // Map of years to account ids to taxable events
  private taxableOccurences: Map<number, Map<string, TaxableOccurence[]>>;

  constructor() {
    this.taxableOccurences = new Map<number, Map<string, TaxableOccurence[]>>();
  }

  // Add multiple taxable occurences for an account
  public addTaxableOccurences(accountId: string, events: TaxableOccurence[]): void {
    for (const event of events) {
      this.addTaxableOccurence(accountId, event);
    }
  }

  // Add a taxable event for an account
  public addTaxableOccurence(accountId: string, event: TaxableOccurence): void {
    if (!this.taxableOccurences.has(event.year)) {
      this.taxableOccurences.set(event.year, new Map<string, TaxableOccurence[]>());
    }

    const yearMap = this.taxableOccurences.get(event.year)!;
    if (!yearMap.has(accountId)) {
      yearMap.set(accountId, []);
    }
    yearMap.get(accountId)?.push(event);
  }

  // Get all taxable events for an account in a specific year
  public getTaxableOccurences(accountId: string, year: number): TaxableOccurence[] {
    const yearMap = this.taxableOccurences.get(year);
    if (!yearMap) {
      return [];
    }
    return yearMap.get(accountId) || [];
  }

  // Calculate total tax owed for an account in a specific year
  public calculateTotalTaxOwed(accountId: string, year: number): number {
    const events = this.getTaxableOccurences(accountId, year);
    return events.reduce((total, event) => total + event.amount * event.taxRate, 0);
  }

  // Clear all taxable events for an account in a specific year
  public clearTaxableOccurences(accountId: string, year: number): void {
    const yearMap = this.taxableOccurences.get(year);
    if (yearMap) {
      yearMap.delete(accountId);
      // Clean up empty year maps
      if (yearMap.size === 0) {
        this.taxableOccurences.delete(year);
      }
    }
  }

  // Clear all taxable events for all accounts in a specific year
  public clearAllTaxableOccurences(year: number): void {
    this.taxableOccurences.delete(year);
  }

  // Get all accounts that have taxable events in a specific year
  public getAccountsWithTaxableEvents(year: number): string[] {
    const yearMap = this.taxableOccurences.get(year);
    return yearMap ? Array.from(yearMap.keys()) : [];
  }
}
