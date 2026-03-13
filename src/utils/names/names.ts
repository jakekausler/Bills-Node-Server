import { AccountsAndTransfers } from '../../data/account/types';
import { formatDate } from '../date/date';

/**
 * Metadata about a transaction name from its most recent usage
 */
export interface NameMetadata {
  category: string;
  isHealthcare: boolean;
  healthcarePerson: string | null;
  coinsurancePercent: number | null;
  isTransfer: boolean;
  from: string | null;
  to: string | null;
  spendingCategory: string | null;
}

/**
 * A distinct name+category combination with its metadata
 */
export interface NameEntry {
  name: string;
  category: string;
  isHealthcare: boolean;
  healthcarePerson: string | null;
  coinsurancePercent: number | null;
  isTransfer: boolean;
  from: string | null;
  to: string | null;
  spendingCategory: string | null;
}

/**
 * Track each name+category combination with its most recent usage metadata and date
 */
type NameWithDateAndMetadata = {
  date: string;
  metadata: NameEntry;
};

/**
 * Helper to extract metadata from an activity
 */
const getActivityMetadata = (activity: any): NameEntry => ({
  name: activity.name,
  category: activity.category,
  isHealthcare: activity.isHealthcare ?? false,
  healthcarePerson: activity.healthcarePerson ?? null,
  coinsurancePercent: activity.coinsurancePercent ?? null,
  isTransfer: activity.isTransfer,
  from: activity.from ?? null,
  to: activity.to ?? null,
  spendingCategory: activity.spendingCategory ?? null,
});

/**
 * Helper to extract metadata from a bill
 */
const getBillMetadata = (bill: any): NameEntry => ({
  name: bill.name,
  category: bill.category,
  isHealthcare: bill.isHealthcare ?? false,
  healthcarePerson: bill.healthcarePerson ?? null,
  coinsurancePercent: bill.coinsurancePercent ?? null,
  isTransfer: bill.isTransfer,
  from: bill.from ?? null,
  to: bill.to ?? null,
  spendingCategory: bill.spendingCategory ?? null,
});

/**
 * Adds or updates a name+category combination with metadata if it's more recent
 * @param names - The names tracking object to update (keyed by name|category)
 * @param date - The date of the activity/bill (activity.date or bill.startDate)
 * @param metadata - The metadata (including name and category) to associate
 */
const addToNames = (names: Record<string, NameWithDateAndMetadata>, date: string, metadata: NameEntry) => {
  const compositeKey = `${metadata.name}|${metadata.category}`;
  if (!names[compositeKey] || date > names[compositeKey].date) {
    names[compositeKey] = { date, metadata };
  }
};

/**
 * Analyzes all activities and bills to determine the metadata from the most recent usage
 * of each distinct name+category combination
 * @param accountsAndTransfers - The complete financial data structure
 * @returns An array of all distinct name+category combinations with their metadata
 */
export function loadNameCategories(accountsAndTransfers: AccountsAndTransfers): NameEntry[] {
  const names: Record<string, NameWithDateAndMetadata> = {};

  accountsAndTransfers.accounts.forEach((account) => {
    account.activity.forEach((activity) => {
      const dateStr = formatDate(activity.date);
      const metadata = getActivityMetadata(activity);
      addToNames(names, dateStr, metadata);
    });
    account.bills.forEach((bill) => {
      const dateStr = formatDate(bill.startDate);
      const metadata = getBillMetadata(bill);
      addToNames(names, dateStr, metadata);
    });
  });

  accountsAndTransfers.transfers.activity.forEach((activity) => {
    const dateStr = formatDate(activity.date);
    const metadata = getActivityMetadata(activity);
    addToNames(names, dateStr, metadata);
  });

  accountsAndTransfers.transfers.bills.forEach((bill) => {
    const dateStr = formatDate(bill.startDate);
    const metadata = getBillMetadata(bill);
    addToNames(names, dateStr, metadata);
  });

  // Convert to flat array of entries
  return Object.entries(names)
    .map(([, { metadata }]) => metadata)
    .sort((a, b) => {
      // Sort by name first, then category for consistent ordering
      if (a.name !== b.name) {
        return a.name.localeCompare(b.name);
      }
      return a.category.localeCompare(b.category);
    });
}
