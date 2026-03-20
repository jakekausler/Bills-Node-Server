import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR } from './paths';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FAN_PERCENTILES = [0, 5, 25, 40, 50, 60, 75, 95, 100] as const;

export interface IncomeExpenseResult {
  labels: string[];
  breakdown: {
    income: Record<string, number[]>;
    expenses: Record<string, number[]>;
  };
  incomeFan: Record<string, number[]>;
  expenseFan: Record<string, number[]>;
  summary: {
    medianNetCashFlow: number[];
    p5NetCashFlow: number[];
    p95NetCashFlow: number[];
    cumulativeNetCashFlow: { median: number; p5: number; p95: number };
  };
  realBreakdown: {
    income: Record<string, number[]>;
    expenses: Record<string, number[]>;
  };
  realIncomeFan: Record<string, number[]>;
  realExpenseFan: Record<string, number[]>;
  realSummary: {
    medianNetCashFlow: number[];
    p5NetCashFlow: number[];
    p95NetCashFlow: number[];
    cumulativeNetCashFlow: { median: number; p5: number; p95: number };
  };
}

interface SimFlowData {
  yearlyFlows: Record<string, YearlyFlowSummary>;
  cumulativeInflation?: Record<number, number>;
}

/**
 * Calculates percentile value from sorted array using linear interpolation.
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Flatten expense subcategories from a YearlyFlowSummary into a flat Record.
 * Produces keys like: bill category names, "Taxes", and healthcare subcategories.
 */
