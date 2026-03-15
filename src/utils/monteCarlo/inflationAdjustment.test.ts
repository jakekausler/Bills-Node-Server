import { describe, it, expect, beforeAll } from 'vitest';
import { MonteCarloHandler, MonteCarloSampleType } from '../calculate-v3/monte-carlo-handler';

describe('Inflation Adjustment - Monte Carlo Handler', () => {
  let handler: MonteCarloHandler;
  const startDate = new Date('2026-01-01');
  const endDate = new Date('2030-12-31');
  const seed = 42;

  beforeAll(async () => {
    handler = await MonteCarloHandler.getInstance(startDate, endDate, seed);
  });

  it('should extract inflation rates per year', () => {
    const inflationByYear = handler.getInflationByYear();

    expect(inflationByYear).toBeDefined();
    expect(typeof inflationByYear).toBe('object');

    // Should have entries for each year in range
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();
    for (let year = startYear; year <= endYear; year++) {
      expect(inflationByYear[year]).toBeDefined();
      expect(typeof inflationByYear[year]).toBe('number');
    }
  });

  it('should have inflation rates between -0.1 and 0.5 (realistic range)', () => {
    const inflationByYear = handler.getInflationByYear();

    Object.values(inflationByYear).forEach((rate) => {
      expect(rate).toBeGreaterThanOrEqual(-0.1);
      expect(rate).toBeLessThanOrEqual(0.5);
    });
  });

  it('should return consistent inflation for same seed', async () => {
    const handler1 = await MonteCarloHandler.getInstance(startDate, endDate, seed);
    const handler2 = await MonteCarloHandler.getInstance(startDate, endDate, seed);

    const inflation1 = handler1.getInflationByYear();
    const inflation2 = handler2.getInflationByYear();

    expect(inflation1).toEqual(inflation2);
  });

  it('should return different inflation for different seeds', async () => {
    const handler1 = await MonteCarloHandler.getInstance(startDate, endDate, seed);
    const handler2 = await MonteCarloHandler.getInstance(startDate, endDate, seed + 1);

    const inflation1 = handler1.getInflationByYear();
    const inflation2 = handler2.getInflationByYear();

    // Very unlikely to be identical across all years
    const isSame = Object.keys(inflation1).every((year) => inflation1[parseInt(year)] === inflation2[parseInt(year)]);
    expect(isSame).toBe(false);
  });
});

describe('Cumulative Inflation Calculation', () => {
  it('should compute cumulative inflation correctly', () => {
    const startYear = 2026;
    const endYear = 2030;
    const inflationByYear: Record<number, number> = {
      2026: 0.03, // 3%
      2027: 0.02, // 2%
      2028: 0.04, // 4%
      2029: 0.01, // 1%
      2030: 0.02, // 2%
    };

    // Compute cumulative
    const cumulativeInflation: Record<number, number> = {};
    let cumulative = 1.0;
    for (let year = startYear; year <= endYear; year++) {
      cumulativeInflation[year] = cumulative;
      const rate = inflationByYear[year] || 0;
      cumulative *= (1 + rate);
    }

    expect(cumulativeInflation[2026]).toBe(1.0);
    expect(cumulativeInflation[2027]).toBeCloseTo(1.03, 5);
    expect(cumulativeInflation[2028]).toBeCloseTo(1.03 * 1.02, 5);
    expect(cumulativeInflation[2029]).toBeCloseTo(1.03 * 1.02 * 1.04, 5);
    expect(cumulativeInflation[2030]).toBeCloseTo(1.03 * 1.02 * 1.04 * 1.01, 5);
  });

  it('should deflate nominal values correctly', () => {
    const nominalValue = 100000;
    const cumulativeInflation = 1.05; // 5% cumulative inflation

    const realValue = nominalValue / cumulativeInflation;

    expect(realValue).toBeCloseTo(95238.1, 0); // ~95,238
  });

  it('should produce lower real values than nominal values in inflationary scenario', () => {
    const cumulativeInflation: Record<number, number> = {
      2026: 1.0,
      2027: 1.03,
      2028: 1.0506,
      2029: 1.092624,
      2030: 1.10335328,
    };

    const nominalValues: number[] = [100000, 102000, 104040, 106122, 108244];

    nominalValues.forEach((nominalValue, index) => {
      const year = 2026 + index;
      const realValue = nominalValue / cumulativeInflation[year];
      expect(realValue).toBeLessThanOrEqual(nominalValue);
    });
  });

  it('should maintain start year value at 1.0 multiplier', () => {
    const cumulativeInflation: Record<number, number> = {
      2026: 1.0,
      2027: 1.03,
      2028: 1.0506,
    };

    const nominalValue = 100000;
    const realValueStartYear = nominalValue / cumulativeInflation[2026];

    expect(realValueStartYear).toBe(nominalValue);
  });
});
