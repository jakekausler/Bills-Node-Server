import { AccountsAndTransfers } from '../../data/account/types';

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
  let minDate = new Date(); // Start with current date as maximum possible
  const { accounts, transfers } = accountsAndTransfers;
  for (const account of accounts) {
    for (const activity of account.activity) {
      if (minDate > activity.date) {
        minDate = activity.date;
      }
    }
    for (const bill of account.bills) {
      if (minDate > bill.startDate) {
        minDate = bill.startDate;
      }
      if (bill.endDate && minDate > bill.endDate) {
        minDate = bill.endDate;
      }
    }
    for (const interest of account.interests) {
      if (minDate > interest.applicableDate) {
        minDate = interest.applicableDate;
      }
    }
  }
  for (const transfer of transfers.activity) {
    if (minDate > transfer.date) {
      minDate = transfer.date;
    }
  }
  for (const transfer of transfers.bills) {
    if (minDate > transfer.startDate) {
      minDate = transfer.startDate;
    }
    if (transfer.endDate && minDate > transfer.endDate) {
      minDate = transfer.endDate;
    }
  }
  return minDate;
}