function flattenExpenses(flow: YearlyFlowSummary): Record<string, number> {
  const result: Record<string, number> = {};

  // Bill categories
  for (const [category, amount] of Object.entries(flow.expenses.bills)) {
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
 * Compute income/expense breakdown, fan charts, and summary from MC results.
 *
 * @param simulationId - ID of the completed MC simulation
 * @param percentile - Which percentile for the breakdown chart (default 50)
 */
export async function computeIncomeExpense(
  simulationId: string,
  percentile: number = 50,
): Promise<IncomeExpenseResult> {
  if (!UUID_REGEX.test(simulationId)) {
    throw new Error('Invalid simulation ID format');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(await readFile(resultsPath, 'utf8'));
  const results: SimFlowData[] = fileData.results ?? [];

  // Validate that yearlyFlows exists in at least the first result
  if (results.length === 0 || !results[0].yearlyFlows) {
    throw new Error('Flow data not available');
  }

  // Collect all years
  const allYears = new Set<number>();
  for (const sim of results) {
    if (sim.yearlyFlows) {
      for (const yearStr of Object.keys(sim.yearlyFlows)) {
        allYears.add(parseInt(yearStr));
      }
    }
  }
  const sortedYears = Array.from(allYears).sort((a, b) => a - b);
  const labels = sortedYears.map((y) => y.toString());

  // Collect all income source names and expense category names across all sims/years
  const allIncomeSources = new Set<string>();
  const allExpenseCategories = new Set<string>();

  for (const sim of results) {
    if (!sim.yearlyFlows) continue;
    for (const yearStr of Object.keys(sim.yearlyFlows)) {
      const flow = sim.yearlyFlows[yearStr];
      for (const source of Object.keys(flow.income)) {
        allIncomeSources.add(source);
      }
      const expenses = flattenExpenses(flow);
      for (const cat of Object.keys(expenses)) {
        allExpenseCategories.add(cat);
      }
    }
  }

  // Helper: get median cumulative inflation for a year
  const getMedianInflation = (year: number): number => {
    const values: number[] = [];
    for (const sim of results) {
      const inf = sim.cumulativeInflation?.[year];
      if (inf !== undefined) values.push(inf);
    }
    if (values.length === 0) return 1.0;
    values.sort((a, b) => a - b);
    return calculatePercentile(values, 50);
  };

  // --- Breakdown ---
  const breakdown: { income: Record<string, number[]>; expenses: Record<string, number[]> } = {
    income: {},
    expenses: {},
  };

  for (const source of allIncomeSources) {
    breakdown.income[source] = [];
  }
  for (const cat of allExpenseCategories) {
    breakdown.expenses[cat] = [];
  }

  for (const year of sortedYears) {
    const yearStr = year.toString();

    // Income breakdown at requested percentile
    for (const source of allIncomeSources) {
      const values: number[] = [];
      for (const sim of results) {
        const flow = sim.yearlyFlows?.[yearStr];
        values.push(flow?.income[source] ?? 0);
      }
      values.sort((a, b) => a - b);
      breakdown.income[source].push(calculatePercentile(values, percentile));
    }

    // Expense breakdown at requested percentile
    for (const cat of allExpenseCategories) {
      const values: number[] = [];
      for (const sim of results) {
        const flow = sim.yearlyFlows?.[yearStr];
        const expenses = flow ? flattenExpenses(flow) : {};
        values.push(expenses[cat] ?? 0);
      }
      values.sort((a, b) => a - b);
      breakdown.expenses[cat].push(calculatePercentile(values, percentile));
    }
  }

  // --- Fan charts ---
  const incomeFan: Record<string, number[]> = {};
  const expenseFan: Record<string, number[]> = {};
  for (const p of FAN_PERCENTILES) {
    incomeFan[`p${p}`] = [];
    expenseFan[`p${p}`] = [];
  }

  for (const year of sortedYears) {
    const yearStr = year.toString();
    const incomeValues: number[] = [];
    const expenseValues: number[] = [];

    for (const sim of results) {
      const flow = sim.yearlyFlows?.[yearStr];
      incomeValues.push(flow?.totalIncome ?? 0);
      expenseValues.push(flow?.totalExpenses ?? 0);
    }

    incomeValues.sort((a, b) => a - b);
    expenseValues.sort((a, b) => a - b);

    for (const p of FAN_PERCENTILES) {
      incomeFan[`p${p}`].push(calculatePercentile(incomeValues, p));
      expenseFan[`p${p}`].push(calculatePercentile(expenseValues, p));
    }
  }

  // --- Summary ---
  const medianNetCashFlow: number[] = [];
  const p5NetCashFlow: number[] = [];
  const p95NetCashFlow: number[] = [];

  for (const year of sortedYears) {
    const yearStr = year.toString();
    const netValues: number[] = [];

    for (const sim of results) {
      const flow = sim.yearlyFlows?.[yearStr];
      netValues.push((flow?.totalIncome ?? 0) - (flow?.totalExpenses ?? 0));
    }

    netValues.sort((a, b) => a - b);
    medianNetCashFlow.push(calculatePercentile(netValues, 50));
    p5NetCashFlow.push(calculatePercentile(netValues, 5));
    p95NetCashFlow.push(calculatePercentile(netValues, 95));
  }

  // Cumulative net cash flow for final year
  const cumulativeNetValues: number[] = [];
  for (const sim of results) {
    let cumulative = 0;
    for (const year of sortedYears) {
      const yearStr = year.toString();
      const flow = sim.yearlyFlows?.[yearStr];
      cumulative += (flow?.totalIncome ?? 0) - (flow?.totalExpenses ?? 0);
    }
    cumulativeNetValues.push(cumulative);
  }
  cumulativeNetValues.sort((a, b) => a - b);

  const summary = {
    medianNetCashFlow,
    p5NetCashFlow,
    p95NetCashFlow,
    cumulativeNetCashFlow: {
      median: calculatePercentile(cumulativeNetValues, 50),
      p5: calculatePercentile(cumulativeNetValues, 5),
      p95: calculatePercentile(cumulativeNetValues, 95),
    },
  };

  // --- Real (inflation-adjusted) variants ---
  const deflate = (values: number[], yearIndex: number): number => {
    const inflation = getMedianInflation(sortedYears[yearIndex]);
    return values[yearIndex] / inflation;
  };

  const deflateArray = (arr: number[]): number[] =>
    arr.map((_, i) => {
      const inflation = getMedianInflation(sortedYears[i]);
      return arr[i] / inflation;
    });

  const deflateRecord = (record: Record<string, number[]>): Record<string, number[]> => {
    const result: Record<string, number[]> = {};
    for (const [key, values] of Object.entries(record)) {
      result[key] = deflateArray(values);
    }
    return result;
  };

  const realBreakdown = {
    income: deflateRecord(breakdown.income),
    expenses: deflateRecord(breakdown.expenses),
  };

  const realIncomeFan = deflateRecord(incomeFan);
  const realExpenseFan = deflateRecord(expenseFan);

  // Real cumulative net cash flow
  const realCumulativeNetValues: number[] = [];
  for (const sim of results) {
    let cumulative = 0;
    for (let i = 0; i < sortedYears.length; i++) {
      const yearStr = sortedYears[i].toString();
      const flow = sim.yearlyFlows?.[yearStr];
      const nominal = (flow?.totalIncome ?? 0) - (flow?.totalExpenses ?? 0);
      const inflation = getMedianInflation(sortedYears[i]);
      cumulative += nominal / inflation;
    }
    realCumulativeNetValues.push(cumulative);
  }
  realCumulativeNetValues.sort((a, b) => a - b);

  const realSummary = {
    medianNetCashFlow: deflateArray(medianNetCashFlow),
    p5NetCashFlow: deflateArray(p5NetCashFlow),
    p95NetCashFlow: deflateArray(p95NetCashFlow),
    cumulativeNetCashFlow: {
      median: calculatePercentile(realCumulativeNetValues, 50),
      p5: calculatePercentile(realCumulativeNetValues, 5),
      p95: calculatePercentile(realCumulativeNetValues, 95),
    },
  };

  return {
    labels,
    breakdown,
    incomeFan,
    expenseFan,
    summary,
    realBreakdown,
    realIncomeFan,
    realExpenseFan,
    realSummary,
  };
}
