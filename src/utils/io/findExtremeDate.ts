import { AccountsAndTransfers } from '../../data/account/types';

/**
 * Finds an extreme date across all financial data (activities, bills, interests, and transfers)
 *
 * @param accountsAndTransfers - The data containing accounts and transfers to scan
 * @param comparator - Function to compare dates (e.g., (a, b) => a > b for max, (a, b) => a < b for min)
 * @param defaultDate - Default date to start comparison with
 * @returns The extreme date found across all financial data, or defaultDate if no valid date is found
 */
export function findExtremeDate(
  accountsAndTransfers: AccountsAndTransfers,
  comparator: (a: Date, b: Date) => boolean,
  defaultDate: Date,
): Date {
  let extremeDate = defaultDate;
  const { accounts, transfers } = accountsAndTransfers;

  for (const account of accounts) {
    for (const activity of account.activity) {
      if (comparator(activity.date, extremeDate)) {
        extremeDate = activity.date;
      }
    }
    for (const bill of account.bills) {
      if (comparator(bill.startDate, extremeDate)) {
        extremeDate = bill.startDate;
      }
      if (bill.endDate && comparator(bill.endDate, extremeDate)) {
        extremeDate = bill.endDate;
      }
    }
    for (const interest of account.interests) {
      if (comparator(interest.applicableDate, extremeDate)) {
        extremeDate = interest.applicableDate;
      }
    }
  }

  for (const transfer of transfers.activity) {
    if (comparator(transfer.date, extremeDate)) {
      extremeDate = transfer.date;
    }
  }

  for (const transfer of transfers.bills) {
    if (comparator(transfer.startDate, extremeDate)) {
      extremeDate = transfer.startDate;
    }
    if (transfer.endDate && comparator(transfer.endDate, extremeDate)) {
      extremeDate = transfer.endDate;
    }
  }

  return extremeDate;
}
