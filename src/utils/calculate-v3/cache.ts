import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { CalculationConfig, Segment, SegmentResult, CacheEntry, CacheOptions, BalanceSnapshot } from './types';
import { warn } from '../calculate-v2/logger';
import { join } from 'path';
import { Account } from '../../data/account/account';

export class CacheManager {
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private diskCacheDir: string;
  private config: CalculationConfig;

  constructor(config: CalculationConfig) {
    this.diskCacheDir = config.diskCacheDir;
    this.config = config;

    this.initializeDiskCache();
  }

  private async initializeDiskCache() {
    if (this.config.useDiskCache) {
      // Initialize disk cache directory
      try {
        await mkdir(this.diskCacheDir, { recursive: true });
      } catch (error) {
        warn('Failed to create disk cache directory:', `${error}`);
      }
    }
  }

  async set<T>(key: string, value: T, options: Partial<CacheOptions> = {}): Promise<void> {
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: new Date(),
      expiresAt: options.expiresAt ? new Date(Date.now() + options.expiresAt.getTime()) : null,
    };

    if (this.config.useDiskCache) {
      await this.setDisk(key, entry);
    } else {
      this.setMemory(key, entry);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      if (!this.isExpired(memoryEntry)) {
        return memoryEntry.data as T;
      } else {
        this.memoryCache.delete(key); // Remove expired entry
      }
    }

