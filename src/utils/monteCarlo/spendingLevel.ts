import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR, UUID_REGEX } from './paths';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';
import { hasAnyoneSurvivingInYear, getYearWhenAllDead } from './statisticsGraph';

interface SimData {
  yearlyFlows: Record<string, YearlyFlowSummary>;
  cumulativeInflation?: Record<number, number>;
  yearlyPortfolioReturns?: Record<number, number>;
  yearlyMinBalances: Record<number, number>;
  deathDates?: Record<string, string | null>;
}

export interface SpendingLevelResult {
  curve: { spending: number; successRate: number }[];
  thresholds: { at90: number; at95: number; at99: number };
  currentPlan: { spending: number; successRate: number };
}

/**
 * Compute sustainable spending level analysis.
 *
 * For each candidate annual spending level (in today's dollars), walk each
 * simulation's balance trajectory from retirementYear onward, tracking the
 * cumulative delta between the candidate spending and actual expenses.
 * The delta compounds with each year's portfolio return. If the adjusted
 * balance drops to zero or below at any year, the simulation "fails" at
 * that spending level.
 *
 * Returns a curve of ~30 (spending, successRate) points, threshold spending
 * amounts at 90/95/99% success, and the current plan's median spending and
 * its success rate.
 */
export async function computeSpendingLevel(
  simulationId: string,
  retirementYear: number,
  survivingOnly: boolean = false,
  survivingYearsOnly: boolean = false,
): Promise<SpendingLevelResult> {
  if (!UUID_REGEX.test(simulationId)) {
    throw new Error('Invalid simulation ID format');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(await readFile(resultsPath, 'utf8'));
  let results: SimData[] = fileData.results ?? [];

  if (results.length === 0 || !results[0].yearlyFlows) {
    throw new Error('Flow data not available');
  }

  // Filter surviving simulations if requested (same as withdrawalRate.ts:160-199)
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

  if (survivingYearsOnly) {
    results = results.map((sim) => {
      const deathYear = getYearWhenAllDead(sim.deathDates);
      if (deathYear === null) return sim;

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

  const totalSims = results.length;

  // Step 1: For each simulation, compute the deflated totalExpenses at retirementYear
  // to find the median actual retirement spending (in today's dollars).
  const retirementExpenses: number[] = [];

  for (const sim of results) {
    const flow = sim.yearlyFlows[String(retirementYear)];
    if (!flow) continue;

    const inflation = sim.cumulativeInflation?.[retirementYear] ?? 1;
    const deflated = flow.totalExpenses / inflation;
    retirementExpenses.push(deflated);
  }

  if (retirementExpenses.length === 0) {
    throw new Error(`No flow data available at retirement year ${retirementYear}`);
  }

  retirementExpenses.sort((a, b) => a - b);
  const medianExpenses = retirementExpenses[Math.floor(retirementExpenses.length / 2)];

  // Step 2: Define sweep range: 50% to 150% of median, ~30 steps
  const sweepMin = medianExpenses * 0.5;
  const sweepMax = medianExpenses * 1.5;
  const NUM_STEPS = 30;
  const stepSize = (sweepMax - sweepMin) / NUM_STEPS;

  const candidateLevels: number[] = [];
  for (let i = 0; i <= NUM_STEPS; i++) {
    candidateLevels.push(sweepMin + i * stepSize);
  }

  // Helper function to compute success rate at a given spending level
  function computeSuccessRateAtSpending(
    simulationsToTest: SimData[],
    candidateSpending: number,
    retirementYearIndex: number,
  ): number {
    let survivedCount = 0;

    for (const sim of simulationsToTest) {
      // Get sorted years from retirementYear onward
      const sortedYears = Object.keys(sim.yearlyFlows)
        .map((y) => parseInt(y, 10))
        .filter((y) => y >= retirementYearIndex)
        .sort((a, b) => a - b);

      if (sortedYears.length === 0) {
        // No post-retirement data; count as survived (no failure observable)
        survivedCount++;
        continue;
      }

      let cumulativeDelta = 0;
      let failed = false;

      for (const year of sortedYears) {
        const flow = sim.yearlyFlows[String(year)];
        if (!flow) continue;

        const inflation = sim.cumulativeInflation?.[year] ?? 1;
        const inflatedSpending = candidateSpending * inflation;
        const actualExpenses = flow.totalExpenses;
        const delta = inflatedSpending - actualExpenses;

        const portfolioReturn = sim.yearlyPortfolioReturns?.[year] ?? 0;
        cumulativeDelta = cumulativeDelta * (1 + portfolioReturn) + delta;

        // Check if the adjusted balance would be <= 0
        const actualBalance = sim.yearlyMinBalances[year] ?? flow.endingBalance;
        if (actualBalance - cumulativeDelta <= 0) {
          failed = true;
          break;
        }
      }

      if (!failed) {
        survivedCount++;
      }
    }

    return (survivedCount / simulationsToTest.length) * 100;
  }

  // Step 3: For each candidate spending level, compute success rate
  const curve: { spending: number; successRate: number }[] = [];

  for (const candidateSpending of candidateLevels) {
    const successRate = computeSuccessRateAtSpending(results, candidateSpending, retirementYear);
    curve.push({ spending: Math.round(candidateSpending), successRate: Math.round(successRate * 100) / 100 });
  }

  // Step 4: Interpolate to find thresholds at 90%, 95%, 99%
  function findThreshold(targetRate: number): number {
    // Curve is ordered by ascending spending, success rate should be descending
    // Find the two points that bracket the target rate
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i];
      const b = curve[i + 1];
      if (
        (a.successRate >= targetRate && b.successRate <= targetRate) ||
        (a.successRate <= targetRate && b.successRate >= targetRate)
      ) {
        // Linear interpolation
        if (a.successRate === b.successRate) return a.spending;
        const t = (targetRate - a.successRate) / (b.successRate - a.successRate);
        return Math.round(a.spending + t * (b.spending - a.spending));
      }
    }
    // If all points are above the target, return the max spending
    if (curve.length > 0 && curve[curve.length - 1].successRate >= targetRate) {
      return curve[curve.length - 1].spending;
    }
    // If all points are below the target, return the min spending
    if (curve.length > 0 && curve[0].successRate <= targetRate) {
      return curve[0].spending;
    }
    return 0;
  }

  const thresholds = {
    at90: findThreshold(90),
    at95: findThreshold(95),
    at99: findThreshold(99),
  };

  // Step 5: Current plan = median actual spending, compute its success rate
  // Reuse the shared helper for medianExpenses
  const currentPlanSuccessRate = computeSuccessRateAtSpending(results, medianExpenses, retirementYear);

  const currentPlan = {
    spending: Math.round(medianExpenses),
    successRate: Math.round(currentPlanSuccessRate * 100) / 100,
  };

  return { curve, thresholds, currentPlan };
}
