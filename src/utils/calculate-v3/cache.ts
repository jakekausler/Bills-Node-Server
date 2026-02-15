import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import {
  CalculationConfig,
  Segment,
  SegmentResult,
  CacheEntry,
  CacheOptions,
  BalanceSnapshot,
  BalanceSnapshotData,
  SegmentResultData,
  TaxableOccurence,
} from './types';
import { join } from 'path';
import { formatDate, parseDate } from '../date/date';
import { AccountsAndTransfers, AccountsAndTransfersData } from '../../data/account/types';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { Account } from '../../data/account/account';
// Dynamic import for ConsolidatedActivity to avoid circular dependency

class Serializer {
  serialize(data: any): string {
    return JSON.stringify(data);
  }

  deserialize(data: string, _cacheManager: CacheManager): CacheEntry<any> {
    return JSON.parse(data);
  }
}

class CalculationResultSerializer extends Serializer {
  serialize(data: CacheEntry<AccountsAndTransfers>): string {
    const serializedData = {
      accounts: data.data.accounts.map((account) => account.serialize(true)),
      transfers: {
        activity: data.data.transfers.activity.map((activity) => activity.serialize()),
        bills: data.data.transfers.bills.map((bill) => bill.serialize()),
      },
    };
    return JSON.stringify({
      data: serializedData,
      timestamp: data.timestamp,
      expiresAt: data.expiresAt,
    });
  }

  deserialize(data: string, cacheManager: CacheManager): CacheEntry<AccountsAndTransfers> {
    const rawParsedData = JSON.parse(data) as CacheEntry<AccountsAndTransfersData>;
    const accountsAndTransfers: AccountsAndTransfers = { accounts: [], transfers: { activity: [], bills: [] } };
    for (const account of rawParsedData.data.accounts) {
      accountsAndTransfers.accounts.push(new Account(account, cacheManager.getSimulation()));
    }
    for (const activity of rawParsedData.data.transfers.activity) {
      accountsAndTransfers.transfers.activity.push(new Activity(activity, cacheManager.getSimulation()));
    }
    for (const bill of rawParsedData.data.transfers.bills) {
      accountsAndTransfers.transfers.bills.push(new Bill(bill, cacheManager.getSimulation()));
    }
    return {
      data: accountsAndTransfers,
      timestamp: rawParsedData.timestamp,
      expiresAt: rawParsedData.expiresAt,
    };
  }
}

class SegmentResultSerializer extends Serializer {
  serialize(data: CacheEntry<SegmentResult>): string {
    const serializedData: SegmentResultData = {
      balanceChanges: Object.fromEntries(data.data.balanceChanges),
      activitiesAdded: Object.fromEntries(
        Array.from(data.data.activitiesAdded.entries()).map(([k, v]) => [k, v.map((activity) => activity.serialize())]),
      ),
      processedEventIds: Array.from(data.data.processedEventIds),
      balanceMinimums: Object.fromEntries(data.data.balanceMinimums),
      balanceMaximums: Object.fromEntries(data.data.balanceMaximums),
      taxableOccurences: Object.fromEntries(
        Array.from(data.data.taxableOccurences.entries()).map(([k, v]) => [
          k,
          v.map((occ) => ({
            date: formatDate(occ.date),
            year: occ.year,
            amount: occ.amount,
            taxRate: occ.taxRate,
          })),
        ]),
      ),
    };

    return JSON.stringify({
      data: serializedData,
      timestamp: data.timestamp,
      expiresAt: data.expiresAt,
    });
  }

  deserialize(data: string, _cacheManager: CacheManager): CacheEntry<SegmentResult> {
    const rawParsedData = JSON.parse(data) as CacheEntry<SegmentResultData>;
    const segmentResultData = rawParsedData.data;

    const balanceChanges = new Map<string, number>(Object.entries(segmentResultData.balanceChanges));
    // Use require() to avoid circular dependency at module load time
    const { ConsolidatedActivity } = require('../../data/activity/consolidatedActivity');
    const activitiesAdded = new Map<string, any[]>(
      Object.entries(segmentResultData.activitiesAdded).map(([k, v]) => [
        k,
        v.map((activityData) => new ConsolidatedActivity(activityData, {
          billId: activityData.billId,
          firstBill: activityData.firstBill,
          interestId: activityData.interestId,
          firstInterest: activityData.firstInterest,
          spendingTrackerId: activityData.spendingTrackerId,
          firstSpendingTracker: activityData.firstSpendingTracker,
        })),
      ]),
    );
    const processedEventIds = new Set<string>(segmentResultData.processedEventIds);
    const balanceMinimums = new Map<string, number>(Object.entries(segmentResultData.balanceMinimums));
    const balanceMaximums = new Map<string, number>(Object.entries(segmentResultData.balanceMaximums));
    const taxableOccurences = new Map<string, TaxableOccurence[]>(
      Object.entries(segmentResultData.taxableOccurences).map(([k, v]) => [
        k,
        v.map((occ) => ({
          date: parseDate(occ.date),
          year: occ.year,
          amount: occ.amount,
          taxRate: occ.taxRate,
        })),
      ]),
    );

    const segmentResult: SegmentResult = {
      balanceChanges,
      activitiesAdded,
      processedEventIds,
      balanceMinimums,
      balanceMaximums,
      taxableOccurences,
    };

    return {
      data: segmentResult,
      timestamp: rawParsedData.timestamp,
      expiresAt: rawParsedData.expiresAt,
    };
  }
}

