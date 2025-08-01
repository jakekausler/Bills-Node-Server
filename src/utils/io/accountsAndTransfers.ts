import { load, save } from './io';
import { Account } from '../../data/account/account';
import { AccountsAndTransfers, AccountsAndTransfersData } from '../../data/account/types';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { resetCache } from './cache';
import { calculateAllActivity } from '../calculate-v3/engine';

export const FILE_NAME = 'data';

/**
 * Loads accounts and transfers data with caching support
 *
 * This function loads financial data from the data file, processes it through
 * the calculation engine, and caches the results. It handles account objects,
 * transfer activities, and bills with their associated calculations.
 *
 * @param startDate - The start date for calculations
 * @param endDate - The end date for calculations
 * @param simulation - The simulation name to use (defaults to 'Default')
 * @param updateCache - Whether to reset the cache before loading (defaults to true)
 * @returns The loaded and processed accounts and transfers data
 */
export async function loadData(
  startDate: Date,
  endDate: Date,
  simulation: string = 'Default',
): Promise<AccountsAndTransfers> {
  // const key = getCacheKey(startDate, endDate, simulation);
  // if (updateCache) {
  //   console.log('Resetting cache - ', key);
  //   resetCache();
  // }
  // if (!getCache(CACHE_ACCOUNTS_AND_TRANSFERS, key)) {
  //   console.log('Updating cache - ', key);
  //   doUpdateCache(CACHE_ACCOUNTS_AND_TRANSFERS, key, getAccountsAndTransfers(startDate, endDate, simulation));
  // }
  // return getCache(CACHE_ACCOUNTS_AND_TRANSFERS, key);
  const accountsAndTransfers = getAccountsAndTransfers(simulation);
  const result = await calculateAllActivity(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    false,
    0,
    0,
    true,
    true,
  );
  return result;
}

/**
 * Loads and processes raw accounts and transfers data from the data file
 *
 * This private function handles the conversion of raw JSON data into typed objects
 * (Account, Activity, Bill) and runs the calculation engine to compute all
 * financial activities and balances for the specified date range.
 *
 * @param startDate - The start date for calculations
 * @param endDate - The end date for calculations
 * @param simulation - The simulation name to use for variable resolution
 * @returns Processed accounts and transfers data with calculated activities
 */
function getAccountsAndTransfers(simulation: string): AccountsAndTransfers {
  const data = load<AccountsAndTransfersData>(`${FILE_NAME}.json`);

  const accountsAndTransfers: AccountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [] } };

  for (const account of data.accounts) {
    accountsAndTransfers.accounts.push(new Account(account, simulation));
  }
  for (const transfer of data.transfers.activity) {
    accountsAndTransfers.transfers.activity.push(new Activity(transfer, simulation));
  }
  for (const transfer of data.transfers.bills) {
    accountsAndTransfers.transfers.bills.push(new Bill(transfer, simulation));
  }

  return accountsAndTransfers;
}

/**
 * Saves accounts and transfers data to the data file and resets cache
 *
 * This function serializes all account objects, transfer activities, and bills
 * back to their raw JSON format and saves them to the data file. It also
 * resets the cache to ensure fresh data on next load.
 *
 * @param data - The accounts and transfers data to save
 */
export function saveData(data: AccountsAndTransfers) {
  const accounts = data.accounts.map((account) => account.serialize());
  const transfers = {
    activity: data.transfers.activity.map((transfer) => transfer.serialize()),
    bills: data.transfers.bills.map((bill) => bill.serialize()),
  };
  save<AccountsAndTransfersData>({ accounts, transfers }, `${FILE_NAME}.json`);
  resetCache();
}
