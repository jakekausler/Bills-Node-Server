import { loadData } from './accountsAndTransfers';
import { MAX_DATE, setMaxDate } from './cache';

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
 * The result is cached for performance, so subsequent calls return the cached value.
 * 
 * @returns The maximum date found across all financial data, or current date if no data exists
 */
export async function maxDate() {
  if (MAX_DATE) {
    return MAX_DATE;
  }
  let maxDate = new Date(0); // Start with Unix epoch (earliest possible date)
  const { accounts, transfers } = await loadData(new Date(), new Date());
  for (const account of accounts) {
    for (const activity of account.activity) {
      if (maxDate < activity.date) {
        maxDate = activity.date;
      }
    }
    for (const bill of account.bills) {
      if (maxDate < bill.startDate) {
        maxDate = bill.startDate;
      }
      if (bill.endDate && maxDate < bill.endDate) {
        maxDate = bill.endDate;
      }
    }
    for (const interest of account.interests) {
      if (maxDate < interest.applicableDate) {
        maxDate = interest.applicableDate;
      }
    }
  }
  for (const transfer of transfers.activity) {
    if (maxDate < transfer.date) {
      maxDate = transfer.date;
    }
  }
  for (const transfer of transfers.bills) {
    if (maxDate < transfer.startDate) {
      maxDate = transfer.startDate;
    }
    if (transfer.endDate && maxDate < transfer.endDate) {
      maxDate = transfer.endDate;
    }
  }
  // If no data was found, return current date
  if (maxDate.getTime() === 0) {
    maxDate = new Date();
  }
  setMaxDate(maxDate);
  return maxDate;
}
