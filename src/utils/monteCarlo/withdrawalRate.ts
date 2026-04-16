import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR, UUID_REGEX } from './paths';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';
import { getLastFlowAggregator } from '../calculate-v3/engine';
import { loadData } from '../io/accountsAndTransfers';
import { hasAnyoneSurvivingInYear, getYearWhenAllDead } from './statisticsGraph';

const FAN_PERCENTILES = [0, 5, 25, 40, 50, 60, 75, 95, 100] as const;

// Cache for deterministic withdrawal rate calculation (same pattern as statisticsGraph.ts detCache)
const detWithdrawalRateCache = new Map<string, { labels: string[]; rates: number[] }>();

export function clearDetWithdrawalRateCache(): void {
  detWithdrawalRateCache.clear();
}

export interface WithdrawalRateFanBand {
  [key: string]: number[]; // p0, p5, p25, ... each an array of values per year
}

export interface WithdrawalRateResult {
  labels: string[];                    // year strings
  nominal: WithdrawalRateFanBand;      // percentile bands of nominal withdrawal rates (0-100)
  real: WithdrawalRateFanBand;         // percentile bands of real (inflation-adjusted) rates (0-100)
  deterministic?: { labels: string[]; rates: number[] }; // deterministic baseline withdrawal rates
  summary: {
    medianInitialRate: number;         // median rate in year 1 (0-100)
    medianLifetimeAverage: number;     // median of each sim's average rate across all years (0-100)
    maxP95Rate: number;                // highest P95 rate across all years (0-100)
  };
}

interface SimFlowData {
  yearlyFlows: Record<string, YearlyFlowSummary>;
  cumulativeInflation?: Record<number, number>;
  deathDates?: Record<string, string | null>;
}

/**
 * Calculates percentile value from sorted array using linear interpolation.
 * Identical to incomeExpense.ts implementation.
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Runs a deterministic calculation (non-Monte Carlo) and extracts per-year withdrawal rates
 * from the FlowAggregator. Same pattern as statisticsGraph.ts runDeterministicCalculation.
 */
async function computeDeterministicWithdrawalRate(
  simulationId: string,
): Promise<{ labels: string[]; rates: number[] } | null> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

  try {
    const resultsData = await readFile(resultsPath, 'utf8');
    const fileData = JSON.parse(resultsData);

    if (!fileData.metadata) {
      console.warn('No metadata found in simulation file, skipping deterministic withdrawal rate');
      return null;
    }

    const startDate = new Date(fileData.metadata.startDate);
    const endDate = new Date(fileData.metadata.endDate);

    // Check cache
    const detCacheKey = `${fileData.metadata.startDate}:${fileData.metadata.endDate}:Default`;
    const cached = detWithdrawalRateCache.get(detCacheKey);
    if (cached) {
      return cached;
    }

    // Run deterministic calculation
    await loadData(
      startDate,
      endDate,
      'Default',
      {},
      {
        monteCarlo: false,
        forceRecalculation: true,
      },
    );

    // Extract flow data from the engine's FlowAggregator
    const flowAggregator = getLastFlowAggregator();
    if (!flowAggregator) {
      console.warn('No FlowAggregator available after deterministic calculation');
      return null;
    }

    const yearlyFlows = flowAggregator.getYearlyFlows();
    const sortedYears = Object.keys(yearlyFlows)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => a - b);

    const labels = sortedYears.map((y) => y.toString());
    const rates: number[] = [];

    for (const year of sortedYears) {
      const flow = yearlyFlows[year.toString()];
      const withdrawals =
        (flow.transfers.autoPulls ?? 0) +
        (flow.transfers.rmdDistributions ?? 0) -
        (flow.transfers.autoPushes ?? 0);
      const startBal = flow.startingBalance;

      let rate: number;
      if (startBal <= 0) {
        rate = withdrawals > 0 ? 100 : 0;
      } else {
        rate = (withdrawals / startBal) * 100;
      }
      rates.push(rate);
    }

    const result = { labels, rates };
    detWithdrawalRateCache.set(detCacheKey, result);
    return result;
  } catch (error) {
    console.error('Failed to compute deterministic withdrawal rate:', error);
    return null;
  }
}

/**
 * Compute net withdrawal rate fan chart data from MC results.
 *
 * Net withdrawal rate = (autoPulls + rmdDistributions - autoPushes) / startingBalance * 100
 * expressed as a percentage (0-100 scale).
 *
 * For real rates: deflate the withdrawal amount by cumulativeInflation before
 * dividing by the deflated starting balance.
 */
