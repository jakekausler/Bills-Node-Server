import { Cache } from './types';
import { formatDate } from '../date/date';
import { AccountsAndTransfers } from '../../data/account/types';
import { RMDTableType } from '../calculate/types';
import { ChartResultArray } from 'yahoo-finance2/dist/esm/src/modules/chart';

export let CACHE_ACCOUNTS_AND_TRANSFERS: Cache<AccountsAndTransfers> = {};
export let MIN_DATE: Date | undefined = undefined;
export let MAX_DATE: Date | undefined = undefined;
export let RMD_TABLE: RMDTableType = {};
// StartDate-EndDate cache key to ticker to historical prices
export let HISTORICAL_PRICES: Record<string, Record<string, ChartResultArray>> = {};

export function resetCache() {
  CACHE_ACCOUNTS_AND_TRANSFERS = {};
  MIN_DATE = undefined;
  MAX_DATE = undefined;
  RMD_TABLE = {};
}

export function getCacheKey(startDate: Date, endDate: Date, simulation?: string): string {
  return `${formatDate(startDate)}-${formatDate(endDate)}${simulation ? `-${simulation}` : ''}`;
}

export function updateCache<T>(cache: Cache<T>, key: string, data: T) {
  cache[key] = data;
}

export function getCache<T>(cache: Cache<T>, key: string): T {
  return cache[key];
}

export function setMinDate(date: Date) {
  MIN_DATE = date;
}

export function setMaxDate(date: Date) {
  MAX_DATE = date;
}

export function setRMDTable(table: RMDTableType) {
  RMD_TABLE = table;
}

export function setHistoricalPrices(key: string, ticker: string, prices: ChartResultArray) {
  if (!HISTORICAL_PRICES[key]) {
    HISTORICAL_PRICES[key] = {};
  }
  HISTORICAL_PRICES[key][ticker] = prices;
}