class BalanceSnapshotSerializer extends Serializer {
  serialize(data: CacheEntry<BalanceSnapshot>): string {
    const serializedData: BalanceSnapshotData = {
      date: formatDate(data.data.date),
      balances: data.data.balances,
      activityIndices: data.data.activityIndices,
      processedEventIds: Array.from(data.data.processedEventIds),
    };
    return JSON.stringify({
      data: serializedData,
      timestamp: data.timestamp,
      expiresAt: data.expiresAt,
    });
  }

  deserialize(data: string, _cacheManager: CacheManager): CacheEntry<BalanceSnapshot> {
    const rawParsedData = JSON.parse(data) as CacheEntry<BalanceSnapshotData>;
    return {
      data: {
        date: parseDate(rawParsedData.data.date),
        balances: rawParsedData.data.balances,
        activityIndices: rawParsedData.data.activityIndices,
        processedEventIds: new Set(rawParsedData.data.processedEventIds),
      },
      timestamp: rawParsedData.timestamp,
      expiresAt: rawParsedData.expiresAt,
    };
  }
}

export class CacheManager {
  private static memoryCache: Map<string, CacheEntry<any>> = new Map();
  private diskCacheDir: string;
  private config: CalculationConfig;
  private simulation: string;
  private monteCarlo: boolean;
  private calculationResultSerializer: CalculationResultSerializer;
  private segmentResultSerializer: SegmentResultSerializer;
  private balanceSnapshotSerializer: BalanceSnapshotSerializer;

  constructor(config: CalculationConfig, simulation: string, monteCarlo: boolean = false) {
    this.diskCacheDir = config.diskCacheDir;
    this.config = config;
    this.simulation = simulation;
    this.monteCarlo = monteCarlo;

    this.initializeDiskCache();

    this.initializeSerializers();
  }

  private async initializeDiskCache() {
    if (this.config.useDiskCache) {
      // Initialize disk cache directory
      try {
        await mkdir(this.diskCacheDir, { recursive: true });
      } catch (error) {
        console.warn('Failed to create disk cache directory:', `${error}`);
      }
    }
  }

  private initializeSerializers() {
    this.calculationResultSerializer = new CalculationResultSerializer();
    this.segmentResultSerializer = new SegmentResultSerializer();
    this.balanceSnapshotSerializer = new BalanceSnapshotSerializer();
  }

  getSimulation(): string {
    return this.simulation;
  }

  async set<T>(key: string, value: T, serializer: Serializer, options: Partial<CacheOptions> = {}): Promise<void> {
    // Skip caching when in Monte Carlo mode
    if (this.monteCarlo) {
      return;
    }

    const entry: CacheEntry<T> = {
      data: value,
      timestamp: new Date(),
      expiresAt: options.expiresAt ? new Date(Date.now() + options.expiresAt.getTime()) : null,
    };

    if (this.config.useDiskCache) {
      await this.setDisk(key, entry, serializer);
    } else {
      this.setMemory(key, entry);
    }
  }

