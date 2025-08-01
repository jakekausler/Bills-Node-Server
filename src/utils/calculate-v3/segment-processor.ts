import { Segment, SegmentResult } from './types';
import { CacheManager } from './cache';

export class SegmentProcessor {
  private segments: Segment[];
  private cache: CacheManager;
  private segmentResults: Map<string, SegmentResult> = new Map();

  constructor(segments: Segment[], cache: CacheManager) {
    this.segments = segments;
    this.cache = cache;
  }

  async getCachedSegmentResult(segment: Segment): Promise<SegmentResult | null> {
    if (!segment.cached) return null;
    const cacheKey = this.generateSegmentCacheKey(segment);
    return await this.cache.get(cacheKey);
  }

  async cacheSegmentResult(segment: Segment, segmentResult: SegmentResult): Promise<void> {
    const cacheKey = this.generateSegmentCacheKey(segment);
    await this.cache.set(cacheKey, segmentResult);
  }

  private generateSegmentCacheKey(segment: Segment): string {
    return `segment_${segment.id}_${segment.cacheKey}`;
  }
}
