import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR, UUID_REGEX } from './paths';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';
import { getLastFlowAggregator } from '../calculate-v3/engine';
import { loadData } from '../io/accountsAndTransfers';
import { hasAnyoneSurvivingInYear, getYearWhenAllDead } from './statisticsGraph';

// Cache for tax burden computation results
const taxBurdenCache = new Map<string, TaxBurdenResult>();

// Cache for deterministic tax burden
const detTaxBurdenCache = new Map<string, { years: string[]; totalTax: number[]; effectiveRate: number[]; realTotalTax: number[] }>();

export function clearDetTaxBurdenCache(): void {
  detTaxBurdenCache.clear();
}

export interface TaxBurdenCohort {
  label: string;
  years: string[];
  taxes: {
    federalIncome: number[];
    stateIncome: number[];
    capitalGains: number[];
    niit: number[];
    fica: number[];
    additionalMedicare: number[];
    penalty: number[];
  };
  effectiveRate: number[]; // (totalTax / totalIncome) * 100 per year
  totalIncome: number[]; // for effective rate calculation
  rothConversions: number[];

  // Real (inflation-adjusted) variants
  realTaxes: {
    federalIncome: number[];
    stateIncome: number[];
    capitalGains: number[];
    niit: number[];
    fica: number[];
    additionalMedicare: number[];
    penalty: number[];
  };
  realTotalIncome: number[];
  realRothConversions: number[];

  // Summary stats (using MEDIAN across years for cohort's average timeseries)
  medianEffectiveRate: number; // Median of effectiveRate array
  peakTaxYear: { year: string; amount: number };
  lifetimeTaxTotal: number;
  lifetimeRothConverted: number;
}

export interface TaxBurdenResult {
  cohorts: TaxBurdenCohort[];
  deterministic?: {
    years: string[];
    totalTax: number[];
    effectiveRate: number[];
    realTotalTax: number[];
  };
}

interface SimFlowData {
  yearlyFlows: Record<string, YearlyFlowSummary>;
  cumulativeInflation?: Record<number, number>;
  deathDates?: Record<string, string | null>;
  _originalFinalBalance?: number;
}

/**
 * Compute deterministic tax burden overlay (non-Monte Carlo).
 * Returns total tax, effective rate, and real variants per year.
 */
async function computeDeterministicTaxBurden(
  simulationId: string,
  fileData?: { metadata?: { startDate: string; endDate: string }; results?: SimFlowData[] },
): Promise<{ years: string[]; totalTax: number[]; effectiveRate: number[]; realTotalTax: number[] } | null> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

  try {
    // Use provided fileData or read from disk
    let data = fileData;
    if (!data) {
      const resultsData = await readFile(resultsPath, 'utf8');
      data = JSON.parse(resultsData);
    }

    if (!data?.metadata) {
      console.warn('No metadata found in simulation file, skipping deterministic tax burden');
      return null;
    }

    const startDate = new Date(data.metadata.startDate);
    const endDate = new Date(data.metadata.endDate);

    // Check cache
    const detCacheKey = `${data.metadata.startDate}:${data.metadata.endDate}:Default`;
    const cached = detTaxBurdenCache.get(detCacheKey);
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

    const years = sortedYears.map((y) => y.toString());
    const totalTax: number[] = [];
    const effectiveRate: number[] = [];
    const realTotalTax: number[] = [];

    // Compute median inflation from MC results for real values
    const mcResults: SimFlowData[] = data.results ?? [];

    const medianInflationByYear = new Map<number, number>();
    for (const year of sortedYears) {
      const values: number[] = [];
      for (const sim of mcResults) {
        const inf = sim.cumulativeInflation?.[year];
        if (inf !== undefined) values.push(inf);
      }
      if (values.length === 0) {
        medianInflationByYear.set(year, 1.0);
      } else {
        values.sort((a, b) => a - b);
        const medianIdx = Math.floor(values.length / 2);
        medianInflationByYear.set(year, values[medianIdx]);
      }
    }

    for (const year of sortedYears) {
      const flow = yearlyFlows[year.toString()];
      const t = flow.expenses.taxes;
      const yearTax = t.federalIncome + t.stateIncome + t.capitalGains + t.niit
        + t.fica + t.additionalMedicare + t.penalty;
      const yearIncome = Object.values(flow.income).reduce((sum, v) => sum + v, 0);

      totalTax.push(yearTax);
      effectiveRate.push(yearIncome > 0 ? (yearTax / yearIncome) * 100 : 0);

      const inflation = medianInflationByYear.get(year) ?? 1.0;
      realTotalTax.push(yearTax / inflation);
    }

    const result = { years, totalTax, effectiveRate, realTotalTax };
    detTaxBurdenCache.set(detCacheKey, result);
    return result;
  } catch (error) {
    console.error('Failed to compute deterministic tax burden:', error);
    return null;
  }
}

