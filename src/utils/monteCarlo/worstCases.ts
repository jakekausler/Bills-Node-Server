import { readFileSync } from 'fs';
import { join } from 'path';
import { MC_RESULTS_DIR } from './paths';
import { runDeterministicForWorstCases } from './statisticsGraph';

export interface WorstCasesResult {
  labels: string[];
  simulations: Array<{
    simulationNumber: number;
    finalBalance: number; // worst (minimum) balance across ALL years
    data: number[];
    realData: number[];
    failureYear: number | null;
  }>;
  deterministic: {
    data: number[];
    realData: number[];
  };
}

interface SimulationResult {
  simulationNumber: number;
  yearlyMinBalances: Record<number, number>;
  yearlyAccountBalances?: Record<number, Record<string, number>>;
  cumulativeInflation?: Record<number, number>;
  fundingFailureYear?: number | null;
}

/**
 * Compute worst-case simulations from MC results.
 * Selects the bottom N% of simulations ranked by their worst (minimum) balance across all years.
 *
 * @param simulationId - ID of the completed MC simulation
 * @param percentile - Bottom percentile to select (1-50, default 5)
 * @param accountId - Optional account ID for per-account filtering
 */
export async function computeWorstCases(
  simulationId: string,
  percentile: number = 5,
  accountId?: string,
): Promise<WorstCasesResult> {
  // Clamp percentile to [1, 50], defaulting NaN to 5
  percentile = Math.max(1, Math.min(50, isNaN(percentile) ? 5 : percentile));

  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const results: SimulationResult[] = fileData.results ?? [];
  const metadata = fileData.metadata;

  if (results.length === 0) {
    return { labels: [], simulations: [], deterministic: { data: [], realData: [] } };
  }

  // Collect all years from metadata or from results
  const allYears = new Set<number>();
  for (const sim of results) {
    for (const yearStr of Object.keys(sim.yearlyMinBalances)) {
      allYears.add(parseInt(yearStr));
    }
  }
  // Note: years derived from yearlyMinBalances; yearlyAccountBalances should always have the same years
  const sortedYears = Array.from(allYears).sort((a, b) => a - b);
  const labels = sortedYears.map((y) => y.toString());

  // Validate accountId if provided
  if (accountId) {
    const accountNames: Array<{ id: string; name: string }> = metadata?.accountNames ?? [];
    const validAccount = accountNames.some((a) => a.id === accountId);
    if (!validAccount) {
      return { labels, simulations: [], deterministic: { data: [], realData: [] } };
    }
  }

  // Helper: get balance for a year from a simulation
  const getBalance = (sim: SimulationResult, year: number): number => {
    if (accountId) {
      return sim.yearlyAccountBalances?.[year]?.[accountId] ?? 0;
    }
    return sim.yearlyMinBalances[year] ?? 0;
  };

  // For each simulation, compute worst (minimum) balance across all years
  const simsWithWorst = results.map((sim) => {
    let worstBalance = Infinity;
    for (const year of sortedYears) {
      const bal = getBalance(sim, year);
      if (bal < worstBalance) {
        worstBalance = bal;
      }
    }
    return { sim, worstBalance: worstBalance === Infinity ? 0 : worstBalance };
  });

  // Sort ascending by worst balance, take bottom N%
  simsWithWorst.sort((a, b) => a.worstBalance - b.worstBalance);
  const count = Math.max(1, Math.floor((percentile / 100) * results.length));
  const selectedSims = simsWithWorst.slice(0, count);

  // Build simulation output
  const simulations = selectedSims.map(({ sim, worstBalance }) => {
    const data: number[] = [];
    const realData: number[] = [];

    for (const year of sortedYears) {
      const bal = getBalance(sim, year);
      data.push(bal);

      // Default inflation multiplier of 1 means no adjustment (data unavailable for this year)
      const inflation = sim.cumulativeInflation?.[year] ?? 1;
      realData.push(bal / inflation);
    }

    return {
      simulationNumber: sim.simulationNumber,
      finalBalance: worstBalance,
      data,
      realData,
      failureYear: sim.fundingFailureYear ?? null,
    };
  });

  // Get deterministic data
  let deterministicData: { data: number[]; realData: number[] } = { data: [], realData: [] };
  try {
    const detResult = await runDeterministicForWorstCases(simulationId, !!accountId);
    if (detResult) {
      const detData: number[] = [];
      const detRealData: number[] = [];

      // Use median cumulative inflation from all sims for deflating deterministic values
      for (const year of sortedYears) {
        let nominalValue: number;
        if (accountId && detResult.perAccount) {
          nominalValue = detResult.perAccount[year]?.[accountId] ?? 0;
        } else {
          nominalValue = detResult.combined[year] ?? 0;
        }
        detData.push(nominalValue);

        // For deterministic real values, use median inflation across sims
        const inflationValues: number[] = [];
        for (const sim of results) {
          if (sim.cumulativeInflation?.[year]) {
            inflationValues.push(sim.cumulativeInflation[year]);
          }
        }
        let medianInflation = 1;
        if (inflationValues.length > 0) {
          inflationValues.sort((a, b) => a - b);
          const mid = Math.floor(inflationValues.length / 2);
          medianInflation =
            inflationValues.length % 2 === 1
              ? inflationValues[mid]
              : (inflationValues[mid - 1] + inflationValues[mid]) / 2;
        }
        detRealData.push(nominalValue / medianInflation);
      }

      deterministicData = { data: detData, realData: detRealData };
    }
  } catch {
    // Deterministic calculation failed, leave empty
  }

  return { labels, simulations, deterministic: deterministicData };
}
