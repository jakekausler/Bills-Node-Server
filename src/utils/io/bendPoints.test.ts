import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadBendPoints } from './bendPoints';
import { load } from './io';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking style: vi.mock('./io') then vi.mocked(load).mockReturnValue(...)
// - Assertion library: expect()

vi.mock('./io');

describe('bendPoints IO functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadBendPoints', () => {
    it('should load bendPoints.json and convert string keys to numbers', () => {
      const mockData = {
        '2020': { first: 960, second: 5785 },
        '2021': { first: 996, second: 6002 },
        '2022': { first: 1024, second: 6172 },
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      expect(load).toHaveBeenCalledWith('bendPoints.json');
      expect(result).toEqual({
        2020: { first: 960, second: 5785 },
        2021: { first: 996, second: 6002 },
        2022: { first: 1024, second: 6172 },
      });
    });

    it('should return numeric keys for each year', () => {
      const mockData = {
        '1990': { first: 356, second: 2145 },
        '2000': { first: 531, second: 3202 },
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      expect(result[1990]).toBeDefined();
      expect(result[2000]).toBeDefined();
    });

    it('should preserve the first and second bend point values accurately', () => {
      const mockData = {
        '2023': { first: 1115, second: 6721 },
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      expect(result[2023].first).toBe(1115);
      expect(result[2023].second).toBe(6721);
    });

    it('should return an empty object when the data file is empty', () => {
      vi.mocked(load).mockReturnValue({});

      const result = loadBendPoints();

      expect(result).toEqual({});
    });

    it('should handle a single year entry', () => {
      const mockData = { '2024': { first: 1174, second: 7078 } };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      expect(result).toEqual({ 2024: { first: 1174, second: 7078 } });
    });

    it('should handle many years of historical data', () => {
      const mockData: Record<string, { first: number; second: number }> = {};
      for (let year = 1979; year <= 2023; year++) {
        mockData[String(year)] = { first: year * 10, second: year * 60 };
      }

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      expect(result[1979]).toEqual({ first: 1979 * 10, second: 1979 * 60 });
      expect(result[2023]).toEqual({ first: 2023 * 10, second: 2023 * 60 });
      expect(Object.keys(result).length).toBe(45);
    });

    it('should handle bend points with decimal values', () => {
      const mockData = {
        '2022': { first: 1024.5, second: 6172.75 },
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      expect(result[2022].first).toBe(1024.5);
      expect(result[2022].second).toBe(6172.75);
    });

    it('should propagate errors thrown by the io load function', () => {
      vi.mocked(load).mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() => loadBendPoints()).toThrow('File not found');
    });

    it('should not include string versions of keys in the result', () => {
      const mockData = {
        '2020': { first: 960, second: 5785 },
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadBendPoints();

      // String '2020' access should be undefined; number 2020 should work
      expect((result as Record<string, unknown>)['not-a-year']).toBeUndefined();
      expect(result[2020]).toEqual({ first: 960, second: 5785 });
    });
  });
});