/**
 * Compute tax burden using cohort averaging.
 * Ranks simulations by final balance and splits into 5 quintile cohorts.
 * For each cohort, averages tax sub-categories per year.
 *
 * @param simulationId - ID of the completed MC simulation
 * @param survivingOnly - If true, only include simulations where at least one person survives each year
 * @param survivingYearsOnly - If true, truncate per-sim data at the year all persons die
 */
export async function computeTaxBurden(
  simulationId: string,
  survivingOnly: boolean = false,
  survivingYearsOnly: boolean = false,
): Promise<TaxBurdenResult> {
  if (!UUID_REGEX.test(simulationId)) {
    throw new Error('Invalid simulation ID format');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(await readFile(resultsPath, 'utf8'));
  let results: SimFlowData[] = fileData.results ?? [];

  if (results.length === 0 || !results[0].yearlyFlows) {
    throw new Error('Flow data not available');
  }

  // Filter to surviving simulations if requested
  if (survivingOnly) {
    const allYearsTemp = new Set<number>();
    for (const sim of results) {
      if (sim.yearlyFlows) {
        for (const yearStr of Object.keys(sim.yearlyFlows)) {
          allYearsTemp.add(parseInt(yearStr, 10));
        }
      }
    }
    const yearsToCheck = Array.from(allYearsTemp).sort((a, b) => a - b);

    results = results.filter((sim) => {
      for (const year of yearsToCheck) {
        if (!hasAnyoneSurvivingInYear(sim.deathDates, year)) {
          return false;
        }
      }
      return true;
    });
  }

  // Truncate per-sim flow data at the year all persons die
  if (survivingYearsOnly) {
    results = results.map((sim) => {
      const deathYear = getYearWhenAllDead(sim.deathDates);
      if (deathYear === null) return sim;

      // Preserve original final balance before truncating
      const lastYear = Math.max(...Object.keys(sim.yearlyFlows).map((y) => parseInt(y, 10)));
      const originalFinalBalance = sim.yearlyFlows[lastYear.toString()]?.endingBalance ?? 0;

      const truncatedFlows: Record<string, YearlyFlowSummary> = {};
      for (const [yearStr, flow] of Object.entries(sim.yearlyFlows)) {
        const y = parseInt(yearStr, 10);
        if (y <= deathYear) {
          truncatedFlows[yearStr] = flow;
        }
      }

      return { ...sim, yearlyFlows: truncatedFlows, _originalFinalBalance: originalFinalBalance };
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
  const yearStrings = sortedYears.map((y) => y.toString());

  // Rank simulations by final balance (endingBalance in last year)
  const simsWithFinalBalance = results.map((sim, index) => {
    const lastYear = Math.max(...Object.keys(sim.yearlyFlows).map((y) => parseInt(y, 10)));
    const finalBalance = sim._originalFinalBalance ?? sim.yearlyFlows[lastYear.toString()]?.endingBalance ?? 0;
    return { index, finalBalance, sim };
  });

  simsWithFinalBalance.sort((a, b) => a.finalBalance - b.finalBalance);

  // Split into 5 quintiles
  const quintileSize = Math.ceil(results.length / 5);
  const quintiles = [
    simsWithFinalBalance.slice(0, quintileSize), // <P20
    simsWithFinalBalance.slice(quintileSize, quintileSize * 2), // P20-P40
    simsWithFinalBalance.slice(quintileSize * 2, quintileSize * 3), // P40-P60
    simsWithFinalBalance.slice(quintileSize * 3, quintileSize * 4), // P60-P80
    simsWithFinalBalance.slice(quintileSize * 4), // >P80
  ];

  const cohortLabels = ['<P20', 'P20-P40', 'P40-P60', 'P60-P80', '>P80'];

  // Compute per-cohort averages
  const cohorts: TaxBurdenCohort[] = [];

  for (let q = 0; q < quintiles.length; q++) {
    const cohortSims = quintiles[q];
    const label = cohortLabels[q];

    // Initialize per-year arrays for each tax category
    const taxCategories = [
      'federalIncome',
      'stateIncome',
      'capitalGains',
      'niit',
      'fica',
      'additionalMedicare',
      'penalty',
    ] as const;

    const taxes: Record<string, number[]> = {};
    const realTaxes: Record<string, number[]> = {};
    const effectiveRate: number[] = [];
    const totalIncome: number[] = [];
    const rothConversions: number[] = [];
    const realTotalIncome: number[] = [];
    const realRothConversions: number[] = [];

    for (const cat of taxCategories) {
      taxes[cat] = [];
      realTaxes[cat] = [];
    }

    // Compute averages per year
    for (const year of sortedYears) {
      const yearStr = year.toString();

      // Tax categories: average for each
      for (const cat of taxCategories) {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.expenses.taxes[cat as keyof typeof flow.expenses.taxes] ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        taxes[cat].push(avg);
      }

      // Total income: sum all income sources
      {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            const income = Object.values(flow.income).reduce((sum, v) => sum + v, 0);
            values.push(income);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        totalIncome.push(avg);
      }

      // Effective rate: (sum of all taxes) / totalIncome * 100
      {
        let sumTaxes = 0;
        for (const cat of taxCategories) {
          sumTaxes += taxes[cat][taxes[cat].length - 1];
        }
        const rate = totalIncome[totalIncome.length - 1] > 0
          ? (sumTaxes / totalIncome[totalIncome.length - 1]) * 100
          : 0;
        effectiveRate.push(rate);
      }

      // Roth conversions: average from transfers
      {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.transfers.rothConversions ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        rothConversions.push(avg);
      }

      // Median cumulative inflation for this cohort/year
      const inflationValues: number[] = [];
      for (const { sim } of cohortSims) {
        const inf = sim.cumulativeInflation?.[year];
        if (inf !== undefined) {
          inflationValues.push(inf);
        }
      }
      let medianInflation = 1.0;
      if (inflationValues.length > 0) {
        inflationValues.sort((a, b) => a - b);
        const medianIdx = Math.floor(inflationValues.length / 2);
        medianInflation = inflationValues[medianIdx];
      }

      // Real values: divide by median inflation
      for (const cat of taxCategories) {
        realTaxes[cat].push(taxes[cat][taxes[cat].length - 1] / medianInflation);
      }
      realTotalIncome.push(totalIncome[totalIncome.length - 1] / medianInflation);
      realRothConversions.push(rothConversions[rothConversions.length - 1] / medianInflation);
    }

    // Compute summary stats
    const medianEffectiveRateValue = effectiveRate.length > 0
      ? (() => {
          const sorted = [...effectiveRate].sort((a, b) => a - b);
          const midIdx = Math.floor(sorted.length / 2);
          return sorted[midIdx];
        })()
      : 0;

    // Compute total tax per year ONCE, then find the argmax in a single pass
    const totalTaxByYear: number[] = sortedYears.map((_, idx) => {
      let total = 0;
      for (const cat of taxCategories) {
        total += taxes[cat][idx];
      }
      return total;
    });

    let peakTaxYearIndex = -1;
    let peakTaxAmount = 0;
    for (let i = 0; i < totalTaxByYear.length; i++) {
      if (totalTaxByYear[i] > peakTaxAmount) {
        peakTaxAmount = totalTaxByYear[i];
        peakTaxYearIndex = i;
      }
    }

    const lifetimeTaxTotal = taxCategories.reduce((sum, cat) => {
      return sum + taxes[cat].reduce((s, v) => s + v, 0);
    }, 0);

    const lifetimeRothConverted = rothConversions.reduce((sum, v) => sum + v, 0);

    const peakTaxYear = peakTaxYearIndex >= 0
      ? { year: yearStrings[peakTaxYearIndex], amount: peakTaxAmount }
      : { year: '', amount: 0 };

    cohorts.push({
      label,
      years: yearStrings,
      taxes: {
        federalIncome: taxes.federalIncome,
        stateIncome: taxes.stateIncome,
        capitalGains: taxes.capitalGains,
        niit: taxes.niit,
        fica: taxes.fica,
        additionalMedicare: taxes.additionalMedicare,
        penalty: taxes.penalty,
      },
      effectiveRate,
      totalIncome,
      rothConversions,
      realTaxes: {
        federalIncome: realTaxes.federalIncome,
        stateIncome: realTaxes.stateIncome,
        capitalGains: realTaxes.capitalGains,
        niit: realTaxes.niit,
        fica: realTaxes.fica,
        additionalMedicare: realTaxes.additionalMedicare,
        penalty: realTaxes.penalty,
      },
      realTotalIncome,
      realRothConversions,
      medianEffectiveRate: medianEffectiveRateValue,
      peakTaxYear,
      lifetimeTaxTotal,
      lifetimeRothConverted,
    });
  }

  // Compute deterministic overlay
  let deterministic: { years: string[]; totalTax: number[]; effectiveRate: number[]; realTotalTax: number[] } | undefined;
  try {
    const detResult = await computeDeterministicTaxBurden(simulationId, fileData);
    if (detResult) {
      deterministic = detResult;
    }
  } catch (error) {
    console.warn('Failed to compute deterministic tax burden overlay:', error);
  }

  return {
    cohorts,
    deterministic,
  };
}
