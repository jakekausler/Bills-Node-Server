/**
 * Segment processing system for optimized financial calculations
 *
 * This module handles the processing of calculation segments, enabling
 * caching of intermediate results and efficient recalculation when
 * only specific time periods change.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { CalculationSegment, CalculationConfig } from './types';
import { CacheManager } from './cache';
import crypto from 'crypto';

dayjs.extend(utc);

/**
 * Processes calculation segments with caching and optimization
 */
export class SegmentProcessor {
  private segments: CalculationSegment[];
  private cache: CacheManager;
  private config: CalculationConfig;
  private segmentResults: Map<string, any> = new Map();

  constructor(segments: CalculationSegment[], cache: CacheManager, config: CalculationConfig) {
    this.segments = [...segments];
    this.cache = cache;
    this.config = config;
  }

  /**
   * Processes all segments in order
   */
  async processAllSegments(processor: (segment: CalculationSegment) => Promise<any>): Promise<Map<string, any>> {
    const results = new Map<string, any>();

    for (const segment of this.segments) {
      const result = await this.processSegment(segment, processor);
      results.set(segment.id, result);
    }

    return results;
  }

  /**
   * Processes a single segment with caching
   */
  async processSegment(
    segment: CalculationSegment,
    processor: (segment: CalculationSegment) => Promise<any>,
  ): Promise<any> {
    // Check if segment result is cached
    const cachedResult = await this.getCachedSegmentResult(segment);
    if (cachedResult) {
      this.segmentResults.set(segment.id, cachedResult);
      return cachedResult;
    }

    // Process the segment
    const result = await processor(segment);

    // Cache the result
    await this.cacheSegmentResult(segment, result);
    this.segmentResults.set(segment.id, result);

    return result;
  }

  /**
   * Gets a cached segment result
   */
  async getCachedSegmentResult(segment: CalculationSegment): Promise<any | null> {
    if (!segment.cached) {
      return null;
    }

    const cacheKey = this.generateSegmentCacheKey(segment);
    return await this.cache.get(cacheKey);
  }

  /**
   * Caches a segment result
   */
  async cacheSegmentResult(segment: CalculationSegment, result: any): Promise<void> {
    const cacheKey = this.generateSegmentCacheKey(segment);
    const size = this.estimateResultSize(result);

    await this.cache.set(cacheKey, result, {
      size,
      forceDisk: size > 1024 * 1024, // Force disk for results > 1MB
    });

    segment.cached = true;
  }

  /**
   * Invalidates cache for segments that depend on changed data
   */
  async invalidateSegments(changedAccountIds: Set<string>): Promise<void> {
    const segmentsToInvalidate = this.segments.filter((segment) =>
      this.segmentAffectedByChanges(segment, changedAccountIds),
    );

    for (const segment of segmentsToInvalidate) {
      await this.invalidateSegment(segment);
    }
  }

  /**
   * Invalidates a specific segment
   */
  async invalidateSegment(segment: CalculationSegment): Promise<void> {
    const cacheKey = this.generateSegmentCacheKey(segment);
    await this.cache.delete(cacheKey);
    segment.cached = false;
    this.segmentResults.delete(segment.id);
  }

  /**
   * Gets segments that need recalculation based on date range
   */
  getSegmentsInRange(startDate: Date, endDate: Date): CalculationSegment[] {
    return this.segments.filter((segment) => this.segmentOverlapsRange(segment, startDate, endDate));
  }

  /**
   * Gets segments that depend on specific accounts
   */
  getSegmentsDependingOn(accountIds: Set<string>): CalculationSegment[] {
    return this.segments.filter((segment) => this.segmentDependsOnAccounts(segment, accountIds));
  }

