import { AccountsAndTransfers } from '../../data/account/types';

/**
 * Mapping of names to category counts for statistical analysis
 */
type NamesWithCounts = Record<string, CategoriesWithCounts>;

/**
 * Mapping of categories to their usage counts
 */
type CategoriesWithCounts = Record<string, number>;

/**
 * Mapping of names to their most frequently used category
 */
type NamesWithCategories = Record<string, string | string[]>;

/**
 * Adds a name-category pair to the names tracking object, incrementing the count
 * @param names - The names tracking object to update
 * @param name - The name to add or update
 * @param category - The category to associate with the name
 */
const addToNames = (names: NamesWithCounts, name: string, category: string) => {
  if (!names[name]) {
    names[name] = {};
  }
  const nameWithCount = names[name];
  if (!nameWithCount[category]) {
    nameWithCount[category] = 0;
  }
  nameWithCount[category]++;
};

/**
 * Analyzes all activities and bills to determine the most frequently used category for each name
 * @param accountsAndTransfers - The complete financial data structure
 * @returns A mapping of names to their most frequently used category
 */
export function loadNameCategories(accountsAndTransfers: AccountsAndTransfers): NamesWithCategories {
  const names: NamesWithCounts = {};
  accountsAndTransfers.accounts.forEach((account) => {
    account.activity.forEach((activity) => {
      addToNames(names, activity.name, activity.category);
    });
    account.bills.forEach((bill) => {
      addToNames(names, bill.name, bill.category);
    });
  });
  accountsAndTransfers.transfers.activity.forEach((activity) => {
    addToNames(names, activity.name, activity.category);
  });
  accountsAndTransfers.transfers.bills.forEach((bill) => {
    addToNames(names, bill.name, bill.category);
  });
  const result: NamesWithCategories = {};
  Object.entries(names).forEach(([name, categories]) => {
    result[name] = Object.entries(categories)
      .sort(([_cat1, count1], [_cat2, count2]) => count2 - count1)
      // TODO: Remove the "[0]" when category array is implemented on the frontend
      .map(([category]) => category)[0];
  });
  return result;
}
