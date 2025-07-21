/**
 * Hybrid caching system for optimized financial calculations
 *
 * This module implements both in-memory and disk-based caching to dramatically
 * improve performance for repeated calculations and enable fast incremental updates.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { CacheEntry, BalanceSnapshot, CalculationSegment, CalculationConfig } from './types';
import { warn } from './logger';

/**
 * Cache manager with hybrid memory/disk storage
 */
export class CacheManager {
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private diskCacheDir: string;
  private maxMemorySizeMB: number;
  private currentMemorySizeMB: number = 0;
  private config: CalculationConfig;

  constructor(config: CalculationConfig) {
    this.config = config;
    this.diskCacheDir = config.diskCacheDir;
    this.maxMemorySizeMB = config.maxMemoryCacheMB;

    // Ensure disk cache directory exists
    this.initializeDiskCache();
  }

  /**
   * Initializes the disk cache directory
   */
  private async initializeDiskCache(): Promise<void> {
    try {
      await fs.mkdir(this.diskCacheDir, { recursive: true });
    } catch (error) {
      warn(`Failed to create disk cache directory: ${error}`);
    }
  }

  /**
   * Stores a value in the cache
   */
  async set<T>(
    key: string,
    value: T,
    options: {
      expiresAt?: Date;
      forceDisk?: boolean;
      size?: number;
    } = {},
  ): Promise<void> {
    const size = options.size || this.estimateSize(value);
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: new Date(),
      inputHash: this.hashObject(value),
      expiresAt: options.expiresAt || null,
      size,
    };

    // Decide whether to store in memory or disk
    const shouldStoreDisk =
      options.forceDisk ||
      !this.config.useDiskCache === false ||
      size > 10 * 1024 * 1024 || // > 10MB
      this.currentMemorySizeMB + size / (1024 * 1024) > this.maxMemorySizeMB;

