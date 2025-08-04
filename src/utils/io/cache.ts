import { Cache, CacheKey } from './types';
import { formatDate } from '../date/date';
import { AccountsAndTransfers } from '../../data/account/types';
import { RMDTableType } from '../calculate/types';

export let CACHE_ACCOUNTS_AND_TRANSFERS: Cache<AccountsAndTransfers> = {};
export let MIN_DATE: Date | undefined = undefined;
export let MAX_DATE: Date | undefined = undefined;
export let RMD_TABLE: RMDTableType = {};

/**
 * Resets all caches and cached data to their initial state
 *
 * This function clears the accounts and transfers cache, resets min/max dates,
 * and clears the RMD table cache. Used primarily for testing and initialization.
 */
export function resetCache() {
  CACHE_ACCOUNTS_AND_TRANSFERS = {};
  MIN_DATE = undefined;
  MAX_DATE = undefined;
  RMD_TABLE = {};
}

/**
 * Generates a cache key string from date range and simulation name
 *
 * @param startDate - The start date of the data range
 * @param endDate - The end date of the data range
 * @param simulation - The simulation name/identifier
 * @returns A formatted cache key string combining the parameters
 */
export function getCacheKey(startDate: Date, endDate: Date, simulation: string): CacheKey {
  return `${formatDate(startDate)}-${formatDate(endDate)}-${simulation}`;
}

/**
 * Updates a cache with new data for the specified key
 *
 * @param cache - The cache object to update
 * @param key - The cache key to store the data under
 * @param data - The data to store in the cache
 */
export function updateCache<T>(cache: Cache<T>, key: CacheKey, data: T) {
  cache[key] = data;
}

/**
 * Retrieves data from a cache using the specified key
 *
 * @param cache - The cache object to retrieve data from
 * @param key - The cache key to look up
 * @returns The cached data for the specified key
 */
export function getCache<T>(cache: Cache<T>, key: CacheKey): T {
  return cache[key];
}

/**
 * Sets the minimum date for cache calculations
 *
 * @param date - The minimum date to set for caching purposes
 */
export function setMinDate(date: Date) {
  MIN_DATE = date;
}

/**
 * Sets the maximum date for cache calculations
 *
 * @param date - The maximum date to set for caching purposes
 */
export function setMaxDate(date: Date) {
  MAX_DATE = date;
}

/**
 * Sets the Required Minimum Distribution (RMD) table for retirement calculations
 *
 * @param table - The RMD table containing age-based distribution factors
 */
export function setRMDTable(table: RMDTableType) {
  RMD_TABLE = table;
}
