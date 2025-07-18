import { loadData } from './accountsAndTransfers';
import { MAX_DATE, setMaxDate } from './cache';
export function maxDate() {
    if (MAX_DATE) {
        return MAX_DATE;
    }
    let maxDate = new Date();
    const { accounts, transfers } = loadData(new Date(), new Date());
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
    setMaxDate(maxDate);
    return maxDate;
}
