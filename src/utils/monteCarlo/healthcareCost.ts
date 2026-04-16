import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR, UUID_REGEX } from './paths';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';
import { getLastFlowAggregator } from '../calculate-v3/engine';
import { loadData } from '../io/accountsAndTransfers';
import { hasAnyoneSurvivingInYear, getYearWhenAllDead } from './statisticsGraph';

// Cache for healthcare cost computation results
const healthcareCostCache = new Map<string, HealthcareCostResult>();

// Cache for deterministic healthcare cost
const detHealthcareCostCache = new Map<string, { years: string[]; totalHealthcare: number[]; percentOfExpenses: number[]; realTotalHealthcare: number[] }>();

export function clearDetHealthcareCostCache(): void {
  detHealthcareCostCache.clear();
}

export interface HealthcareCostCohort {
  label: string;
  years: string[];
  healthcare: {
    cobra: number[];
    aca: number[];
    medicare: number[];
    hospital: number[];
    ltcInsurance: number[];
    ltcCare: number[];
    outOfPocket: number[];
    hsaReimbursements: number[]; // NEGATIVE (reduces cost)
  };
  totalHealthcare: number[]; // Sum of 7 (HSA subtracts)
  totalExpenses: number[]; // For % calculation
  percentOfExpenses: number[]; // totalHealthcare / totalExpenses * 100

  // Real variants
  realHealthcare: {
    cobra: number[];
    aca: number[];
    medicare: number[];
    hospital: number[];
    ltcInsurance: number[];
    ltcCare: number[];
    outOfPocket: number[];
    hsaReimbursements: number[];
  };
  realTotalHealthcare: number[];
  realTotalExpenses: number[];

  // Summary stats (MEDIAN across years)
  medianAnnualCost: number; // Median of totalHealthcare
  peakHealthcareYear: { year: string; amount: number };
  lifetimeHealthcareTotal: number;
  lifetimePercentOfExpenses: number; // lifetime healthcare / lifetime total expenses
}

export interface HealthcareCostResult {
  cohorts: HealthcareCostCohort[];
  deterministic?: {
    years: string[];
    totalHealthcare: number[];
    percentOfExpenses: number[];
    realTotalHealthcare: number[];
  };
}

interface SimFlowData {
  yearlyFlows: Record<string, YearlyFlowSummary>;
  cumulativeInflation?: Record<number, number>;
  deathDates?: Record<string, string | null>;
  _originalFinalBalance?: number;
}

/**
 * Compute deterministic healthcare cost overlay (non-Monte Carlo).
 * Returns total healthcare, percent of expenses, and real variants per year.
 */
async function computeDeterministicHealthcareCost(
  simulationId: string,
  fileData?: { metadata?: { startDate: string; endDate: string }; results?: SimFlowData[] },
): Promise<{ years: string[]; totalHealthcare: number[]; percentOfExpenses: number[]; realTotalHealthcare: number[] } | null> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

  try {
    // Use provided fileData or read from disk
    let data = fileData;
    if (!data) {
      const resultsData = await readFile(resultsPath, 'utf8');
      data = JSON.parse(resultsData);
    }

    if (!data?.metadata) {
      console.warn('No metadata found in simulation file, skipping deterministic healthcare cost');
      return null;
    }

    const startDate = new Date(data.metadata.startDate);
    const endDate = new Date(data.metadata.endDate);

    // Check cache
    const detCacheKey = `${data.metadata.startDate}:${data.metadata.endDate}:Default`;
    const cached = detHealthcareCostCache.get(detCacheKey);
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
    const totalHealthcare: number[] = [];
    const percentOfExpenses: number[] = [];
    const realTotalHealthcare: number[] = [];

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
      const hc = flow.expenses.healthcare;
      const yearHealthcare = hc.cobra + hc.aca + hc.medicare + hc.hospital
        + hc.ltcInsurance + hc.ltcCare + hc.outOfPocket - Math.abs(hc.hsaReimbursements);
      const yearTotal = flow.totalExpenses;

      totalHealthcare.push(yearHealthcare);
      percentOfExpenses.push(yearTotal > 0 ? (yearHealthcare / yearTotal) * 100 : 0);

      const inflation = medianInflationByYear.get(year) ?? 1.0;
      realTotalHealthcare.push(yearHealthcare / inflation);
    }

    const result = { years, totalHealthcare, percentOfExpenses, realTotalHealthcare };
    detHealthcareCostCache.set(detCacheKey, result);
    return result;
  } catch (error) {
    console.error('Failed to compute deterministic healthcare cost:', error);
    return null;
  }
}

/**
 * Compute healthcare cost using cohort averaging.
 * Ranks simulations by final balance and splits into 5 quintile cohorts.
 * For each cohort, averages healthcare sub-categories per year.
 *
 * @param simulationId - ID of the completed MC simulation
 * @param survivingOnly - If true, only include simulations where at least one person survives each year
 * @param survivingYearsOnly - If true, truncate per-sim data at the year all persons die
 */
