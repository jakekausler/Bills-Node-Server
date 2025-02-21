import { loadData } from './accountsAndTransfers';
import { MIN_DATE, setMinDate } from './cache';

export async function minDate() {
  if (MIN_DATE) {
    return MIN_DATE;
  }
  let minDate = new Date();
  const { accounts, transfers } = await loadData(new Date(), new Date());
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
      if (minDate > bill.endDate) {
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
    if (minDate > transfer.date) {
      minDate = transfer.date;
    }
    if (minDate > transfer.endDate) {
      minDate = transfer.endDate;
    }
  }
  setMinDate(minDate);
  return minDate;
}
