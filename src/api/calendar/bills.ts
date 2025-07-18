import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { CalendarBill } from '../../data/bill/types';
import { getById } from '../../utils/array/array';
import { Bill } from '../../data/bill/bill';
import { formatDate } from '../../utils/date/date';

/**
 * Retrieves calendar bills for display in calendar view.
 * 
 * Filters bills from consolidated activity based on:
 * - Date range (startDate to endDate)
 * - Account selection (selectedAccounts)
 * - Account visibility (hidden accounts excluded if no selection)
 * - Transfer handling (only shows negative transfers to avoid double-counting)
 * 
 * @param request - Express request object containing query parameters and session data
 * @returns Array of CalendarBill objects with account, date, and bill information
 * 
 * @example
 * ```typescript
 * // Get bills for calendar display
 * const calendarBills = getCalendarBills(request);
 * console.log(calendarBills[0]);
 * // {
 * //   account: "Checking Account",
 * //   accountId: "account-1",
 * //   date: "2024-01-15",
 * //   id: "bill-1",
 * //   name: "Rent",
 * //   category: "Housing",
 * //   amount: -1500
 * // }
 * ```
 */
export function getCalendarBills(request: Request) {
  const data = getData(request);

  const ret: CalendarBill[] = [];
  for (const account of data.accountsAndTransfers.accounts) {
    if (
      // Don't show bills for non-selected accounts if there are selected accounts
      (data.selectedAccounts.length > 0 && !data.selectedAccounts.includes(account.id)) ||
      // Don't show bills for hidden accounts if there are no selected accounts
      (data.selectedAccounts.length === 0 && account.hidden)
    ) {
      continue;
    }

    for (const activity of account.consolidatedActivity) {
      if (activity.date < data.startDate || activity.date > data.endDate) {
        continue;
      }
      if (activity.billId) {
        let bill: Bill;
        if (activity.isTransfer) {
          // Only show negative transfers so that the bill is not double-counted
          if ((activity.amount as number) < 0) {
            bill = getById<Bill>(data.accountsAndTransfers.transfers.bills, activity.billId);
          } else {
            continue;
          }
        } else {
          bill = getById<Bill>(account.bills, activity.billId);
        }
        ret.push({
          account: account.name,
          accountId: account.id,
          date: formatDate(activity.date),
          ...bill.serialize(),
          amount: activity.amount,
        });
      }
    }
  }

  return ret;
}
