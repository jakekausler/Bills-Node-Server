import { describe, it, expect } from 'vitest';
import { getPortfolioComposition, computeBlendedReturn } from './portfolio-utils';
import { PortfolioMakeupOverTime, PortfolioComposition } from './types';

const sampleMakeup: PortfolioMakeupOverTime = {
  '2023': { cash: 0.01, stock: 0.79, bond: 0.20, preferred: 0, convertible: 0, other: 0 },
  '2033': { cash: 0.01, stock: 0.69, bond: 0.30, preferred: 0, convertible: 0, other: 0 },
  '2043': { cash: 0.01, stock: 0.59, bond: 0.40, preferred: 0, convertible: 0, other: 0 },
};

describe('getPortfolioComposition', () => {
  it('returns exact match when year exists in data', () => {
    const result = getPortfolioComposition(sampleMakeup, new Date(Date.UTC(2023, 6, 1)));
    expect(result.stock).toBe(0.79);
    expect(result.bond).toBe(0.20);
  });

  it('clamps to earliest year for dates before range', () => {
    const result = getPortfolioComposition(sampleMakeup, new Date(Date.UTC(2020, 0, 1)));
    expect(result.stock).toBe(0.79);
  });

  it('clamps to latest year for dates after range', () => {
    const result = getPortfolioComposition(sampleMakeup, new Date(Date.UTC(2050, 0, 1)));
    expect(result.stock).toBe(0.59);
  });

  it('uses previous waypoint for years between entries', () => {
    const result = getPortfolioComposition(sampleMakeup, new Date(Date.UTC(2028, 6, 1)));
    // 2028 is between 2023 and 2033, should use 2023 data
    expect(result.stock).toBe(0.79);
    expect(result.bond).toBe(0.20);
  });

  it('uses previous waypoint just before next waypoint', () => {
    const result = getPortfolioComposition(sampleMakeup, new Date(Date.UTC(2032, 11, 31)));
    expect(result.stock).toBe(0.79);
  });

  it('returns the waypoint value at an exact waypoint boundary', () => {
    const result = getPortfolioComposition(sampleMakeup, new Date(Date.UTC(2033, 0, 1)));
    expect(result.stock).toBe(0.69);
    expect(result.bond).toBe(0.30);
  });
});

describe('computeBlendedReturn', () => {
  it('computes weighted return based on composition', () => {
    const composition: PortfolioComposition = {
      cash: 0.01,
      stock: 0.79,
      bond: 0.20,
      preferred: 0,
      convertible: 0,
      other: 0,
    };
    const result = computeBlendedReturn(composition, 0.06, 0.02, 0.01);
    // 0.06 * 0.79 + 0.02 * 0.20 + 0.01 * 0.01 = 0.0474 + 0.004 + 0.0001 = 0.0515
    expect(result).toBeCloseTo(0.0515, 6);
  });

  it('returns lower blended return for bond-heavy allocation', () => {
    const composition: PortfolioComposition = {
      cash: 0.01,
      stock: 0.29,
      bond: 0.70,
      preferred: 0,
      convertible: 0,
      other: 0,
    };
    const result = computeBlendedReturn(composition, 0.06, 0.02, 0.01);
    // 0.06 * 0.29 + 0.02 * 0.70 + 0.01 * 0.01 = 0.0174 + 0.014 + 0.0001 = 0.0315
    expect(result).toBeCloseTo(0.0315, 6);
  });

  it('handles preferred/convertible/other with stock+bond average proxy', () => {
    const composition: PortfolioComposition = {
      cash: 0,
      stock: 0.50,
      bond: 0.40,
      preferred: 0.10,
      convertible: 0,
      other: 0,
    };
    // preferred proxy = (0.06 + 0.02) / 2 = 0.04
    // result = 0.06*0.50 + 0.02*0.40 + 0.04*0.10 = 0.03 + 0.008 + 0.004 = 0.042
    const result = computeBlendedReturn(composition, 0.06, 0.02, 0.01);
    expect(result).toBeCloseTo(0.042, 6);
  });

  it('returns zero when all allocations are zero', () => {
    const composition: PortfolioComposition = {
      cash: 0,
      stock: 0,
      bond: 0,
      preferred: 0,
      convertible: 0,
      other: 0,
    };
    expect(computeBlendedReturn(composition, 0.06, 0.02, 0.01)).toBe(0);
  });

  it('glide path decreases blended return over time', () => {
    const earlyComposition = sampleMakeup['2023'];
    const lateComposition = sampleMakeup['2043'];

    const earlyReturn = computeBlendedReturn(earlyComposition, 0.06, 0.02, 0.01);
    const lateReturn = computeBlendedReturn(lateComposition, 0.06, 0.02, 0.01);

    expect(earlyReturn).toBeGreaterThan(lateReturn);
  });
});