  async get<T>(key: string, serializer: Serializer): Promise<T | null> {
    // Skip cache reading when in Monte Carlo mode
    if (this.monteCarlo) {
      return null;
    }

    // Check memory cache first
    const memoryEntry = CacheManager.memoryCache.get(key);
    if (memoryEntry) {
      if (!this.isExpired(memoryEntry)) {
        return memoryEntry.data as T;
      } else {
        CacheManager.memoryCache.delete(key); // Remove expired entry
      }
    }

    // Check disk cache if memory cache miss
    if (this.config.useDiskCache) {
      const diskEntry = await this.getDisk<T>(key, serializer);
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
    // Skip cache checking when in Monte Carlo mode
    if (this.monteCarlo) {
      return false;
    }

    // Check memory cache first
    if (CacheManager.memoryCache.has(key)) {
      const entry = CacheManager.memoryCache.get(key);
      if (!entry) {
        return false;
      }
      if (!this.isExpired(entry)) {
        CacheManager.memoryCache.delete(key); // Remove expired entry
        return false;
      }
      return true;
    }

    // Check disk cache if memory cache miss
    if (this.config.useDiskCache) {
      if (key.startsWith('segment_')) {
        const diskEntry = await this.getDisk<SegmentResult>(key, this.segmentResultSerializer);
        if (diskEntry) {
          if (!this.isExpired(diskEntry)) {
            return true;
          } else {
            await this.deleteDisk(key); // Remove expired entry
            return false;
          }
        }
      } else if (key.startsWith('calc_')) {
        const diskEntry = await this.getDisk<AccountsAndTransfers>(key, this.calculationResultSerializer);
        if (diskEntry) {
          if (!this.isExpired(diskEntry)) {
            return true;
          } else {
            await this.deleteDisk(key); // Remove expired entry
            return false;
          }
        }
      } else if (key.startsWith('balance_snapshot_')) {
        const diskEntry = await this.getDisk<BalanceSnapshot>(key, this.balanceSnapshotSerializer);
        if (diskEntry) {
          if (!this.isExpired(diskEntry)) {
            return true;
          } else {
            await this.deleteDisk(key); // Remove expired entry
            return false;
          }
        }
      }
    }

    return false; // Not found or expired
  }

  async delete(key: string): Promise<void> {
    CacheManager.memoryCache.delete(key);
    if (this.config.useDiskCache) {
      await this.deleteDisk(key);
    }
  }

  async clear(): Promise<void> {
    CacheManager.memoryCache.clear();
    if (this.config.useDiskCache) {
      // Clear disk cache directory
      try {
        const files = await readdir(this.diskCacheDir);
        await Promise.all(files.map((file) => unlink(join(this.diskCacheDir, file))));
      } catch (error) {
        console.warn('Failed to clear disk cache directory:', `${error}`);
      }
    }
  }

  private getSegmentKey(segment: Segment): string {
    return `segment_${segment.id}_${formatDate(segment.startDate)}_${formatDate(segment.endDate)}_${this.simulation}`;
  }

  async setSegmentResult(segment: Segment, result: SegmentResult): Promise<void> {
    const key = this.getSegmentKey(segment);
    await this.set(key, result, this.segmentResultSerializer);
    segment.cached = true;
  }

  async getSegmentResult(segment: Segment): Promise<SegmentResult | null> {
    const key = this.getSegmentKey(segment);
    return await this.get<SegmentResult>(key, this.segmentResultSerializer);
  }

  segmentKeyToDateString(key: string): string | null {
    const match = key.match(/segment_(\d+)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const startDate = match[2];
      return startDate;
    }
    return null; // Invalid key format
  }

  async clearSegmentResultsFromDate(date: Date): Promise<void> {
    const prefix = 'segment_';
    const keysToDelete: string[] = [];

    const formattedDate = formatDate(date);

    // Check memory cache first
    for (const key of CacheManager.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        const segmentDate = this.segmentKeyToDateString(key);
        if (segmentDate && segmentDate >= formattedDate) {
          keysToDelete.push(key);
        }
      }
    }

    // Delete from memory cache
    for (const key of keysToDelete) {
      CacheManager.memoryCache.delete(key);
    }

    // Check disk cache if enabled
    if (this.config.useDiskCache) {
      try {
        const files = await readdir(this.diskCacheDir);
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith('.json')) {
            const segmentDate = this.segmentKeyToDateString(file);
            if (segmentDate && segmentDate >= formattedDate) {
              await this.deleteDisk(file.replace('.json', ''));
            }
          }
        }
      } catch (error) {
        console.warn('Failed to clear disk cache:', `${error}`);
      }
    }
  }

  async cleanup(): Promise<void> {
    // Clean memory cache
    const memoryKeysToDelete: string[] = [];
    for (const [key, entry] of CacheManager.memoryCache.entries()) {
      if (this.isExpired(entry)) {
        memoryKeysToDelete.push(key);
      }
    }

    for (const key of memoryKeysToDelete) {
      CacheManager.memoryCache.delete(key);
    }

    // Clean disk cache
    if (this.config.useDiskCache) {
      try {
        const files = await readdir(this.diskCacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const key = file.replace('.json', '');
            if (key.startsWith('segment_')) {
              const diskEntry = await this.getDisk<SegmentResult>(key, this.segmentResultSerializer);
              if (diskEntry && this.isExpired(diskEntry)) {
                await this.deleteDisk(key);
              }
            } else if (key.startsWith('calc_')) {
              const diskEntry = await this.getDisk<AccountsAndTransfers>(key, this.calculationResultSerializer);
              if (diskEntry && this.isExpired(diskEntry)) {
                await this.deleteDisk(key);
              }
            } else if (key.startsWith('balance_snapshot_')) {
              const diskEntry = await this.getDisk<BalanceSnapshot>(key, this.balanceSnapshotSerializer);
              if (diskEntry && this.isExpired(diskEntry)) {
                await this.deleteDisk(key);
              }
            }
          }
        }
      } catch (error) {
        console.warn('Failed to clean disk cache:', `${error}`);
      }
    }
  }

  private setMemory<T>(key: string, entry: CacheEntry<T>): void {
    // Remove existing entry if it exists
    const existingEntry = CacheManager.memoryCache.get(key);
    if (existingEntry) {
      CacheManager.memoryCache.delete(key);
    }
    CacheManager.memoryCache.set(key, entry);
  }

  private getDiskPath(key: string): string {
    // Sanitize key for filesystem
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.diskCacheDir, `${sanitizedKey}.json`);
  }

  private async setDisk<T>(key: string, entry: CacheEntry<T>, serializer: Serializer): Promise<void> {
    const filePath = this.getDiskPath(key);
    try {
      await mkdir(this.diskCacheDir, { recursive: true });
      const safeJson = serializer.serialize(entry);
      await writeFile(filePath, safeJson, 'utf8');
    } catch (error) {
      console.warn('Failed to write to disk cache:', `${error}`);
    }
  }

  private async getDisk<T>(key: string, serializer: Serializer): Promise<CacheEntry<T> | null> {
    const filePath = this.getDiskPath(key);
    try {
      const data = await readFile(filePath, 'utf8');
      const parsedData = serializer.deserialize(data, this) as CacheEntry<T>;
      return parsedData;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File not found
      }
      console.warn('Failed to read from disk cache:', `${error}`);
      return null;
    }
  }

  private async deleteDisk(key: string): Promise<void> {
    const filePath = this.getDiskPath(key);
    try {
      await unlink(filePath);
    } catch (error) {
      console.warn('Failed to delete from disk cache:', `${error}`);
    }
  }

  private isExpired<T>(entry: CacheEntry<T>): boolean {
    if (!entry.expiresAt) return false; // No expiration set
    return new Date() > entry.expiresAt; // Check if current time is past expiration
  }

  private createCalculationKey(startDate: Date | null, endDate: Date): string {
    const start = startDate ? formatDate(startDate) : 'null';
    const parts = ['calc', start, formatDate(endDate), this.simulation];

    return parts.join('_');
  }

  async setCalculationResult(startDate: Date | null, endDate: Date, result: AccountsAndTransfers): Promise<void> {
    const key = this.createCalculationKey(startDate, endDate);
    await this.set(key, result, this.calculationResultSerializer);
  }

  async getCalculationResult(startDate: Date | null, endDate: Date): Promise<AccountsAndTransfers | null> {
    const key = this.createCalculationKey(startDate, endDate);
    return await this.get<AccountsAndTransfers>(key, this.calculationResultSerializer);
  }

  async clearCalculationResults(): Promise<void> {
    const prefix = 'calc_';
    await this.clearByPrefix(prefix);
  }

  async clearCalculationResultsFromDate(date: Date): Promise<void> {
    // Clear all calculation caches that end (or start) after or on the given date,
    // or where either start or end date is null.
    const prefix = 'calc_';
    const filesToDelete: string[] = [];

    // Helper to parse date string or return null
    function parseDateString(dateStr: string): Date | null {
      if (dateStr === 'null') return null;
      // Expecting format YYYY-MM-DD
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    }

    // Check memory cache
    for (const key of CacheManager.memoryCache.keys()) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        // Key format: calc_{start}_{end}_{simulation}
        const parts = key.split('_');
        if (parts.length >= 4) {
          const startStr = parts[1];
          const endStr = parts[2];
          const startDate = parseDateString(startStr);
          const endDate = parseDateString(endStr);

          // If either start or end is null, or start >= date or end >= date
          if (
            startDate === null ||
            endDate === null ||
            (startDate && startDate >= date) ||
            (endDate && endDate >= date)
          ) {
            CacheManager.memoryCache.delete(key);
          }
        }
      }
    }

    // Check disk cache if enabled
    if (this.config.useDiskCache) {
      const files = await readdir(this.diskCacheDir);
      for (const file of files) {
        if (typeof file === 'string' && file.startsWith(prefix) && file.endsWith('.json')) {
          // Remove .json extension for key
          const key = file.slice(0, -5);
          const parts = key.split('_');
          if (parts.length >= 4) {
            const startStr = parts[1];
            const endStr = parts[2];
            const startDate = parseDateString(startStr);
            const endDate = parseDateString(endStr);

            if (
              startDate === null ||
              endDate === null ||
              (startDate && startDate >= date) ||
              (endDate && endDate >= date)
            ) {
              filesToDelete.push(file);
            }
          }
        }
      }
      // Delete files
      for (const file of filesToDelete) {
        try {
          await unlink(join(this.diskCacheDir, file));
        } catch (error) {
          console.warn('Failed to delete from disk cache:', `${error}`);
        }
      }
    }
  }

  async setBalanceSnapshot(date: Date, snapshot: BalanceSnapshot): Promise<string> {
    const formattedDate = formatDate(date);
    const key = `balance_snapshot_${formattedDate}_${this.simulation}`;
    await this.set(key, snapshot, this.balanceSnapshotSerializer);
    return key;
  }

  async getBalanceSnapshot(date: Date): Promise<BalanceSnapshot | null> {
    const formattedDate = formatDate(date);
    const key = `balance_snapshot_${formattedDate}_${this.simulation}`;
    return await this.get<BalanceSnapshot>(key, this.balanceSnapshotSerializer);
  }

  balanceSnapshotKeyToDateString(key: string): string | null {
    const match = key.match(/balance_snapshot_(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1]; // Return the date part
    }
    return null; // Invalid key format
  }

  async findClosestSnapshot(date: Date): Promise<{ snapshot: BalanceSnapshot; key: string } | null> {
    const prefix = 'balance_snapshot_';
    const targetTime = date.getTime();
    let closestEntry: { key: string; snapshot: BalanceSnapshot; time: number } | null = null;

    // Check memory cache first
    for (const [key, entry] of CacheManager.memoryCache.entries()) {
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
          const snapshot = await this.getDisk<BalanceSnapshot>(
            file.substring(0, file.length - 5),
            this.balanceSnapshotSerializer,
          );
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

  async clearBalanceSnapshotsFromDate(date: Date): Promise<void> {
    const prefix = 'balance_snapshot_';
    const formattedDate = formatDate(date);
    const keysToDelete: string[] = [];

    // Check memory cache first
    for (const key of CacheManager.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        const snapshotDate = this.balanceSnapshotKeyToDateString(key);
        if (snapshotDate && snapshotDate >= formattedDate) {
          keysToDelete.push(key);
        }
      }
    }

    // Delete from memory cache
    for (const key of keysToDelete) {
      CacheManager.memoryCache.delete(key);
    }

    // Check disk cache if enabled
    if (this.config.useDiskCache) {
      try {
        const files = await readdir(this.diskCacheDir);
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith('.json')) {
            const snapshotDate = this.balanceSnapshotKeyToDateString(file);
            if (snapshotDate && snapshotDate >= formattedDate) {
              await this.deleteDisk(file.replace('.json', ''));
            }
          }
        }
      } catch (error) {
        console.warn('Failed to clear disk cache:', `${error}`);
      }
    }
  }

  async clearByPrefix(prefix: string): Promise<void> {
    // Clear memory cache
    const keysToDelete: string[] = [];
    for (const key of CacheManager.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      CacheManager.memoryCache.delete(key);
    }

    // Clear disk cache if enabled
    if (this.config.useDiskCache) {
      try {
        const files = await readdir(this.diskCacheDir);
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith('.json')) {
            await this.deleteDisk(file.replace('.json', ''));
          }
        }
      } catch (error) {
        console.warn('Failed to clear disk cache:', `${error}`);
      }
    }
  }

  async clearCacheFromDate(date: Date): Promise<void> {
    await this.clearCalculationResultsFromDate(date);
    await this.clearBalanceSnapshotsFromDate(date);
    await this.clearSegmentResultsFromDate(date);
  }
}

export function initializeCache(config: CalculationConfig, simulation: string, monteCarlo: boolean = false): CacheManager {
  return new CacheManager(config, simulation, monteCarlo);
}