    if (shouldStoreDisk && this.config.useDiskCache) {
      await this.setDisk(key, entry);
    } else {
      this.setMemory(key, entry);
    }
  }

  /**
   * Retrieves a value from the cache
   */
  async get<T>(key: string): Promise<T | null> {
    // Try memory first
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      if (this.isExpired(memoryEntry)) {
        this.memoryCache.delete(key);
        this.currentMemorySizeMB -= memoryEntry.size / (1024 * 1024);
      } else {
        return memoryEntry.data as T;
      }
    }

    // Try disk cache
    if (this.config.useDiskCache) {
      const diskEntry = await this.getDisk<T>(key);
      if (diskEntry) {
        if (this.isExpired(diskEntry)) {
          await this.deleteDisk(key);
        } else {
          return diskEntry.data;
        }
      }
    }

    return null;
  }

  /**
   * Checks if a key exists in the cache
   */
  async has(key: string): Promise<boolean> {
    // Check memory
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      if (!this.isExpired(entry)) {
        return true;
      }
    }

    // Check disk
    if (this.config.useDiskCache) {
      try {
        const diskPath = this.getDiskPath(key);
        await fs.access(diskPath);

        const diskEntry = await this.getDisk(key);
        if (diskEntry && !this.isExpired(diskEntry)) {
          return true;
        }
      } catch {
        // File doesn't exist
      }
    }

    return false;
  }

  /**
   * Deletes a value from the cache
   */
  async delete(key: string): Promise<void> {
    // Delete from memory
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      this.memoryCache.delete(key);
      this.currentMemorySizeMB -= memoryEntry.size / (1024 * 1024);
    }

    // Delete from disk
    if (this.config.useDiskCache) {
      await this.deleteDisk(key);
    }
  }

  /**
   * Clears all cache entries
   */
  async clear(): Promise<void> {
    // Clear memory
    this.memoryCache.clear();
    this.currentMemorySizeMB = 0;

    // Clear disk cache
    if (this.config.useDiskCache) {
      try {
        const files = await fs.readdir(this.diskCacheDir);
        await Promise.all(files.map((file) => fs.unlink(path.join(this.diskCacheDir, file)).catch(() => {})));
      } catch {
        // Directory might not exist or be empty
      }
    }
  }

  /**
   * Stores balance snapshot with automatic key generation
   */
  async setBalanceSnapshot(date: Date, snapshot: BalanceSnapshot): Promise<string> {
    const key = `balance_snapshot_${date.getTime()}`;
    await this.set(key, snapshot, {
      forceDisk: true, // Always store snapshots on disk for persistence
      size: this.estimateSnapshotSize(snapshot),
    });
    return key;
  }

  /**
   * Retrieves balance snapshot
   */
  async getBalanceSnapshot(date: Date): Promise<BalanceSnapshot | null> {
    const key = `balance_snapshot_${date.getTime()}`;
    return await this.get<BalanceSnapshot>(key);
  }

  /**
   * Finds the closest balance snapshot before or on the given date
   */
  async findClosestSnapshot(date: Date): Promise<{ snapshot: BalanceSnapshot; key: string } | null> {
    const targetTime = date.getTime();
    const prefix = 'balance_snapshot_';

    // Check memory cache first
    let closestEntry: { key: string; snapshot: BalanceSnapshot; time: number } | null = null;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (key && typeof key === 'string' && key.startsWith(prefix) && !this.isExpired(entry)) {
        const snapshotTime = parseInt(key.substring(prefix.length));
        if (snapshotTime <= targetTime && (!closestEntry || snapshotTime > closestEntry.time)) {
          closestEntry = { key, snapshot: entry.data, time: snapshotTime };
        }
      }
    }

    // Check disk cache
    if (this.config.useDiskCache) {
      try {
        const files = await fs.readdir(this.diskCacheDir);
        const snapshotFiles = files.filter(
          (file) => file && typeof file === 'string' && file.startsWith(prefix) && file.endsWith('.json'),
        );

        for (const file of snapshotFiles) {
          const snapshotTime = parseInt(file.substring(prefix.length, file.length - 5));
          if (snapshotTime <= targetTime && (!closestEntry || snapshotTime > closestEntry.time)) {
            const snapshot = await this.getDisk<BalanceSnapshot>(file.substring(0, file.length - 5));
            if (snapshot && !this.isExpired({ ...snapshot, timestamp: new Date(snapshotTime) } as any)) {
              closestEntry = { key: file.substring(0, file.length - 5), snapshot: snapshot.data, time: snapshotTime };
            }
          }
        }
      } catch {
        // Directory read failed
      }
    }

    return closestEntry ? { snapshot: closestEntry.snapshot, key: closestEntry.key } : null;
  }

  /**
   * Stores calculation segment result
   */
  async setSegmentResult(segment: CalculationSegment, result: any): Promise<void> {
    const key = `segment_${segment.id}_${segment.cacheKey}`;
    await this.set(key, result, {
      size: this.estimateSize(result),
    });
    segment.cached = true;
  }

  /**
   * Retrieves calculation segment result
   */
  async getSegmentResult(segment: CalculationSegment): Promise<any | null> {
    const key = `segment_${segment.id}_${segment.cacheKey}`;
    return await this.get(key);
  }

  /**
   * Invalidates cache entries based on a hash
   */
  async invalidateByHash(hash: string): Promise<void> {
    const keysToDelete: string[] = [];

    // Check memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.inputHash === hash) {
        keysToDelete.push(key);
      }
    }

    // Delete identified keys
    for (const key of keysToDelete) {
      await this.delete(key);
    }

    // TODO: For disk cache, we'd need to store metadata about hashes
    // This is a simplified implementation
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): {
    memoryEntries: number;
    memorySizeMB: number;
    memoryUtilization: number;
    hitRate?: number;
  } {
    return {
      memoryEntries: this.memoryCache.size,
      memorySizeMB: this.currentMemorySizeMB,
      memoryUtilization: this.currentMemorySizeMB / this.maxMemorySizeMB,
    };
  }

  /**
   * Performs cache cleanup (removes expired entries)
   */
  async cleanup(): Promise<void> {
    // Clean memory cache
    const memoryKeysToDelete: string[] = [];
    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.isExpired(entry)) {
        memoryKeysToDelete.push(key);
      }
    }

    for (const key of memoryKeysToDelete) {
      const entry = this.memoryCache.get(key)!;
      this.memoryCache.delete(key);
      this.currentMemorySizeMB -= entry.size / (1024 * 1024);
    }

    // Clean disk cache
    if (this.config.useDiskCache) {
      try {
        const files = await fs.readdir(this.diskCacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const key = file.substring(0, file.length - 5);
            const entry = await this.getDisk(key);
            if (entry && this.isExpired(entry)) {
              await this.deleteDisk(key);
            }
          }
        }
      } catch {
        // Directory read failed
      }
    }
  }

  // Private helper methods

  private setMemory<T>(key: string, entry: CacheEntry<T>): void {
    // Remove existing entry if it exists
    const existing = this.memoryCache.get(key);
    if (existing) {
      this.currentMemorySizeMB -= existing.size / (1024 * 1024);
    }

    // Add new entry
    this.memoryCache.set(key, entry);
    this.currentMemorySizeMB += entry.size / (1024 * 1024);

    // Evict entries if we're over the memory limit
    this.evictIfNeeded();
  }

  private async setDisk<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    try {
      const diskPath = this.getDiskPath(key);
      // Use safe stringify to avoid serialization errors
      const safeJson = this.safeStringify(entry);
      await fs.writeFile(diskPath, safeJson, 'utf8');
    } catch (error) {
      warn(`Failed to write cache to disk: ${error}`);
    }
  }

  private async getDisk<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const diskPath = this.getDiskPath(key);
      const data = await fs.readFile(diskPath, 'utf8');
      return JSON.parse(data, this.cacheReviver) as CacheEntry<T>;
    } catch {
      return null;
    }
  }

  private async deleteDisk(key: string): Promise<void> {
    try {
      const diskPath = this.getDiskPath(key);
      await fs.unlink(diskPath);
    } catch {
      // File might not exist
    }
  }

  private getDiskPath(key: string): string {
    // Sanitize key for filesystem
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.diskCacheDir, `${sanitizedKey}.json`);
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    if (!entry.expiresAt) return false;
    return new Date() > entry.expiresAt;
  }

  private estimateSize(value: any): number {
    try {
      // Safe serialization for estimation - avoid methods and complex objects
      const safeSerialized = this.safeStringify(value);
      return safeSerialized.length * 2; // Rough estimate: 2 bytes per character
    } catch (error) {
      warn('[Cache] Error estimating size:', error instanceof Error ? error.message : String(error));
      return 1024; // Default 1KB if can't estimate
    }
  }

  private estimateSnapshotSize(snapshot: BalanceSnapshot): number {
    const baseSize = 1024; // Base overhead
    const balanceSize = Object.keys(snapshot.balances).length * 16; // 8 bytes per number + key overhead
    const indicesSize = Object.keys(snapshot.activityIndices).length * 16;
    const interestSize = Object.keys(snapshot.interestStates).length * 256; // Rough estimate for interest state
    const eventsSize = snapshot.processedEventIds.size * 32; // Rough estimate for event IDs

    return baseSize + balanceSize + indicesSize + interestSize + eventsSize;
  }

  private hashObject(obj: any): string {
    try {
      // Use safe serialization for hashing to avoid toString errors
      const safeJson = this.safeStringify(obj);
      return crypto.createHash('sha256').update(safeJson).digest('hex');
    } catch (error) {
      warn('[Cache] Error hashing object:', error instanceof Error ? error.message : String(error));
      // Fallback: create hash from object type and basic properties
      return crypto
        .createHash('sha256')
        .update(`${typeof obj}_${Date.now()}`)
        .digest('hex');
    }
  }

  /**
   * Safely serializes objects avoiding methods and circular references
   */
  private safeStringify(obj: any): string {
    const seen = new Set();

    const replacer = (_key: string, value: any) => {
      // Skip functions and methods
      if (typeof value === 'function') {
        return '[Function]';
      }

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      // Handle undefined (JSON.stringify normally omits these)
      if (value === undefined) {
        return '[Undefined]';
      }

      // Handle Date objects
      if (value instanceof Date) {
        return value.toISOString();
      }

      // For Account objects, preserve all important properties including consolidatedActivity
      if (value && typeof value === 'object' && value.constructor && value.constructor.name === 'Account') {
        return {
          id: value.id,
          name: value.name,
          type: value.type,
          balance: value.balance, // Preserve actual balance value
          consolidatedActivity: value.consolidatedActivity, // Preserve full activity array
          // Include other essential Account properties
          todayBalance: value.todayBalance,
          hidden: value.hidden,
          pullPriority: value.pullPriority,
          interestTaxRate: value.interestTaxRate,
          withdrawalTaxRate: value.withdrawalTaxRate,
          earlyWithdrawlPenalty: value.earlyWithdrawlPenalty,
          earlyWithdrawlDate: value.earlyWithdrawlDate,
          interestPayAccount: value.interestPayAccount,
          usesRMD: value.usesRMD,
          accountOwnerDOB: value.accountOwnerDOB,
          rmdAccount: value.rmdAccount,
          minimumBalance: value.minimumBalance,
          minimumPullAmount: value.minimumPullAmount,
          performsPulls: value.performsPulls,
          performsPushes: value.performsPushes,
          pushStart: value.pushStart,
          pushEnd: value.pushEnd,
          pushAccount: value.pushAccount,
          // Mark as serialized Account for reconstruction
          __type: 'Account',
        };
      }

      return value;
    };

    return JSON.stringify(obj, replacer);
  }

  /**
   * Reviver function for JSON.parse to reconstruct complex objects from cache
   */
  private cacheReviver = (_key: string, value: any): any => {
    // Handle Date objects
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return new Date(value);
    }

    // Handle undefined values that were converted to strings
    if (value === '[Undefined]') {
      return undefined;
    }

    // Handle circular references (though they shouldn't be in cache)
    if (value === '[Circular]') {
      return null; // Convert back to null to avoid errors
    }

    // Handle Function placeholders
    if (value === '[Function]') {
      return undefined; // Functions are not cached
    }

    // Reconstruct Account objects
    if (value && typeof value === 'object' && value.__type === 'Account') {
      // Create an Account-like object with the cached properties
      // Note: We avoid dynamic import to keep the reviver function synchronous
      const account = Object.create(Object.prototype);

      // Copy all the cached properties
      Object.assign(account, value);

      // Remove the __type marker
      delete account.__type;

      // Ensure consolidatedActivity is an array
      if (!Array.isArray(account.consolidatedActivity)) {
        account.consolidatedActivity = [];
      }

      return account;
    }

    return value;
  };

  private evictIfNeeded(): void {
    if (this.currentMemorySizeMB <= this.maxMemorySizeMB) return;

    // Convert to array and sort by timestamp (LRU eviction)
    const entries = Array.from(this.memoryCache.entries()).sort(
      (a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime(),
    );

    // Remove oldest entries until we're under the limit
    while (this.currentMemorySizeMB > this.maxMemorySizeMB && entries.length > 0) {
      const [key, entry] = entries.shift()!;
      this.memoryCache.delete(key);
      this.currentMemorySizeMB -= entry.size / (1024 * 1024);
    }
  }
}

/**
 * Global cache instance
 */
let globalCache: CacheManager | null = null;

/**
 * Initializes the global cache with configuration
 */
export function initializeCache(config: CalculationConfig): CacheManager {
  globalCache = new CacheManager(config);
  return globalCache;
}

/**
 * Gets the global cache instance
 */
export function getCache(): CacheManager {
  if (!globalCache) {
    throw new Error('Cache not initialized. Call initializeCache() first.');
  }
  return globalCache;
}

/**
 * Creates a cache key for a calculation
 */
export function createCalculationKey(
  startDate: Date | null,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean,
  dataHash: string,
): string {
  const start = startDate ? startDate.getTime() : 'null';
  const parts = [
    'calc',
    start,
    endDate.getTime(),
    simulation,
    monteCarlo.toString(),
    dataHash.substring(0, 8), // First 8 chars of hash
  ];

  return parts.join('_');
}

/**
 * Creates a cache key for an event
 */
export function createEventKey(eventType: string, accountId: string, date: Date, additionalData?: string): string {
  const parts = ['event', eventType, accountId, date.getTime().toString(), additionalData || ''].filter((p) => p);

  return parts.join('_');
}

