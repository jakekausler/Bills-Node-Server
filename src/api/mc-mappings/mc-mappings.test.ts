import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMCMappings, getMCMappingsHandler, updateMCMappingsHandler } from './mc-mappings';
import { MonteCarloSampleType } from '../../utils/calculate-v3/types';
import type { MCMapping } from './types';
import { ApiError } from '../errors';

vi.mock('../../utils/io/io');
vi.mock('../rates-config/rates-config');

import * as mockIo from '../../utils/io/io';
import * as mockRatesConfig from '../rates-config/rates-config';

const MOCK_RATES = [
  { name: 'INFLATION', value: 0.03, description: 'General inflation rate' },
  { name: 'HEALTHCARE_INFLATION', value: 0.05, description: 'Healthcare inflation rate' },
  { name: 'HOME_APPRECIATION', value: 0.03, description: 'Home appreciation rate' },
  { name: 'STOCK_RETURN', value: 0.07, description: 'Stock return rate' },
  { name: 'BOND_RETURN', value: 0.04, description: 'Bond return rate' },
  { name: 'CASH_RETURN', value: 0.02, description: 'Cash return rate' },
  { name: 'INVESTMENT_RATE', value: 0.06, description: 'Investment rate' },
  { name: 'HIGH_YIELD_SAVINGS_RATE', value: 0.04, description: 'High-yield savings rate' },
  { name: 'LOW_YIELD_SAVINGS_RATE', value: 0.01, description: 'Low-yield savings rate' },
  { name: 'RAISE_RATE', value: 0.03, description: 'Raise rate' },
  { name: 'SS_COLA_RATE', value: 0.02, description: 'SS COLA rate' },
  { name: '401K_LIMIT_INCREASE_RATE', value: 0.02, description: '401k limit increase rate' },
];

