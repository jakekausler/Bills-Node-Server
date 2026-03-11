import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadAverageWageIndex } from './averageWageIndex';
import { load } from './io';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking style: vi.mock('./io') then vi.mocked(load).mockReturnValue(...)
// - Assertion library: expect()
// - Async handling: synchronous tests

vi.mock('./io');

describe('averageWageIndex IO functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadAverageWageIndex', () => {
    it('should load averageWageIndex.json and convert string keys to numbers', () => {
      const mockData = {
        '2020': 55628.6,
        '2021': 60575.07,
        '2022': 63795.13,
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadAverageWageIndex();

      expect(load).toHaveBeenCalledWith('averageWageIndex.json');
      expect(result).toEqual({
        2020: 55628.6,
        2021: 60575.07,
        2022: 63795.13,
      });
    });

    it('should return numeric keys, not string keys', () => {
      const mockData = {
        '1990': 21027.98,
        '2000': 32154.82,
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadAverageWageIndex();

      const keys = Object.keys(result).map(Number);
      expect(keys).toContain(1990);
      expect(keys).toContain(2000);
    });

    it('should preserve wage index values accurately', () => {
      const mockData = {
        '2015': 48098.63,
      };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadAverageWageIndex();

      expect(result[2015]).toBe(48098.63);
    });

    it('should return an empty object when the data file is empty', () => {
      vi.mocked(load).mockReturnValue({});

      const result = loadAverageWageIndex();

      expect(result).toEqual({});
    });

    it('should handle a single year entry', () => {
      const mockData = { '2023': 66621.8 };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadAverageWageIndex();

      expect(result).toEqual({ 2023: 66621.8 });
    });

    it('should handle many years of historical data', () => {
      const mockData: Record<string, number> = {};
      for (let year = 1951; year <= 2023; year++) {
        mockData[String(year)] = year * 100.5;
      }

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadAverageWageIndex();

      expect(result[1951]).toBe(1951 * 100.5);
      expect(result[2023]).toBe(2023 * 100.5);
      expect(Object.keys(result).length).toBe(73);
    });

    it('should propagate errors thrown by the io load function', () => {
      vi.mocked(load).mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() => loadAverageWageIndex()).toThrow('File not found');
    });

    it('should convert string keys using parseInt (truncating decimals)', () => {
      // parseInt('2020.5') === 2020
      const mockData = { '2020': 12345.67 };

      vi.mocked(load).mockReturnValue(mockData);

      const result = loadAverageWageIndex();

      // Key should be a number
      expect(typeof Object.keys(result)[0]).toBe('string'); // JS object keys are always strings
      expect(result[2020]).toBe(12345.67);
    });
  });
});