    // Check disk cache if memory cache miss
    if (this.config.useDiskCache) {
      const diskEntry = await this.getDisk<T>(key);
      if (diskEntry) {
        if (!this.isExpired(diskEntry)) {
          return diskEntry.data;
        } else {
          await this.deleteDisk(key); // Remove expired entry
        }
      }
    }
    return null; // Not found or expired
  }

  async has(key: string): Promise<boolean> {
    // Check memory cache first
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key);
      if (!entry) {
        return false;
      }
      if (!this.isExpired(entry)) {
        this.memoryCache.delete(key); // Remove expired entry
        return false;
      }
      return true;
    }

    // Check disk cache if memory cache miss
    if (this.config.useDiskCache) {
      const diskEntry = await this.getDisk(key);
      if (diskEntry) {
        if (!this.isExpired(diskEntry)) {
          return true;
        } else {
          await this.deleteDisk(key); // Remove expired entry
          return false;
        }
      }
    }

    return false; // Not found or expired
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    if (this.config.useDiskCache) {
      await this.deleteDisk(key);
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    if (this.config.useDiskCache) {
      // Clear disk cache directory
      try {
        const files = await readdir(this.diskCacheDir);
        await Promise.all(files.map((file) => unlink(join(this.diskCacheDir, file))));
      } catch (error) {
        warn('Failed to clear disk cache directory:', `${error}`);
      }
    }
  }

  private getSegmentKey(segment: Segment): string {
    return `segment_${segment.id}`;
  }

  async setSegmentResult(segment: Segment, result: SegmentResult): Promise<void> {
    const key = this.getSegmentKey(segment);
    await this.set(key, result);
    segment.cached = true;
  }

  async getSegmentResult(segment: Segment): Promise<SegmentResult | null> {
    const key = this.getSegmentKey(segment);
    return await this.get<SegmentResult>(key);
  }

  async cleanup(): Promise<void> {
    // Clean memory cache
    const memoryKeysToDelete: string[] = [];
    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.isExpired(entry)) {
        memoryKeysToDelete.push(key);
      }
    }

    for (const key of memoryKeysToDelete) {
      this.memoryCache.delete(key);
    }

    // Clean disk cache
    if (this.config.useDiskCache) {
      try {
        const files = await readdir(this.diskCacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const key = file.replace('.json', '');
            const diskEntry = await this.getDisk(key);
            if (diskEntry && this.isExpired(diskEntry)) {
              await this.deleteDisk(key);
            }
          }
        }
      } catch (error) {
        warn('Failed to clean disk cache:', `${error}`);
      }
    }
  }

  private setMemory<T>(key: string, entry: CacheEntry<T>): void {
    // Remove existing entry if it exists
    const existingEntry = this.memoryCache.get(key);
    if (existingEntry) {
      this.memoryCache.delete(key);
    }
    this.memoryCache.set(key, entry);
  }

  private getDiskPath(key: string): string {
    // Sanitize key for filesystem
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.diskCacheDir, `${sanitizedKey}.json`);
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
        return (value as Account).serialize();
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
      const account = new Account(value);
      return account;
    }

    return value;
  };

  private async setDisk<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const filePath = this.getDiskPath(key);
    try {
      await mkdir(this.diskCacheDir, { recursive: true });
      const safeJson = this.safeStringify(entry);
      await writeFile(filePath, safeJson, 'utf8');
    } catch (error) {
      warn('Failed to write to disk cache:', `${error}`);
    }
  }

  private async getDisk<T>(key: string): Promise<CacheEntry<T> | null> {
    const filePath = this.getDiskPath(key);
    try {
      const data = await readFile(filePath, 'utf8');
      const parsedData = JSON.parse(data, this.cacheReviver) as CacheEntry<T>;
      return parsedData;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File not found
      }
      warn('Failed to read from disk cache:', `${error}`);
      return null;
    }
  }

  private async deleteDisk(key: string): Promise<void> {
    const filePath = this.getDiskPath(key);
    try {
      await unlink(filePath);
    } catch (error) {
      warn('Failed to delete from disk cache:', `${error}`);
    }
  }

  private isExpired<T>(entry: CacheEntry<T>): boolean {
    if (!entry.expiresAt) return false; // No expiration set
    return new Date() > entry.expiresAt; // Check if current time is past expiration
  }

  async setBalanceSnapshot(date: Date, snapshot: BalanceSnapshot): Promise<string> {
    const key = `balance_snapshot_${date.getTime()}`;
    await this.set(key, snapshot);
    return key;
  }

  async getBalanceSnapshot(date: Date): Promise<BalanceSnapshot | null> {
    const key = `balance_snapshot_${date.getTime()}`;
    return await this.get<BalanceSnapshot>(key);
  }

  async findClosestSnapshot(date: Date): Promise<{ snapshot: BalanceSnapshot; key: string } | null> {
    const prefix = 'balance_snapshot_';
    const targetTime = date.getTime();
    let closestEntry: { key: string; snapshot: BalanceSnapshot; time: number } | null = null;

    // Check memory cache first
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
      const files = await readdir(this.diskCacheDir);
      const snapshotFiles = files.filter(
        (file) => file && typeof file === 'string' && file.startsWith(prefix) && file.endsWith('.json'),
      );
      for (const file of snapshotFiles) {
        const snapshotTime = parseInt(file.substring(prefix.length, file.length - 5));
        if (snapshotTime <= targetTime && (!closestEntry || snapshotTime > closestEntry.time)) {
          const snapshot = await this.getDisk<BalanceSnapshot>(file.substring(0, file.length - 5));
          if (snapshot && !this.isExpired({ ...snapshot, timestamp: new Date(snapshotTime) } as any)) {
            closestEntry = {
              key: file.substring(0, file.length - 5),
              snapshot: snapshot.data,
              time: snapshotTime,
            };
          }
        }
      }
    }

    return closestEntry ? { snapshot: closestEntry.snapshot, key: closestEntry.key } : null;
  }
}

export function initializeCache(config: CalculationConfig): CacheManager {
  return new CacheManager(config);
}

/**
 * Creates a cache key for a calculation
 */
export function createCalculationKey(
  startDate: Date | null,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean,
): string {
  const start = startDate ? startDate.getTime() : 'null';
  const parts = ['calc', start, endDate.getTime(), simulation, monteCarlo.toString()];

  return parts.join('_');
}

/**
 * Creates a cache key for an event
 */
export function createEventKey(eventType: string, accountId: string, date: Date, additionalData?: string): string {
  const parts = ['event', eventType, accountId, date.getTime().toString(), additionalData || ''].filter((p) => p);

  return parts.join('_');
}
