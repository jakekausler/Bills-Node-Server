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
 * Track each name with its most recent usage metadata and date
 */
type NameWithDateAndMetadata = {
  date: string;
  metadata: NameMetadata;
};

/**
 * Helper to extract metadata from an activity
 */
const getActivityMetadata = (activity: any): NameMetadata => ({
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
const getBillMetadata = (bill: any): NameMetadata => ({
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
 * Adds or updates a name with the metadata from an activity or bill if it's more recent
 * @param names - The names tracking object to update
 * @param name - The name to add or update
 * @param date - The date of the activity/bill (activity.date or bill.startDate)
 * @param metadata - The metadata to associate with the name
 */
const addToNames = (names: Record<string, NameWithDateAndMetadata>, name: string, date: string, metadata: NameMetadata) => {
  if (!names[name] || date > names[name].date) {
    names[name] = { date, metadata };
  }
};

/**
 * Analyzes all activities and bills to determine the metadata from the most recent usage of each name
 * @param accountsAndTransfers - The complete financial data structure
 * @returns A mapping of names to their metadata from the most recent usage
 */
export function loadNameCategories(accountsAndTransfers: AccountsAndTransfers): Record<string, NameMetadata> {
  const names: Record<string, NameWithDateAndMetadata> = {};

  accountsAndTransfers.accounts.forEach((account) => {
    account.activity.forEach((activity) => {
      const dateStr = formatDate(activity.date);
      addToNames(names, activity.name, dateStr, getActivityMetadata(activity));
    });
    account.bills.forEach((bill) => {
      const dateStr = formatDate(bill.startDate);
      addToNames(names, bill.name, dateStr, getBillMetadata(bill));
    });
  });

  accountsAndTransfers.transfers.activity.forEach((activity) => {
    const dateStr = formatDate(activity.date);
    addToNames(names, activity.name, dateStr, getActivityMetadata(activity));
  });

  accountsAndTransfers.transfers.bills.forEach((bill) => {
    const dateStr = formatDate(bill.startDate);
    addToNames(names, bill.name, dateStr, getBillMetadata(bill));
  });

  const result: Record<string, NameMetadata> = {};
  Object.entries(names).forEach(([name, { metadata }]) => {
    result[name] = metadata;
  });

  return result;
}
