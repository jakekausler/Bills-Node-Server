import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMCMappings, getMCMappingsHandler, updateMCMappingsHandler } from './mc-mappings';
import { MonteCarloSampleType } from '../../utils/calculate-v3/types';
import type { MCMapping } from './types';
import { ApiError } from '../errors';

vi.mock('../../utils/io/io');
vi.mock('../rates-config/rates-config');

import * as mockIo from '../../utils/io/io';
import * as mockRatesConfig from '../rates-config/rates-config';

describe('mc-mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMCMappings()', () => {
    it('returns 25 entries (one per MonteCarloSampleType)', () => {
      mockIo.load.mockReturnValue({});
      const mappings = getMCMappings();
      expect(mappings).toHaveLength(25);
    });

    it('each entry has sampleType, variable (string|null), and description (string)', () => {
      mockIo.load.mockReturnValue({});
      const mappings = getMCMappings();
      for (const mapping of mappings) {
        expect(typeof mapping.sampleType).toBe('string');
        expect(mapping.variable === null || typeof mapping.variable === 'string').toBe(true);
        expect(typeof mapping.description).toBe('string');
      }
    });

    it('maps variables correctly (inverts variable→sampleType to sampleType→variable)', () => {
      mockIo.load.mockReturnValue({
        'INFLATION': 'Inflation',
        'STOCK_RETURN': 'StockReturn',
      });
      const mappings = getMCMappings();
      const inflationMapping = mappings.find(m => m.sampleType === 'Inflation');
      expect(inflationMapping?.variable).toBe('INFLATION');
      const stockMapping = mappings.find(m => m.sampleType === 'StockReturn');
      expect(stockMapping?.variable).toBe('STOCK_RETURN');
    });

    it('unmapped sample types have variable=null', () => {
      mockIo.load.mockReturnValue({
        'INFLATION': 'Inflation',
      });
      const mappings = getMCMappings();
      const unmappedMapping = mappings.find(m => m.sampleType === 'HYSA');
      expect(unmappedMapping?.variable).toBeNull();
    });

    it('includes all 25 MonteCarloSampleType enum values', () => {
      mockIo.load.mockReturnValue({});
      const mappings = getMCMappings();
      const sampleTypes = mappings.map(m => m.sampleType);
      for (const enumValue of Object.values(MonteCarloSampleType)) {
        expect(sampleTypes).toContain(enumValue);
      }
    });
  });

  describe('getMCMappingsHandler', () => {
    it('returns 25 entries from handler', async () => {
      mockIo.load.mockReturnValue({});
      const result = await getMCMappingsHandler({} as any);
      expect(result).toHaveLength(25);
    });

    it('returns properly formatted MCMapping objects', async () => {
      mockIo.load.mockReturnValue({
        'INFLATION': 'Inflation',
      });
      const result = await getMCMappingsHandler({} as any);
      const inflationMapping = result.find(m => m.sampleType === 'Inflation');
      expect(inflationMapping).toMatchObject({
        sampleType: 'Inflation',
        variable: 'INFLATION',
        description: expect.any(String),
      });
    });
  });

  describe('updateMCMappingsHandler', () => {
    it('rejects non-array request body', async () => {
      const req = { body: { sampleType: 'Inflation' } } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('Request body must be an array');
    });

    it('rejects mapping without sampleType', async () => {
      const req = { body: [{ variable: 'INFLATION', description: 'test' }] } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('sampleType string');
    });

    it('rejects unknown sample type', async () => {
      const req = {
        body: [{ sampleType: 'UnknownType', variable: 'INFLATION', description: 'test' }],
      } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('Unknown sample type');
    });

    it('rejects unknown variable (not a rate)', async () => {
      mockRatesConfig.isRate.mockReturnValue(false);
      const req = {
        body: [
          { sampleType: 'Inflation', variable: 'UNKNOWN_RATE', description: 'test' },
        ],
      } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('Unknown rate variable');
    });

    it('accepts null variable (unmapping)', async () => {
      mockIo.load.mockReturnValue({});
      mockRatesConfig.isRate.mockReturnValue(true);
      const req = {
        body: [
          {
            sampleType: 'Inflation',
            variable: null,
            description: 'General inflation rate (CPI)',
          },
        ],
      } as any;
      // Should not throw
      await expect(updateMCMappingsHandler(req)).resolves.toBeDefined();
    });

    it('accepts valid rate variable', async () => {
      mockIo.load.mockReturnValue({});
      mockRatesConfig.isRate.mockReturnValue(true);
      const req = {
        body: [
          {
            sampleType: 'Inflation',
            variable: 'INFLATION',
            description: 'General inflation rate (CPI)',
          },
        ],
      } as any;
      // Should not throw
      await expect(updateMCMappingsHandler(req)).resolves.toBeDefined();
    });

    it('correctly inverts back to variable→sampleType format for storage', async () => {
      mockIo.load.mockReturnValue({});
      mockRatesConfig.isRate.mockReturnValue(true);
      const updates = [
        {
          sampleType: 'Inflation',
          variable: 'INFLATION',
          description: 'General inflation rate (CPI)',
        },
        {
          sampleType: 'StockReturn',
          variable: 'STOCK_RETURN',
          description: 'Annual stock market return rate',
        },
      ] as MCMapping[];
      const req = { body: updates } as any;
      await updateMCMappingsHandler(req);

      // Verify save was called with variable→sampleType format
      expect(mockIo.save).toHaveBeenCalled();
      const savedData = mockIo.save.mock.calls[0][0];
      expect(savedData).toEqual({
        'INFLATION': 'Inflation',
        'STOCK_RETURN': 'StockReturn',
      });
    });

    it('saves only mapped variables (excludes null entries)', async () => {
      mockIo.load.mockReturnValue({});
      mockRatesConfig.isRate.mockReturnValue(true);
      const updates = [
        {
          sampleType: 'Inflation',
          variable: 'INFLATION',
          description: 'General inflation rate (CPI)',
        },
        {
          sampleType: 'HYSA',
          variable: null,
          description: 'High-yield savings account interest rate',
        },
      ] as MCMapping[];
      const req = { body: updates } as any;
      await updateMCMappingsHandler(req);

      const savedData = mockIo.save.mock.calls[0][0];
      expect(savedData).toEqual({
        'INFLATION': 'Inflation',
      });
      expect(savedData).not.toHaveProperty('HYSA');
    });

    it('returns updated mappings after save', async () => {
      // Mock load to return the saved mappings after save is called
      let savedData: Record<string, string> = {};
      mockIo.load.mockImplementation(() => savedData);
      mockIo.save.mockImplementation((data: any) => {
        savedData = data;
      });
      mockRatesConfig.isRate.mockReturnValue(true);
      const updates = [
        {
          sampleType: 'Inflation',
          variable: 'INFLATION',
          description: 'General inflation rate (CPI)',
        },
      ] as MCMapping[];
      const req = { body: updates } as any;
      const result = await updateMCMappingsHandler(req);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(25);
      const inflationMapping = result.find(m => m.sampleType === 'Inflation');
      expect(inflationMapping?.variable).toBe('INFLATION');
    });
  });
});
