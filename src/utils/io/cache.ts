import { CacheManager } from '../calculate-v3/cache';

/**
 * Resets all caches and cached data to their initial state
 *
 * This function clears the accounts and transfers cache, resets min/max dates,
 * and clears the RMD table cache. Used primarily for testing and initialization.
 */
export function resetCache(date?: Date) {
  const cacheManager = new CacheManager(
    { useDiskCache: true, diskCacheDir: 'cache', snapshotInterval: 'monthly' },
    'Default',
  );
  if (date) {
    cacheManager.clearCacheFromDate(date);
  } else {
    cacheManager.clear();
  }
}