export async function computeHealthcareCost(
  simulationId: string,
  survivingOnly: boolean = false,
  survivingYearsOnly: boolean = false,
): Promise<HealthcareCostResult> {
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
  const cohorts: HealthcareCostCohort[] = [];

  for (let q = 0; q < quintiles.length; q++) {
    const cohortSims = quintiles[q];
    const label = cohortLabels[q];

    // Initialize per-year arrays for each healthcare category
    const healthcareCategories = [
      'cobra',
      'aca',
      'medicare',
      'hospital',
      'ltcInsurance',
      'ltcCare',
      'outOfPocket',
      'hsaReimbursements',
    ] as const;

    const healthcare: Record<string, number[]> = {};
    const realHealthcare: Record<string, number[]> = {};
    const totalHealthcare: number[] = [];
    const totalExpenses: number[] = [];
    const percentOfExpenses: number[] = [];
    const realTotalHealthcare: number[] = [];
    const realTotalExpenses: number[] = [];

    for (const cat of healthcareCategories) {
      healthcare[cat] = [];
      realHealthcare[cat] = [];
    }

    // Compute averages per year
    for (const year of sortedYears) {
      const yearStr = year.toString();

      // Healthcare categories: average for each
      for (const cat of healthcareCategories) {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.expenses.healthcare[cat as keyof typeof flow.expenses.healthcare] ?? 0);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        healthcare[cat].push(avg);
      }

      // Total healthcare: sum of all 8 categories (HSA is negative, so subtracts)
      {
        let sum = 0;
        for (const cat of healthcareCategories) {
          sum += healthcare[cat][healthcare[cat].length - 1];
        }
        totalHealthcare.push(sum);
      }

      // Total expenses
      {
        const values: number[] = [];
        for (const { sim } of cohortSims) {
          const flow = sim.yearlyFlows?.[yearStr];
          if (flow) {
            values.push(flow.totalExpenses);
          }
        }
        const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
        totalExpenses.push(avg);
      }

      // Percent of expenses
      {
        const rate = totalExpenses[totalExpenses.length - 1] > 0
          ? (totalHealthcare[totalHealthcare.length - 1] / totalExpenses[totalExpenses.length - 1]) * 100
          : 0;
        percentOfExpenses.push(rate);
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
      for (const cat of healthcareCategories) {
        realHealthcare[cat].push(healthcare[cat][healthcare[cat].length - 1] / medianInflation);
      }
      realTotalHealthcare.push(totalHealthcare[totalHealthcare.length - 1] / medianInflation);
      realTotalExpenses.push(totalExpenses[totalExpenses.length - 1] / medianInflation);
    }

    // Clip per-year total to >= 0 before computing summary stats, so HSA
    // reimbursements exceeding OOP in a year do not yield negative median / peak
    // values. This matches the frontend netting logic which displays clipped
    // net out-of-pocket in the stacked area view.
    const clippedTotalHealthcare = totalHealthcare.map((v) => Math.max(0, v));

    // Compute summary stats
    const medianAnnualCostValue = clippedTotalHealthcare.length > 0
      ? (() => {
          const sorted = [...clippedTotalHealthcare].sort((a, b) => a - b);
          const midIdx = Math.floor(sorted.length / 2);
          return sorted[midIdx];
        })()
      : 0;

    // Single-pass argmax for peak healthcare year (avoids O(N²) pattern)
    let peakHealthcareYearIndex = -1;
    let peakHealthcareAmount = 0;
    for (let i = 0; i < clippedTotalHealthcare.length; i++) {
      if (clippedTotalHealthcare[i] > peakHealthcareAmount) {
        peakHealthcareAmount = clippedTotalHealthcare[i];
        peakHealthcareYearIndex = i;
      }
    }

    const lifetimeHealthcareTotal = clippedTotalHealthcare.reduce((sum, v) => sum + v, 0);
    const lifetimeTotalExpenses = totalExpenses.reduce((sum, v) => sum + v, 0);
    const lifetimePercentOfExpensesValue = lifetimeTotalExpenses > 0
      ? (lifetimeHealthcareTotal / lifetimeTotalExpenses) * 100
      : 0;

    cohorts.push({
      label,
      years: yearStrings,
      healthcare: {
        cobra: healthcare.cobra,
        aca: healthcare.aca,
        medicare: healthcare.medicare,
        hospital: healthcare.hospital,
        ltcInsurance: healthcare.ltcInsurance,
        ltcCare: healthcare.ltcCare,
        outOfPocket: healthcare.outOfPocket,
        hsaReimbursements: healthcare.hsaReimbursements,
      },
      totalHealthcare,
      totalExpenses,
      percentOfExpenses,
      realHealthcare: {
        cobra: realHealthcare.cobra,
        aca: realHealthcare.aca,
        medicare: realHealthcare.medicare,
        hospital: realHealthcare.hospital,
        ltcInsurance: realHealthcare.ltcInsurance,
        ltcCare: realHealthcare.ltcCare,
        outOfPocket: realHealthcare.outOfPocket,
        hsaReimbursements: realHealthcare.hsaReimbursements,
      },
      realTotalHealthcare,
      realTotalExpenses,
      medianAnnualCost: medianAnnualCostValue,
      peakHealthcareYear: peakHealthcareYearIndex >= 0
        ? { year: yearStrings[peakHealthcareYearIndex], amount: peakHealthcareAmount }
        : { year: '', amount: 0 },
      lifetimeHealthcareTotal,
      lifetimePercentOfExpenses: lifetimePercentOfExpensesValue,
    });
  }

  // Compute deterministic overlay
  let deterministic: { years: string[]; totalHealthcare: number[]; percentOfExpenses: number[]; realTotalHealthcare: number[] } | undefined;
  try {
    const detResult = await computeDeterministicHealthcareCost(simulationId, fileData);
    if (detResult) {
      deterministic = detResult;
    }
  } catch (error) {
    console.warn('Failed to compute deterministic healthcare cost overlay:', error);
  }

  return {
    cohorts,
    deterministic,
  };
}