  /**
   * Optimizes segment processing order based on dependencies
   */
  getOptimizedProcessingOrder(): CalculationSegment[] {
    // For now, process in chronological order
    // TODO: Implement dependency-based ordering
    return [...this.segments].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  /**
   * Gets segments that can be processed in parallel
   */
  getParallelProcessingBatches(): CalculationSegment[][] {
    const batches: CalculationSegment[][] = [];
    const processed = new Set<string>();

    for (const segment of this.segments) {
      if (processed.has(segment.id)) continue;

      // Find all segments that can be processed with this one
      const batch = [segment];
      processed.add(segment.id);

      // For now, only segments with no overlapping accounts can be parallel
      for (const otherSegment of this.segments) {
        if (processed.has(otherSegment.id)) continue;

        if (this.canProcessInParallel(segment, otherSegment)) {
          batch.push(otherSegment);
          processed.add(otherSegment.id);
        }
      }

      batches.push(batch);
    }

    return batches;
  }

  /**
   * Creates a new segment from a date range
   */
  createSegment(startDate: Date, endDate: Date, events: any[], id?: string): CalculationSegment {
    const segmentId = id || `segment_${startDate.getTime()}_${endDate.getTime()}`;
    const affectedAccounts = new Set(events.map((event) => event.accountId).filter((id) => id));

    return {
      id: segmentId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      events: [...events],
      affectedAccounts,
      dependencies: this.calculateSegmentDependencies(events),
      cached: false,
      cacheKey: this.generateCacheKeyFromEvents(events),
    };
  }

  /**
   * Splits a segment into smaller segments
   */
  splitSegment(segment: CalculationSegment, splitDate: Date): CalculationSegment[] {
    if (splitDate <= segment.startDate || splitDate >= segment.endDate) {
      return [segment];
    }

    const beforeEvents = segment.events.filter((event) => event.date < splitDate);
    const afterEvents = segment.events.filter((event) => event.date >= splitDate);

    const beforeSegment = this.createSegment(segment.startDate, splitDate, beforeEvents, `${segment.id}_before`);

    const afterSegment = this.createSegment(splitDate, segment.endDate, afterEvents, `${segment.id}_after`);

    return [beforeSegment, afterSegment];
  }

  /**
   * Merges adjacent segments
   */
  mergeSegments(segments: CalculationSegment[]): CalculationSegment {
    if (segments.length === 0) {
      throw new Error('Cannot merge empty segment list');
    }

    if (segments.length === 1) {
      return segments[0];
    }

    // Sort segments by start date
    const sortedSegments = [...segments].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    // Validate that segments are adjacent
    for (let i = 1; i < sortedSegments.length; i++) {
      const prev = sortedSegments[i - 1];
      const curr = sortedSegments[i];

      if (prev.endDate.getTime() !== curr.startDate.getTime()) {
        throw new Error(`Segments ${prev.id} and ${curr.id} are not adjacent`);
      }
    }

    // Merge events and metadata
    const allEvents = sortedSegments.flatMap((segment) => segment.events);
    const allAffectedAccounts = new Set<string>();
    const allDependencies = new Set<string>();

    for (const segment of sortedSegments) {
      for (const accountId of segment.affectedAccounts) {
        allAffectedAccounts.add(accountId);
      }
      for (const dep of segment.dependencies) {
        allDependencies.add(dep);
      }
    }

    return {
      id: `merged_${sortedSegments.map((s) => s.id).join('_')}`,
      startDate: sortedSegments[0].startDate,
      endDate: sortedSegments[sortedSegments.length - 1].endDate,
      events: allEvents.sort((a, b) => a.date.getTime() - b.date.getTime()),
      affectedAccounts: allAffectedAccounts,
      dependencies: Array.from(allDependencies),
      cached: false,
      cacheKey: this.generateCacheKeyFromEvents(allEvents),
    };
  }

  /**
   * Gets statistics about segment processing
   */
  getStats(): {
    totalSegments: number;
    cachedSegments: number;
    averageEventsPerSegment: number;
    averageDuration: number;
    cacheHitRate: number;
  } {
    const cachedCount = this.segments.filter((s) => s.cached).length;
    const totalEvents = this.segments.reduce((sum, s) => sum + s.events.length, 0);
    const totalDuration = this.segments.reduce((sum, s) => sum + (s.endDate.getTime() - s.startDate.getTime()), 0);

    return {
      totalSegments: this.segments.length,
      cachedSegments: cachedCount,
      averageEventsPerSegment: this.segments.length > 0 ? totalEvents / this.segments.length : 0,
      averageDuration: this.segments.length > 0 ? totalDuration / this.segments.length : 0,
      cacheHitRate: this.segments.length > 0 ? cachedCount / this.segments.length : 0,
    };
  }

  /**
   * Clears all cached segment results
   */
  async clearCache(): Promise<void> {
    for (const segment of this.segments) {
      await this.invalidateSegment(segment);
    }
  }

  /**
   * Performs cleanup on expired cached segments
   */
  async cleanup(): Promise<void> {
    // This would be implemented based on specific cleanup policies
    // For now, just clean up segments older than a certain threshold
    const cutoffDate = dayjs().subtract(30, 'day').toDate();

    for (const segment of this.segments) {
      if (segment.endDate < cutoffDate && segment.cached) {
        await this.invalidateSegment(segment);
      }
    }
  }

  // Private helper methods

  private generateSegmentCacheKey(segment: CalculationSegment): string {
    return `segment_${segment.id}_${segment.cacheKey}`;
  }

  private generateCacheKeyFromEvents(events: any[]): string {
    const eventSummary = events
      .map((event) => `${event.type}_${event.date.getTime()}_${event.accountId || 'global'}`)
      .join('|');

    return crypto.createHash('sha256').update(eventSummary).digest('hex').substring(0, 16);
  }

  private calculateSegmentDependencies(events: any[]): string[] {
    const dependencies = new Set<string>();

    for (const event of events) {
      for (const dep of event.dependencies || []) {
        dependencies.add(dep);
      }
    }

    return Array.from(dependencies);
  }

  private segmentOverlapsRange(segment: CalculationSegment, startDate: Date, endDate: Date): boolean {
    return segment.startDate <= endDate && segment.endDate >= startDate;
  }

  private segmentDependsOnAccounts(segment: CalculationSegment, accountIds: Set<string>): boolean {
    for (const accountId of accountIds) {
      if (segment.affectedAccounts.has(accountId) || segment.dependencies.includes(accountId)) {
        return true;
      }
    }
    return false;
  }

  private segmentAffectedByChanges(segment: CalculationSegment, changedAccountIds: Set<string>): boolean {
    return this.segmentDependsOnAccounts(segment, changedAccountIds);
  }

  private canProcessInParallel(segment1: CalculationSegment, segment2: CalculationSegment): boolean {
    // Segments can be processed in parallel if:
    // 1. They don't share any affected accounts
    // 2. They don't have dependency relationships

    // Check for shared accounts
    for (const accountId of segment1.affectedAccounts) {
      if (segment2.affectedAccounts.has(accountId)) {
        return false;
      }
    }

    // Check for dependencies
    if (segment1.dependencies.includes(segment2.id) || segment2.dependencies.includes(segment1.id)) {
      return false;
    }

    // Check for shared dependencies
    for (const dep of segment1.dependencies) {
      if (segment2.dependencies.includes(dep)) {
        return false;
      }
    }

    return true;
  }

  private estimateResultSize(result: any): number {
    try {
      return JSON.stringify(result).length * 2; // Rough estimate
    } catch {
      return 1024; // Default 1KB
    }
  }

  /**
   * Gets all segments
   */
  getSegments(): CalculationSegment[] {
    return [...this.segments];
  }

  /**
   * Gets a specific segment by ID
   */
  getSegment(segmentId: string): CalculationSegment | undefined {
    return this.segments.find((segment) => segment.id === segmentId);
  }

  /**
   * Adds a new segment
   */
  addSegment(segment: CalculationSegment): void {
    this.segments.push(segment);
    this.segments.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  /**
   * Removes a segment
   */
  async removeSegment(segmentId: string): Promise<boolean> {
    const index = this.segments.findIndex((segment) => segment.id === segmentId);
    if (index === -1) return false;

    const segment = this.segments[index];
    await this.invalidateSegment(segment);
    this.segments.splice(index, 1);

    return true;
  }

  /**
   * Updates a segment
   */
  async updateSegment(segmentId: string, updates: Partial<CalculationSegment>): Promise<boolean> {
    const segment = this.segments.find((s) => s.id === segmentId);
    if (!segment) return false;

    // Invalidate old cache
    await this.invalidateSegment(segment);

    // Apply updates
    Object.assign(segment, updates);

    // Regenerate cache key if events changed
    if (updates.events) {
      segment.cacheKey = this.generateCacheKeyFromEvents(updates.events);
    }

    return true;
  }
}
