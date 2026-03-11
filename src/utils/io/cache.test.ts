import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetCache } from './cache';
import { CacheManager } from '../calculate-v3/cache';

// Mock dependencies
vi.mock('../calculate-v3/cache');

describe('Cache Utility', () => {
  let mockClear: ReturnType<typeof vi.fn>;
  let mockClearCacheFromDate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClear = vi.fn();
    mockClearCacheFromDate = vi.fn();
    vi.mocked(CacheManager).mockImplementation(
      () =>
        ({
          clear: mockClear,
          clearCacheFromDate: mockClearCacheFromDate,
        }) as any,
    );
  });

  describe('resetCache', () => {
    it('should create a CacheManager and call clear when no date is provided', () => {
      resetCache('Default');

      expect(CacheManager).toHaveBeenCalledWith(
        { useDiskCache: false, diskCacheDir: 'cache', snapshotInterval: 'monthly' },
        'Default',
      );
      expect(mockClear).toHaveBeenCalledOnce();
      expect(mockClearCacheFromDate).not.toHaveBeenCalled();
    });

    it('should create a CacheManager and call clearCacheFromDate when a date is provided', () => {
      const testDate = new Date('2024-06-15');

      resetCache('Default', testDate);

      expect(CacheManager).toHaveBeenCalledWith(
        { useDiskCache: false, diskCacheDir: 'cache', snapshotInterval: 'monthly' },
        'Default',
      );
      expect(mockClearCacheFromDate).toHaveBeenCalledWith(testDate);
      expect(mockClear).not.toHaveBeenCalled();
    });

    it('should handle different dates correctly', () => {
      const earlyDate = new Date('2020-01-01');
      resetCache('Default', earlyDate);
      expect(mockClearCacheFromDate).toHaveBeenCalledWith(earlyDate);

      vi.clearAllMocks();
      vi.mocked(CacheManager).mockImplementation(
        () =>
          ({
            clear: mockClear,
            clearCacheFromDate: mockClearCacheFromDate,
          }) as any,
      );

      const lateDate = new Date('2030-12-31');
      resetCache('Default', lateDate);
      expect(mockClearCacheFromDate).toHaveBeenCalledWith(lateDate);
    });
  });
});
