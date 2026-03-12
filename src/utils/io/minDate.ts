import { AccountsAndTransfers } from '../../data/account/types';
import { findExtremeDate } from './findExtremeDate';

/**
 * Finds the minimum date across all financial data (activities, bills, interests, and transfers)
 *
 * This function scans through all accounts and transfers to find the earliest date from:
 * - Account activities
 * - Account bills (start and end dates)
 * - Account interests (applicable dates)
 * - Transfer activities
 * - Transfer bills (start and end dates)
 *
 * The result is cached for performance, so subsequent calls return the cached value.
 *
 * @returns The minimum date found across all financial data, or current date if no data exists
 */
export function minDate(accountsAndTransfers: AccountsAndTransfers) {
  // Start with current date as maximum possible
  const defaultDate = new Date();
  return findExtremeDate(accountsAndTransfers, (a, b) => a < b, defaultDate);
}
