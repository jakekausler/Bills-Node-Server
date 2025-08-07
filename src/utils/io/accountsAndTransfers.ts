import { load, save } from './io';
import { Account } from '../../data/account/account';
import { AccountsAndTransfers, AccountsAndTransfersData } from '../../data/account/types';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { resetCache } from './cache';
import { calculateAllActivity } from '../calculate-v3/engine';
import { CalculationConfig } from '../calculate-v3/types';
import { formatDate } from '../date/date';

export const FILE_NAME = 'data';

const CACHE = new Map<string, AccountsAndTransfers>();

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
 * @param calculationConfig - Configuration for the calculation engine
 * @param options - Additional calculation options
 * @returns The loaded and processed accounts and transfers data
 */
export async function loadData(
  startDate: Date,
  endDate: Date,
  simulation: string = 'Default',
  calculationConfig: Partial<CalculationConfig> = {},
  options: {
    monteCarlo?: boolean;
    simulationNumber?: number;
    totalSimulations?: number;
    forceRecalculation?: boolean;
    enableLogging?: boolean;
  } = {},
): Promise<AccountsAndTransfers> {
  const cacheKey = `${simulation}-${startDate.toISOString()}-${endDate.toISOString()}`;
  // if (CACHE.has(cacheKey)) {
  //   return CACHE.get(cacheKey)!;
  // }

  // console.log('Loading data for', formatDate(startDate), 'to', formatDate(endDate));

  const accountsAndTransfers = getAccountsAndTransfers(simulation);
  const result = await calculateAllActivity(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    options.monteCarlo ?? false,
    options.simulationNumber ?? 0,
    options.totalSimulations ?? 0,
    options.forceRecalculation ?? false,
    options.enableLogging ?? false,
    calculationConfig,
  );
  // CACHE.set(cacheKey, result);
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
