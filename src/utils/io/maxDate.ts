import { AccountsAndTransfers } from '../../data/account/types';
import { findExtremeDate } from './findExtremeDate';

/**
 * Finds the maximum date across all financial data (activities, bills, interests, and transfers)
 *
 * This function scans through all accounts and transfers to find the latest date from:
 * - Account activities
 * - Account bills (start and end dates)
 * - Account interests (applicable dates)
 * - Transfer activities
 * - Transfer bills (start and end dates)
 *
 * @param accountsAndTransfers - The data containing accounts and transfers to scan
 * @returns The maximum date found across all financial data, or current date if no data exists
 */
export function maxDate(accountsAndTransfers: AccountsAndTransfers) {
  // Start with Unix epoch (earliest possible date)
  const defaultDate = new Date(0);
  let result = findExtremeDate(accountsAndTransfers, (a, b) => a > b, defaultDate);

  // If no data was found, return current date
  if (result.getTime() === 0) {
    result = new Date();
  }

  return result;
}