describe('mc-mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRatesConfig.getRates.mockReturnValue(MOCK_RATES);
  });

  describe('getMCMappings()', () => {
    it('returns 12 entries (one per rate variable)', () => {
      mockIo.load.mockReturnValue({});
      const mappings = getMCMappings();
      expect(mappings).toHaveLength(12);
    });

    it('each entry has variable, sampleType (string|null), and description', () => {
      mockIo.load.mockReturnValue({});
      const mappings = getMCMappings();
      for (const mapping of mappings) {
        expect(typeof mapping.variable).toBe('string');
        expect(mapping.sampleType === null || typeof mapping.sampleType === 'string').toBe(true);
        expect(typeof mapping.description).toBe('string');
      }
    });

    it('maps sample types correctly from file', () => {
      mockIo.load.mockReturnValue({
        'INFLATION': 'Inflation',
        'STOCK_RETURN': 'StockReturn',
      });
      const mappings = getMCMappings();
      const inflationMapping = mappings.find(m => m.variable === 'INFLATION');
      expect(inflationMapping?.sampleType).toBe('Inflation');
      const stockMapping = mappings.find(m => m.variable === 'STOCK_RETURN');
      expect(stockMapping?.sampleType).toBe('StockReturn');
    });

    it('unmapped variables have sampleType=null', () => {
      mockIo.load.mockReturnValue({
        'INFLATION': 'Inflation',
      });
      const mappings = getMCMappings();
      const unmapped = mappings.find(m => m.variable === 'STOCK_RETURN');
      expect(unmapped?.sampleType).toBeNull();
    });

    it('descriptions come from rate config', () => {
      mockIo.load.mockReturnValue({});
      const mappings = getMCMappings();
      const inflation = mappings.find(m => m.variable === 'INFLATION');
      expect(inflation?.description).toBe('General inflation rate');
    });
  });

  describe('getMCMappingsHandler', () => {
    it('returns 12 entries from handler', async () => {
      mockIo.load.mockReturnValue({});
      const result = await getMCMappingsHandler({} as any);
      expect(result).toHaveLength(12);
    });

    it('returns properly formatted MCMapping objects', async () => {
      mockIo.load.mockReturnValue({
        'INFLATION': 'Inflation',
      });
      const result = await getMCMappingsHandler({} as any);
      const inflationMapping = result.find(m => m.variable === 'INFLATION');
      expect(inflationMapping).toMatchObject({
        variable: 'INFLATION',
        sampleType: 'Inflation',
        description: 'General inflation rate',
      });
    });
  });

  describe('updateMCMappingsHandler', () => {
    it('rejects non-array request body', async () => {
      const req = { body: { variable: 'INFLATION' } } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('Request body must be an array');
    });

    it('rejects mapping without variable', async () => {
      const req = { body: [{ sampleType: 'Inflation', description: 'test' }] } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('variable string');
    });

    it('rejects unknown sample type', async () => {
      const req = {
        body: [{ variable: 'INFLATION', sampleType: 'UnknownType', description: 'test' }],
      } as any;
      await expect(updateMCMappingsHandler(req)).rejects.toThrow(ApiError);
      await expect(updateMCMappingsHandler(req)).rejects.toThrow('Unknown sample type');
    });

    it('accepts null sampleType (unmapping)', async () => {
      mockIo.load.mockReturnValue({});
      const req = {
        body: [{ variable: 'INFLATION', sampleType: null, description: 'test' }],
      } as any;
      await expect(updateMCMappingsHandler(req)).resolves.toBeDefined();
    });

    it('accepts valid sample type', async () => {
      mockIo.load.mockReturnValue({});
      const req = {
        body: [{ variable: 'INFLATION', sampleType: 'Inflation', description: 'test' }],
      } as any;
      await expect(updateMCMappingsHandler(req)).resolves.toBeDefined();
    });

    it('saves variable→sampleType format', async () => {
      mockIo.load.mockReturnValue({});
      const updates: MCMapping[] = [
        { variable: 'INFLATION', sampleType: 'Inflation', description: 'test' },
        { variable: 'STOCK_RETURN', sampleType: 'StockReturn', description: 'test' },
      ];
      const req = { body: updates } as any;
      await updateMCMappingsHandler(req);

      expect(mockIo.save).toHaveBeenCalled();
      const savedData = mockIo.save.mock.calls[0][0];
      expect(savedData).toEqual({
        'INFLATION': 'Inflation',
        'STOCK_RETURN': 'StockReturn',
      });
    });

    it('saves only mapped variables (excludes null entries)', async () => {
      mockIo.load.mockReturnValue({});
      const updates: MCMapping[] = [
        { variable: 'INFLATION', sampleType: 'Inflation', description: 'test' },
        { variable: 'STOCK_RETURN', sampleType: null, description: 'test' },
      ];
      const req = { body: updates } as any;
      await updateMCMappingsHandler(req);

      const savedData = mockIo.save.mock.calls[0][0];
      expect(savedData).toEqual({ 'INFLATION': 'Inflation' });
      expect(savedData).not.toHaveProperty('STOCK_RETURN');
    });

    it('allows multiple variables to map to the same sample type', async () => {
      mockIo.load.mockReturnValue({});
      const updates: MCMapping[] = [
        { variable: 'INFLATION', sampleType: 'Inflation', description: 'test' },
        { variable: 'HEALTHCARE_INFLATION', sampleType: 'Inflation', description: 'test' },
      ];
      const req = { body: updates } as any;
      await expect(updateMCMappingsHandler(req)).resolves.toBeDefined();
    });

    it('returns updated mappings after save', async () => {
      let savedData: Record<string, string> = {};
      mockIo.load.mockImplementation(() => savedData);
      mockIo.save.mockImplementation((data: any) => { savedData = data; });
      const updates: MCMapping[] = [
        { variable: 'INFLATION', sampleType: 'Inflation', description: 'test' },
      ];
      const req = { body: updates } as any;
      const result = await updateMCMappingsHandler(req);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(12);
      const inflationMapping = result.find(m => m.variable === 'INFLATION');
      expect(inflationMapping?.sampleType).toBe('Inflation');
    });
  });
});
