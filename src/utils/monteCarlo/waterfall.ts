import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR, UUID_REGEX } from './paths';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';
import { getLastFlowAggregator } from '../calculate-v3/engine';
import { loadData } from '../io/accountsAndTransfers';
import { hasAnyoneSurvivingInYear, getYearWhenAllDead } from './statisticsGraph';

// Cache for waterfall computation results
const waterfallCache = new Map<string, WaterfallResult>();

// Cache for deterministic waterfall (same pattern as statisticsGraph.ts detCache)
const detWaterfallCache = new Map<string, { years: string[]; netWorth: number[]; realNetWorth: number[] }>();

export function clearDetWaterfallCache(): void {
  detWaterfallCache.clear();
}

export interface WaterfallCohort {
  label: string;
  years: string[];
  income: Record<string, number[]>;
  expenses: Record<string, number[]>;
  investmentReturns: number[];
  averageNetWorth: number[];
  realIncome: Record<string, number[]>;
  realExpenses: Record<string, number[]>;
  realInvestmentReturns: number[];
  realAverageNetWorth: number[];
}

export interface WaterfallResult {
  cohorts: WaterfallCohort[];
  deterministic?: {
    years: string[];
    netWorth: number[];
    realNetWorth: number[];
  };
}

interface SimFlowData {
  yearlyFlows: Record<string, YearlyFlowSummary>;
  cumulativeInflation?: Record<number, number>;
  deathDates?: Record<string, string | null>;
  _originalFinalBalance?: number;
}

/**
 * Flatten expense subcategories from a YearlyFlowSummary into a flat Record.
 * Produces keys like: bill category names, "Taxes", and healthcare subcategories.
 * Matches the pattern from incomeExpense.ts.
 */
function flattenExpenses(flow: YearlyFlowSummary): Record<string, number> {
  const result: Record<string, number> = {};

  // Bill categories (grouped by top-level category)
  for (const [category, amount] of Object.entries(flow.expenses.bills)) {
    if (category.toLowerCase().includes('ignore')) continue;
    if (amount !== 0) {
      result[category] = (result[category] ?? 0) + amount;
    }
  }

  // Taxes (federal + penalty combined)
  const totalTax = flow.expenses.taxes.federal + flow.expenses.taxes.penalty;
  if (totalTax !== 0) {
    result['Taxes'] = totalTax;
  }

  // Healthcare subcategories
  const hc = flow.expenses.healthcare;
  if (hc.cobra !== 0) result['COBRA'] = hc.cobra;
  if (hc.aca !== 0) result['ACA Premiums'] = hc.aca;
  if (hc.medicare !== 0) result['Medicare'] = hc.medicare;
  if (hc.hospital !== 0) result['Hospital'] = hc.hospital;
  if (hc.ltcInsurance !== 0) result['LTC Insurance'] = hc.ltcInsurance;
  if (hc.ltcCare !== 0) result['LTC Care'] = hc.ltcCare;
  if (hc.outOfPocket !== 0) result['Out of Pocket'] = hc.outOfPocket;
  // HSA reimbursements are negative (reduce cost), include if non-zero
  if (hc.hsaReimbursements !== 0) result['HSA Reimbursements'] = hc.hsaReimbursements;

  return result;
}

/**
 * Compute deterministic waterfall overlay (non-Monte Carlo).
 * Returns net worth per year and real (inflation-adjusted) variants.
 */
async function computeDeterministicWaterfall(
  simulationId: string,
  fileData?: { metadata?: { startDate: string; endDate: string }; results?: SimFlowData[] },
): Promise<{ years: string[]; netWorth: number[]; realNetWorth: number[] } | null> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

  try {
    // Use provided fileData or read from disk
    let data = fileData;
    if (!data) {
      const resultsData = await readFile(resultsPath, 'utf8');
      data = JSON.parse(resultsData);
    }

    if (!data?.metadata) {
      console.warn('No metadata found in simulation file, skipping deterministic waterfall');
      return null;
    }

    const startDate = new Date(data.metadata.startDate);
    const endDate = new Date(data.metadata.endDate);

    // Check cache
    const detCacheKey = `${data.metadata.startDate}:${data.metadata.endDate}:Default`;
    const cached = detWaterfallCache.get(detCacheKey);
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
    const netWorth: number[] = [];
    const realNetWorth: number[] = [];

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
      netWorth.push(flow.endingBalance);
      const inflation = medianInflationByYear.get(year) ?? 1.0;
      realNetWorth.push(flow.endingBalance / inflation);
    }

    const result = { years, netWorth, realNetWorth };
    detWaterfallCache.set(detCacheKey, result);
    return result;
  } catch (error) {
    console.error('Failed to compute deterministic waterfall:', error);
    return null;
  }
}