export async function computeWithdrawalRate(
  simulationId: string,
  survivingOnly: boolean = false,
  survivingYearsOnly: boolean = false,
): Promise<WithdrawalRateResult> {
  if (!UUID_REGEX.test(simulationId)) {
    throw new Error('Invalid simulation ID format');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(await readFile(resultsPath, 'utf8'));
  let results: SimFlowData[] = fileData.results ?? [];

  if (results.length === 0 || !results[0].yearlyFlows) {
    throw new Error('Flow data not available');
  }

  // #14: Filter to surviving simulations if requested (same logic as statisticsGraph.ts)
  if (survivingOnly) {
    // Collect all years to check
    const allYearsTemp = new Set<number>();
    for (const sim of results) {
      if (sim.yearlyFlows) {
        for (const yearStr of Object.keys(sim.yearlyFlows)) {
          allYearsTemp.add(parseInt(yearStr, 10));
        }
      }
    }
    const yearsToCheck = Array.from(allYearsTemp).sort((a, b) => a - b);

    // Keep only simulations where someone is alive in ALL years
    results = results.filter((sim) => {
      for (const year of yearsToCheck) {
        if (!hasAnyoneSurvivingInYear(sim.deathDates, year)) {
          return false;
        }
      }
      return true;
    });
  }

  // #14: Truncate per-sim flow data at the year all persons die
  if (survivingYearsOnly) {
    results = results.map((sim) => {
      const deathYear = getYearWhenAllDead(sim.deathDates);
      if (deathYear === null) return sim; // Someone survives to end, keep all data

      const truncatedFlows: Record<string, YearlyFlowSummary> = {};
      for (const [yearStr, flow] of Object.entries(sim.yearlyFlows)) {
        const y = parseInt(yearStr, 10);
        if (y <= deathYear) {
          truncatedFlows[yearStr] = flow;
        }
      }

      return { ...sim, yearlyFlows: truncatedFlows };
    });
  }

  if (results.length === 0) {
    throw new Error('No simulations remain after filtering');
  }

  // Collect all years
  const allYears = new Set<number>();
  for (const sim of results) {
    if (sim.yearlyFlows) {
      for (const yearStr of Object.keys(sim.yearlyFlows)) {
        allYears.add(parseInt(yearStr, 10));
      }
    }
  }
  const sortedYears = Array.from(allYears).sort((a, b) => a - b);
  const labels = sortedYears.map((y) => y.toString());

  // Compute nominal withdrawal rates per sim per year
  // nominalRates[simIdx][yearIdx] = rate as percentage (0-100), or undefined if no data for that year
  const nominalRates: (number | undefined)[][] = [];

  for (let simIdx = 0; simIdx < results.length; simIdx++) {
    const sim = results[simIdx];
    const simNominal: (number | undefined)[] = [];

    for (let yi = 0; yi < sortedYears.length; yi++) {
      const year = sortedYears[yi];
      const yearStr = year.toString();
      const flow = sim.yearlyFlows?.[yearStr];

      if (!flow) {
        simNominal.push(undefined);
        continue;
      }

      const withdrawals = (flow.transfers.autoPulls ?? 0) + (flow.transfers.rmdDistributions ?? 0) - (flow.transfers.autoPushes ?? 0);
      const startBal = flow.startingBalance;

      // Nominal rate
      let nomRate: number;
      if (startBal <= 0) {
        nomRate = withdrawals > 0 ? 100 : 0;
      } else {
        nomRate = (withdrawals / startBal) * 100;
      }
      simNominal.push(nomRate);
    }

    nominalRates.push(simNominal);
  }

  // Build fan bands
  const createEmptyBand = (): WithdrawalRateFanBand => {
    const band: WithdrawalRateFanBand = {};
    for (const p of FAN_PERCENTILES) band[`p${p}`] = [];
    return band;
  };

  const nominal = createEmptyBand();

  for (let yi = 0; yi < sortedYears.length; yi++) {
    // Only include sims that have data for this year (relevant when survivingYearsOnly truncates)
    const nomVals = nominalRates
      .map((r) => r[yi])
      .filter((v) => v !== undefined)
      .sort((a, b) => a - b);

    for (const p of FAN_PERCENTILES) {
      nominal[`p${p}`].push(nomVals.length > 0 ? calculatePercentile(nomVals, p) : 0);
    }
  }

  // Withdrawal rate is a ratio (withdrawals/balance), so inflation cancels out:
  // realRate = (withdrawals/inflation) / (balance/inflation) = withdrawals/balance = nominalRate.
  // We keep both nominal and real in the response for frontend consistency with other views.
  const real = nominal;

  // Summary stats
  // Median initial rate = median of all sims' first year that has data after filtering
  const firstYearRates = nominalRates
    .map((r) => r[0])
    .filter((v) => v !== undefined)
    .sort((a, b) => a - b);
  const medianInitialRate = firstYearRates.length > 0 ? calculatePercentile(firstYearRates, 50) : 0;

  // Median lifetime average = median of (each sim's average rate across its available years)
  const lifetimeAverages = nominalRates.map((simRates) => {
    const validRates = simRates.filter((v) => v !== undefined);
    if (validRates.length === 0) return 0;
    return validRates.reduce((sum, r) => sum + r, 0) / validRates.length;
  }).sort((a, b) => a - b);
  const medianLifetimeAverage = calculatePercentile(lifetimeAverages, 50);

  // Max P95 rate = highest value in the P95 band across all years
  const p95Array = nominal['p95'] ?? [];
  const maxP95Rate = p95Array.length > 0 ? Math.max(...p95Array) : 0;

  // Compute deterministic baseline
  let deterministic: { labels: string[]; rates: number[] } | undefined;
  try {
    const detResult = await computeDeterministicWithdrawalRate(simulationId);
    if (detResult) {
      deterministic = detResult;
    }
  } catch (error) {
    console.warn('Failed to compute deterministic withdrawal rate overlay:', error);
  }

  return {
    labels,
    nominal,
    real,
    deterministic,
    summary: {
      medianInitialRate,
      medianLifetimeAverage,
      maxP95Rate,
    },
  };
}
