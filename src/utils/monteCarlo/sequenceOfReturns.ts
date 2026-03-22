import { readFileSync } from 'fs';
import { join } from 'path';
import { AggregatedSimulationResult } from './types';
import { MC_RESULTS_DIR } from './paths';

export interface SequenceOfReturnsData {
  simulations: Array<{
    simulationNumber: number;
    avgEarlyReturn: number;
    finalBalance: number;
    realFinalBalance: number;
    failed: boolean;
    failureYear: number | null;
  }>;
  summary: {
    totalSimulations: number;
    failedCount: number;
    successCount: number;
    failedAvgEarlyReturn: number;
    successAvgEarlyReturn: number;
    correlation: number;
  };
  retirementYear: number;
  window: number;
}

/**
 * Compute Pearson correlation coefficient between two arrays.
 * Returns 0 if fewer than 2 data points or if standard deviation is zero.
 */
export function pearsonR(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;

  return num / denom;
}

/**
 * Compute sequence-of-returns analytics from aggregated simulation results.
 *
 * For each simulation that has yearlyPortfolioReturns:
 * - Compute average portfolio return over [retirementYear, retirementYear + window - 1]
 * - Get final balance from last entry in yearlyMinBalances
 * - Compute real final balance using cumulativeInflation
 * - Determine failure from fundingFailureYear
 *
 * Summary includes averages for failed/success groups and Pearson correlation
 * between early returns and real final balance.
 */
export function computeSequenceOfReturns(
  results: AggregatedSimulationResult[],
  retirementYear: number,
  window: number,
  endYear: number,
): SequenceOfReturnsData {
  // Clamp window so it doesn't exceed simulation end year
  const effectiveWindow = Math.min(window, endYear - retirementYear + 1);
  const clampedWindow = Math.max(effectiveWindow, 1);

  const simulations: SequenceOfReturnsData['simulations'] = [];

  for (const sim of results) {
    // Skip simulations without portfolio return data
    if (!sim.yearlyPortfolioReturns || Object.keys(sim.yearlyPortfolioReturns).length === 0) {
      continue;
    }

    // Compute average early return over the window
    let returnSum = 0;
    let returnCount = 0;
    for (let y = retirementYear; y < retirementYear + clampedWindow; y++) {
      const r = sim.yearlyPortfolioReturns[y];
      if (r !== undefined) {
        returnSum += r;
        returnCount++;
      }
    }
    const avgEarlyReturn = returnCount > 0 ? returnSum / returnCount : 0;

    // Get final balance from last yearlyMinBalances entry
    const years = Object.keys(sim.yearlyMinBalances).map(Number).sort((a, b) => a - b);
    const lastYear = years[years.length - 1];
    const finalBalance = lastYear !== undefined ? sim.yearlyMinBalances[lastYear] : 0;

    // Compute real final balance using cumulative inflation
    let realFinalBalance = finalBalance;
    if (sim.cumulativeInflation && lastYear !== undefined) {
      const inflationMultiplier = sim.cumulativeInflation[lastYear];
      if (inflationMultiplier && inflationMultiplier > 0) {
        realFinalBalance = finalBalance / inflationMultiplier;
      }
    }

    // Determine failure
    const failed = sim.fundingFailureYear != null;
    const failureYear = sim.fundingFailureYear ?? null;

    simulations.push({
      simulationNumber: sim.simulationNumber,
      avgEarlyReturn,
      finalBalance,
      realFinalBalance,
      failed,
      failureYear,
    });
  }

  // Split into failed/success groups
  const failedSims = simulations.filter((s) => s.failed);
  const successSims = simulations.filter((s) => !s.failed);

  const failedAvgEarlyReturn =
    failedSims.length > 0
      ? failedSims.reduce((sum, s) => sum + s.avgEarlyReturn, 0) / failedSims.length
      : 0;

  const successAvgEarlyReturn =
    successSims.length > 0
      ? successSims.reduce((sum, s) => sum + s.avgEarlyReturn, 0) / successSims.length
      : 0;

  // Pearson correlation between avgEarlyReturn and realFinalBalance
  const earlyReturns = simulations.map((s) => s.avgEarlyReturn);
  const realBalances = simulations.map((s) => s.realFinalBalance);
  const correlation = pearsonR(earlyReturns, realBalances);

  return {
    simulations,
    summary: {
      totalSimulations: simulations.length,
      failedCount: failedSims.length,
      successCount: successSims.length,
      failedAvgEarlyReturn,
      successAvgEarlyReturn,
      correlation,
    },
    retirementYear,
    window: clampedWindow,
  };
}

/**
 * Load simulation results and compute sequence-of-returns analysis.
 * This is the file-loading wrapper called by the API handler.
 */
export async function loadAndComputeSequenceOfReturns(
  simulationId: string,
  retirementYear: number,
  window: number,
  survivingOnly: boolean = false,
): Promise<SequenceOfReturnsData> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(readFileSync(resultsPath, 'utf8'));

  let results: AggregatedSimulationResult[] = fileData.results ?? [];
  const metadata = fileData.metadata || {};

  // Determine end year from metadata
  const endDate = new Date(metadata.endDate || new Date());
  const endYear = endDate.getUTCFullYear();

  // Filter to surviving-only if requested (same pattern as statisticsGraph)
  if (survivingOnly) {
    results = results.filter((sim) => {
      if (!sim.deathDates) return true; // No death data means everyone alive
      const deathDates = sim.deathDates;
      // Check that at least one person is alive at end of simulation
      return Object.values(deathDates).some((d) => d === null);
    });
  }

  return computeSequenceOfReturns(results, retirementYear, window, endYear);
}
