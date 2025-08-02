import { TaxableOccurence } from './types';

export class TaxManager {
  // Map of account ids (which pay taxes) to a list of taxable events (interest gains, withdrawals, etc.)
  private taxableOccurences: Map<string, TaxableOccurence[]>;

  constructor() {
    this.taxableOccurences = new Map<string, TaxableOccurence[]>();
  }

  // Add a taxable event for an account
  public addTaxableOccurence(accountId: string, event: TaxableOccurence): void {
    if (!this.taxableOccurences.has(accountId)) {
      this.taxableOccurences.set(accountId, []);
    }
    this.taxableOccurences.get(accountId)?.push(event);
  }

  // Get all taxable events for an account, optionally for a specific year
  public getTaxableOccurences(accountId: string, year?: number): TaxableOccurence[] {
    const occurences = this.taxableOccurences.get(accountId) || [];
    if (year !== undefined) {
      return occurences.filter((event) => event.year === year);
    }
    return occurences;
  }

  // Calculate total tax owed for an account based on its taxable events, optionally for a specific year
  public calculateTotalTaxOwed(accountId: string, year?: number): number {
    const events = this.getTaxableOccurences(accountId, year);
    return events.reduce((total, event) => total + event.amount * event.taxRate, 0);
  }

  // Clear all taxable events for an account, optionally for a specific year
  public clearTaxableOccurences(accountId: string, year?: number): void {
    if (year !== undefined) {
      const occurences = this.taxableOccurences.get(accountId) || [];
      this.taxableOccurences.set(
        accountId,
        occurences.filter((event) => event.year !== year),
      );
    } else {
      this.taxableOccurences.delete(accountId);
    }
  }

  // Clear all taxable events for all accounts, optionally for a specific year
  public clearAllTaxableOccurences(year?: number): void {
    if (year !== undefined) {
      for (const [accountId, occurences] of this.taxableOccurences.entries()) {
        this.taxableOccurences.set(
          accountId,
          occurences.filter((event) => event.year !== year),
        );
      }
    } else {
      this.taxableOccurences.clear();
    }
  }
}
