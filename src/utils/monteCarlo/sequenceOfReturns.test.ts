import { describe, it, expect } from 'vitest';
import { pearsonR, computeSequenceOfReturns } from './sequenceOfReturns';
import { AggregatedSimulationResult } from './types';

function makeSim(
  num: number,
  overrides: Partial<AggregatedSimulationResult> = {},
): AggregatedSimulationResult {
  return {
    simulationNumber: num,
    yearlyMinBalances: { 2030: 500000, 2031: 480000, 2032: 460000, 2033: 440000, 2034: 420000, 2035: 400000 },
    yearlyPortfolioReturns: { 2030: 0.05, 2031: 0.03, 2032: 0.04, 2033: 0.06, 2034: 0.02 },
    cumulativeInflation: { 2030: 1.0, 2031: 1.03, 2032: 1.06, 2033: 1.09, 2034: 1.12, 2035: 1.15 },
    fundingFailureYear: null,
    ...overrides,
  };
}

describe('pearsonR', () => {
  it('returns 1.0 for perfectly correlated arrays', () => {
    const r = pearsonR([1, 2, 3], [2, 4, 6]);
    expect(r).toBeCloseTo(1.0, 10);
  });

  it('returns 0 for fewer than 2 data points', () => {
    expect(pearsonR([1], [2])).toBe(0);
    expect(pearsonR([], [])).toBe(0);
  });

  it('returns -1.0 for perfectly negatively correlated arrays', () => {
    const r = pearsonR([1, 2, 3], [6, 4, 2]);
    expect(r).toBeCloseTo(-1.0, 10);
  });
});

describe('computeSequenceOfReturns', () => {
  const endYear = 2035;

  it('computes correct average early return for 5-year window', () => {
    const sim = makeSim(1);
    const result = computeSequenceOfReturns([sim], 2030, 5, endYear);

    expect(result.simulations).toHaveLength(1);
    // Average of 0.05, 0.03, 0.04, 0.06, 0.02 = 0.20 / 5 = 0.04
    expect(result.simulations[0].avgEarlyReturn).toBeCloseTo(0.04, 10);
    expect(result.window).toBe(5);
  });

  it('correctly classifies failed vs successful simulations', () => {
    const successSim = makeSim(1, { fundingFailureYear: null });
    const failedSim = makeSim(2, { fundingFailureYear: 2033 });

    const result = computeSequenceOfReturns([successSim, failedSim], 2030, 5, endYear);

    expect(result.summary.failedCount).toBe(1);
    expect(result.summary.successCount).toBe(1);
    expect(result.simulations.find((s) => s.simulationNumber === 1)!.failed).toBe(false);
    expect(result.simulations.find((s) => s.simulationNumber === 2)!.failed).toBe(true);
    expect(result.simulations.find((s) => s.simulationNumber === 2)!.failureYear).toBe(2033);
  });

  it('returns failedAvgEarlyReturn = 0 when no sims failed', () => {
    const sim1 = makeSim(1);
    const sim2 = makeSim(2);

    const result = computeSequenceOfReturns([sim1, sim2], 2030, 5, endYear);

    expect(result.summary.failedCount).toBe(0);
    expect(result.summary.failedAvgEarlyReturn).toBe(0);
    expect(result.summary.successCount).toBe(2);
    expect(result.summary.successAvgEarlyReturn).toBeCloseTo(0.04, 10);
  });

  it('returns successAvgEarlyReturn = 0 when all sims failed', () => {
    const sim1 = makeSim(1, { fundingFailureYear: 2032 });
    const sim2 = makeSim(2, { fundingFailureYear: 2034 });

    const result = computeSequenceOfReturns([sim1, sim2], 2030, 5, endYear);

    expect(result.summary.successCount).toBe(0);
    expect(result.summary.successAvgEarlyReturn).toBe(0);
    expect(result.summary.failedCount).toBe(2);
    expect(result.summary.failedAvgEarlyReturn).toBeCloseTo(0.04, 10);
  });

  it('excludes simulations missing yearlyPortfolioReturns', () => {
    const simWithReturns = makeSim(1);
    const simWithout = makeSim(2, { yearlyPortfolioReturns: undefined });

    const result = computeSequenceOfReturns([simWithReturns, simWithout], 2030, 5, endYear);

    expect(result.simulations).toHaveLength(1);
    expect(result.summary.totalSimulations).toBe(1);
    expect(result.simulations[0].simulationNumber).toBe(1);
  });

  it('computes real final balance using cumulative inflation', () => {
    // Final year is 2035 with balance 400000 and inflation multiplier 1.15
    const sim = makeSim(1);
    const result = computeSequenceOfReturns([sim], 2030, 5, endYear);

    const simResult = result.simulations[0];
    expect(simResult.finalBalance).toBe(400000);
    // realFinalBalance = 400000 / 1.15
    expect(simResult.realFinalBalance).toBeCloseTo(400000 / 1.15, 2);
  });

  it('clamps window when it exceeds simulation end year', () => {
    const sim = makeSim(1);
    // retirementYear 2033, window 10 would go to 2042, but endYear is 2035
    // effective window = min(10, 2035 - 2033 + 1) = 3
    const result = computeSequenceOfReturns([sim], 2033, 10, endYear);

    expect(result.window).toBe(3);
    // Should average returns for 2033 and 2034 (only those exist in the data)
    // 2033: 0.06, 2034: 0.02 → (0.06 + 0.02) / 2 = 0.04
    expect(result.simulations[0].avgEarlyReturn).toBeCloseTo(0.04, 10);
  });

  it('handles simulation with no cumulative inflation data', () => {
    const sim = makeSim(1, { cumulativeInflation: undefined });
    const result = computeSequenceOfReturns([sim], 2030, 5, endYear);

    // Without inflation data, realFinalBalance should equal finalBalance
    expect(result.simulations[0].realFinalBalance).toBe(result.simulations[0].finalBalance);
  });
});