/**
 * Compute net worth waterfall using cohort averaging.
 * Ranks simulations by final balance and splits into 5 quintile cohorts.
 * For each cohort, averages category values per year.
 *
 * @param simulationId - ID of the completed MC simulation
 * @param survivingOnly - If true, only include simulations where at least one person survives each year
 * @param survivingYearsOnly - If true, truncate per-sim data at the year all persons die
 */
export async function computeWaterfall(
  simulationId: string,
  survivingOnly: boolean = false,
  survivingYearsOnly: boolean = false,
): Promise<WaterfallResult> {
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
  const cohorts: WaterfallCohort[] = [];

  for (let q = 0; q < quintiles.length; q++) {
    const cohortSims = quintiles[q];
    const label = cohortLabels[q];

    // Collect all income sources and expense categories for this cohort
    const incomeSourcesSet = new Set<string>();
    const expenseCategoriesSet = new Set<string>();

    for (const { sim } of cohortSims) {
      for (const yearStr of Object.keys(sim.yearlyFlows)) {
        const flow = sim.yearlyFlows[yearStr];
        for (const source of Object.keys(flow.income)) {
          incomeSourcesSet.add(source);
        }
        const expenses = flattenExpenses(flow);
        for (const cat of Object.keys(expenses)) {
          expenseCategoriesSet.add(cat);
        }
      }
    }

    const incomeSources = Array.from(incomeSourcesSet).filter(source => !source.toLowerCase().includes('ignore'));
    const expenseCategories = Array.from(expenseCategoriesSet).filter(cat => !cat.toLowerCase().includes('ignore'));

    // Initialize per-year arrays
    const income: Record<string, number[]> = {};
    const expenses: Record<string, number[]> = {};
    const investmentReturns: number[] = [];
    const averageNetWorth: number[] = [];
    const realIncome: Record<string, number[]> = {};
    const realExpenses: Record<string, number[]> = {};
    const realInvestmentReturns: number[] = [];
    const realAverageNetWorth: number[] = [];

    for (const source of incomeSources) {
      income[source] = [];
      realIncome[source] = [];
    }
    for (const cat of expenseCategories) {
      expenses[cat] = [];
      realExpenses[cat] = [];
    }

    // Compute averages per year
    for (const year of sortedYears) {
      const yearStr = year.toString();

      // Income: average for each source (grouped by top-level category)
      for (const source of incomeSources) {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.income[source] ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        income[source].push(avg);
      }

      // Expenses: pre-compute flattened expenses for each sim at this year
      const flattenedExpenses = cohortSims.map(({ sim }) => {
        const flow = sim.yearlyFlows?.[yearStr];
        return flow ? flattenExpenses(flow) : null;
      });

      // Expenses: average for each category
      for (const cat of expenseCategories) {
        const values: number[] = [];
        for (let si = 0; si < cohortSims.length; si++) {
          const flat = flattenedExpenses[si];
          if (flat) {
            values.push(flat[cat] ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        expenses[cat].push(avg);
      }

      // Investment returns: average totalInterestEarned
      {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.totalInterestEarned ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        investmentReturns.push(avg);
      }

      // Net worth: average endingBalance
      {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.endingBalance ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        averageNetWorth.push(avg);
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
      for (const source of incomeSources) {
        realIncome[source].push(income[source][income[source].length - 1] / medianInflation);
      }
      for (const cat of expenseCategories) {
        realExpenses[cat].push(expenses[cat][expenses[cat].length - 1] / medianInflation);
      }
      realInvestmentReturns.push(investmentReturns[investmentReturns.length - 1] / medianInflation);
      realAverageNetWorth.push(averageNetWorth[averageNetWorth.length - 1] / medianInflation);
    }

    // Filter out zero-value categories
    const filterZeros = (record: Record<string, number[]>): Record<string, number[]> => {
      const result: Record<string, number[]> = {};
      for (const [key, values] of Object.entries(record)) {
        if (values.some((v) => v !== 0)) {
          result[key] = values;
        }
      }
      return result;
    };

    cohorts.push({
      label,
      years: yearStrings,
      income: filterZeros(income),
      expenses: filterZeros(expenses),
      investmentReturns,
      averageNetWorth,
      realIncome: filterZeros(realIncome),
      realExpenses: filterZeros(realExpenses),
      realInvestmentReturns,
      realAverageNetWorth,
    });
  }

  // Compute deterministic overlay
  let deterministic: { years: string[]; netWorth: number[]; realNetWorth: number[] } | undefined;
  try {
    const detResult = await computeDeterministicWaterfall(simulationId, fileData);
    if (detResult) {
      deterministic = detResult;
    }
  } catch (error) {
    console.warn('Failed to compute deterministic waterfall overlay:', error);
  }

  return {
    cohorts,
    deterministic,
  };
}
