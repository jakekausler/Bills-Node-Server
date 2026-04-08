import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/io/io', () => ({
  load: vi.fn(),
  save: vi.fn(),
}));

import { load, save } from '../../utils/io/io';
import {
  getRates,
  getRate,
  getRateNames,
  isRate,
  getRatesConfigHandler,
  updateRatesConfigHandler,
  KNOWN_RATES,
} from './rates-config';
import type { RateConfig } from './types';
import { Request } from 'express';

const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);

const seedRates: RateConfig[] = [
  { name: 'INFLATION', value: 0.03, description: 'General inflation rate' },
  { name: 'HEALTHCARE_INFLATION', value: 0.05, description: 'Healthcare cost inflation rate' },
  { name: 'HOME_APPRECIATION', value: 0.035, description: 'Annual home value appreciation rate' },
  { name: 'STOCK_RETURN', value: 0.06, description: 'Expected annual stock market return' },
  { name: 'BOND_RETURN', value: 0.02, description: 'Expected annual bond return' },
  { name: 'CASH_RETURN', value: 0.01, description: 'Expected annual cash/savings return' },
  { name: 'INVESTMENT_RATE', value: 0.05, description: 'General investment return rate' },
  { name: 'HIGH_YIELD_SAVINGS_RATE', value: 0.03, description: 'High-yield savings account rate' },
  { name: 'LOW_YIELD_SAVINGS_RATE', value: 0.01, description: 'Low-yield savings account rate' },
  { name: 'RAISE_RATE', value: 0.03, description: 'Expected annual salary raise rate' },
  { name: 'SS_COLA_RATE', value: 0.025, description: 'Social Security cost-of-living adjustment rate' },
  { name: '401K_LIMIT_INCREASE_RATE', value: 0.01, description: 'Annual 401(k) contribution limit increase rate' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue(seedRates as any);
});

describe('public helpers', () => {
  it('getRates returns all 12 rates', () => {
    expect(getRates()).toHaveLength(12);
  });

  it('getRate returns correct value for INFLATION', () => {
    expect(getRate('INFLATION')).toBe(0.03);
  });

  it('getRate throws for unknown name', () => {
    mockLoad.mockReturnValue(seedRates as any);
    expect(() => getRate('UNKNOWN')).toThrow('Unknown rate: UNKNOWN');
  });

  it('isRate returns true for known rate', () => {
    expect(isRate('INFLATION')).toBe(true);
  });

  it('isRate returns false for unknown name', () => {
    expect(isRate('UNKNOWN')).toBe(false);
  });

  it('getRateNames returns 12 names', () => {
    const names = getRateNames();
    expect(names).toHaveLength(12);
    expect(names).toContain('INFLATION');
    expect(names).toContain('401K_LIMIT_INCREASE_RATE');
  });
});

describe('CRUD handlers', () => {
  it('getRatesConfigHandler returns all rates', async () => {
    const result = await getRatesConfigHandler({} as Request);
    expect(result).toHaveLength(12);
  });

  it('updateRatesConfigHandler validates and saves all rates', async () => {
    const req = { body: seedRates } as Request;
    const result = await updateRatesConfigHandler(req);
    expect(result).toHaveLength(12);
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('updateRatesConfigHandler rejects non-array body', async () => {
    const req = { body: { name: 'INFLATION' } } as Request;
    await expect(updateRatesConfigHandler(req)).rejects.toThrow('exactly 12');
  });

  it('updateRatesConfigHandler rejects array with wrong count', async () => {
    const req = { body: seedRates.slice(0, 5) } as Request;
    await expect(updateRatesConfigHandler(req)).rejects.toThrow('exactly 12');
  });

  it('updateRatesConfigHandler rejects unknown rate name', async () => {
    const badRates = seedRates.map((r, i) =>
      i === 0 ? { ...r, name: 'UNKNOWN_RATE' } : r,
    );
    const req = { body: badRates } as Request;
    await expect(updateRatesConfigHandler(req)).rejects.toThrow('Unknown rate name');
  });

  it('updateRatesConfigHandler rejects non-number value', async () => {
    const badRates = seedRates.map((r, i) =>
      i === 0 ? { ...r, value: 'not-a-number' } : r,
    );
    const req = { body: badRates } as Request;
    await expect(updateRatesConfigHandler(req)).rejects.toThrow('must be a number');
  });

  it('updateRatesConfigHandler rejects missing required rate', async () => {
    // Replace one known rate name with a duplicate so count stays 12 but a rate is missing
    const missingRates = seedRates.map((r, i) =>
      i === 11 ? { ...r, name: 'INFLATION' } : r,
    );
    const req = { body: missingRates } as Request;
    await expect(updateRatesConfigHandler(req)).rejects.toThrow('Missing required rate');
  });
});
