import { AccountsAndTransfers } from '../../data/account/types';

export const DATA_CACHE = new Map<string, AccountsAndTransfers>();
export const MAX_CACHE_SIZE = 50;

/**
 * Clears the data cache to ensure fresh data on next load.
 *
 * This function invalidates the simple Map-based cache used by loadData()
 * to ensure that subsequent calls load fresh data from disk.
 */
export function clearDataCache() {
  DATA_CACHE.clear();
}
