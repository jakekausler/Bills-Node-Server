import { load, save } from './io';
import { Account } from '../../data/account/account';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { calculateAllActivity } from '../calculate/calculate';
import { CACHE_ACCOUNTS_AND_TRANSFERS, getCacheKey, updateCache as doUpdateCache, getCache, resetCache } from './cache';
export const FILE_NAME = 'data';
export function loadData(startDate, endDate, simulation = 'Default', updateCache = true) {
    const key = getCacheKey(startDate, endDate, simulation);
    if (updateCache) {
        console.log('Resetting cache - ', key);
        resetCache();
    }
    if (!getCache(CACHE_ACCOUNTS_AND_TRANSFERS, key)) {
        console.log('Updating cache - ', key);
        doUpdateCache(CACHE_ACCOUNTS_AND_TRANSFERS, key, getAccountsAndTransfers(startDate, endDate, simulation));
    }
    return getCache(CACHE_ACCOUNTS_AND_TRANSFERS, key);
}
function getAccountsAndTransfers(startDate, endDate, simulation) {
    const data = load(`${FILE_NAME}.json`);
    const accountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [] } };
    for (const account of data.accounts) {
        accountsAndTransfers.accounts.push(new Account(account, simulation));
    }
    for (const transfer of data.transfers.activity) {
        accountsAndTransfers.transfers.activity.push(new Activity(transfer, simulation));
    }
    for (const transfer of data.transfers.bills) {
        accountsAndTransfers.transfers.bills.push(new Bill(transfer, simulation));
    }
    calculateAllActivity(accountsAndTransfers, startDate, endDate, simulation);
    return accountsAndTransfers;
}
export function saveData(data) {
    const accounts = data.accounts.map((account) => account.serialize());
    const transfers = {
        activity: data.transfers.activity.map((transfer) => transfer.serialize()),
        bills: data.transfers.bills.map((bill) => bill.serialize()),
    };
    save({ accounts, transfers }, `${FILE_NAME}.json`);
    resetCache();
}
