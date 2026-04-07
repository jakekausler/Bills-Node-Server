import { Request } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getData } from '../../utils/net/request';
import {
  startMonteCarloSimulation,
  getSimulationProgress,
  isSimulationComplete,
  MonteCarloSimulationRunner,
} from '../../utils/monteCarlo';
import { SimulationProgress } from '../../utils/monteCarlo/types';
import { PercentileGraphData, computePercentileGraph, clearDetCache } from '../../utils/monteCarlo/statisticsGraph';
import { FailureHistogramResult, computeFailureHistogram } from '../../utils/monteCarlo/failureHistogram';
import { WorstCasesResult, computeWorstCases } from '../../utils/monteCarlo/worstCases';
import { IncomeExpenseResult, computeIncomeExpense } from '../../utils/monteCarlo/incomeExpense';
import { LongevityDataPoint, computeLongevityAnalysis } from '../../utils/monteCarlo/longevityAnalysis';
import { SequenceOfReturnsData, loadAndComputeSequenceOfReturns } from '../../utils/monteCarlo/sequenceOfReturns';
import { MC_RESULTS_DIR } from '../../utils/monteCarlo/paths';
import { DebugLogger } from '../../utils/calculate-v3/debug-logger';
import { loadVariables } from '../../utils/io/variable';
import { getPersonConfigs, getPersonBirthDate } from '../person-config/person-config';
import dayjs from 'dayjs';

// In-memory caches — cleared on simulation delete (invalidateGraphCache) and POST /api/cache/clear (clearAllGraphCache).
// No size limit or TTL — acceptable for typical usage (few simulations, bounded key space).

// Key: `{simulationId}:{accountId || 'combined'}`
const graphCache = new Map<string, PercentileGraphData>();

const histogramCache = new Map<string, FailureHistogramResult>();

// Key: `{simulationId}:{percentile}:{accountId || 'combined'}`
const worstCasesCache = new Map<string, WorstCasesResult>();

// Key: `{simulationId}:{percentile}`
const incomeExpenseCache = new Map<string, IncomeExpenseResult>();

// Key: `{simulationId}`
const longevityCache = new Map<string, LongevityDataPoint[]>();

// Key: `{simulationId}:{retirementYear}:{window}:{survivingOnly}`
const sequenceOfReturnsCache = new Map<string, SequenceOfReturnsData>();

/**
 * Invalidate all cached graph data for a given simulation
 */
export function invalidateGraphCache(simulationId: string): void {
  for (const key of graphCache.keys()) {
    if (key.startsWith(`${simulationId}:`)) {
      graphCache.delete(key);
    }
  }
  histogramCache.delete(simulationId);
  for (const key of worstCasesCache.keys()) {
    if (key.startsWith(`${simulationId}:`)) {
      worstCasesCache.delete(key);
    }
  }
  for (const key of incomeExpenseCache.keys()) {
    if (key.startsWith(`${simulationId}:`)) {
      incomeExpenseCache.delete(key);
    }
  }
  longevityCache.delete(simulationId);
  for (const key of sequenceOfReturnsCache.keys()) {
    if (key.startsWith(`${simulationId}:`)) {
      sequenceOfReturnsCache.delete(key);
    }
  }
}

/**
 * Clear all cached MC graph data (used by /api/cache/clear)
 */
export function clearAllGraphCache(): void {
  graphCache.clear();
  histogramCache.clear();
  worstCasesCache.clear();
  incomeExpenseCache.clear();
  longevityCache.clear();
  sequenceOfReturnsCache.clear();
  clearDetCache();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MonteCarloRequestData {
  totalSimulations?: number;
  batchSize?: number;
  seed?: number; // Optional seed for reproducibility
  debug?: boolean; // Enable debug logging for selected sims
  debugSims?: number[]; // Which simulation numbers to log (default: [1,2,3])
}

/**
 * Start a new Monte Carlo simulation
 */
export async function startSimulation(req: Request): Promise<{ id: string; debugLogDir?: string }> {
  // Validate required historical data files exist
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(join(dataDir, 'historicRates.json'))) {
    throw new Error('Missing historicRates.json - required for Monte Carlo simulation');
  }
  if (!existsSync(join(dataDir, 'portfolioMakeupOverTime.json'))) {
    throw new Error('Missing portfolioMakeupOverTime.json - required for Monte Carlo simulation');
  }

  const { accountsAndTransfers, data, startDate, endDate } = await getData<MonteCarloRequestData>(req);

  const totalSimulations = data?.totalSimulations || 1000;
  const batchSize = data?.batchSize || 5;
  const seed = data?.seed; // Optional seed for reproducibility

  // Debug logging: create a shared DebugLogger directory if requested
  let debugLogDir: string | undefined;
  let debugSims: number[] | undefined;
  if (data?.debug) {
    debugSims = data.debugSims ?? [1, 2, 3];
    const logger = new DebugLogger({ debugSims });
    debugLogDir = logger.getDir();
    logger.close(); // Just need the directory; workers will write to it
    console.log(`🔍 [MC] Debug enabled: dir=${debugLogDir}, sims=${JSON.stringify(debugSims)}`);
  }

  const id = await startMonteCarloSimulation(accountsAndTransfers, totalSimulations, batchSize, startDate, endDate, seed, debugLogDir, debugSims);

  return { id, ...(debugLogDir ? { debugLogDir } : {}) };
}

/**
 * Get the status of a specific Monte Carlo simulation
 */
export async function getSimulationStatus(req: Request): Promise<SimulationProgress> {
  const { id } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  const progress = await getSimulationProgress(id);

  if (!progress) {
    throw new Error(`Simulation with ID ${id} not found`);
  }

  return progress;
}

/**
 * Get all Monte Carlo simulation statuses
 */
export async function getAllSimulations(_req: Request): Promise<SimulationProgress[]> {
  const runner = await MonteCarloSimulationRunner.getInstance();
  return runner.getAllSimulations();
}

/**
 * Get the graph data for a completed Monte Carlo simulation.
 * Computes percentiles on-demand from raw results with in-memory caching.
 * Supports ?account={accountId} for per-account percentile data.
 * Supports ?survivingOnly=true to filter to simulations with survivors in all years.
 * Supports ?excludeAssets=true to exclude asset accounts from calculations.
 * Returns both nominal (data) and real (realValues) in each dataset.
 */
export async function getSimulationGraph(req: Request): Promise<PercentileGraphData> {
  const { id } = req.params;
  const accountId = req.query.account as string | undefined;
  const survivingOnly = req.query.survivingOnly === 'true';
  const excludeAssets = req.query.excludeAssets === 'true';
  const survivingYearsOnly = req.query.survivingYearsOnly === 'true';

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  if (!(await isSimulationComplete(id))) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  // Check cache (include survivingOnly, excludeAssets, and survivingYearsOnly in key)
  const cacheKey = `${id}:${accountId || 'combined'}:${survivingOnly ? 'surviving' : 'all'}:${excludeAssets ? 'noAssets' : 'assets'}:${survivingYearsOnly ? 'survivingYears' : 'allYears'}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute on-demand
  try {
    const graphData = await computePercentileGraph(id, accountId, survivingOnly, excludeAssets, survivingYearsOnly);
    graphCache.set(cacheKey, graphData);
    return graphData;
  } catch (error) {
    throw new Error(`Failed to compute graph data for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get failure histogram for a completed Monte Carlo simulation.
 * Groups fundingFailureYear by year and computes summary statistics.
 */
export async function getFailureHistogram(req: Request): Promise<FailureHistogramResult> {
  const { id } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  if (!(await isSimulationComplete(id))) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  // Check cache
  const cached = histogramCache.get(id);
  if (cached) {
    return cached;
  }

  // Compute on-demand
  try {
    const result = await computeFailureHistogram(id);
    histogramCache.set(id, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to compute failure histogram for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete or cancel a Monte Carlo simulation
 */
export async function deleteSimulation(req: Request): Promise<{ success: boolean }> {
  const id = req.params.id;
  if (!id || !UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID');
  }

  // Invalidate cached graph data for this simulation
  invalidateGraphCache(id);

  const runner = await MonteCarloSimulationRunner.getInstance();
  const deleted = await runner.cancelOrDelete(id);
  if (!deleted) {
    throw new Error('Simulation not found');
  }

  return { success: true };
}

/**
 * Get worst-case simulations for a completed Monte Carlo simulation.
 * Selects bottom N% of simulations ranked by worst (minimum) balance across all years.
 * Supports ?percentile (1-50, default 5) and ?account (account ID) params.
 */
export async function getWorstCases(req: Request): Promise<WorstCasesResult> {
  const { id } = req.params;
  const accountId = req.query.account as string | undefined;
  const percentile = req.query.percentile ? parseInt(req.query.percentile as string, 10) : 5;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  if (!(await isSimulationComplete(id))) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  // Clamped here for cache key consistency; also clamped in computeWorstCases for safety
  const clampedPercentile = Math.max(1, Math.min(50, isNaN(percentile) ? 5 : percentile));

  // Check cache
  const cacheKey = `${id}:${clampedPercentile}:${accountId || 'combined'}`;
  const cached = worstCasesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute on-demand
  try {
    const result = await computeWorstCases(id, clampedPercentile, accountId);
    worstCasesCache.set(cacheKey, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to compute worst cases for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get all results data for a completed Monte Carlo simulation
 */
export async function getSimulationResults(req: Request): Promise<unknown> {
  const { id } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${id}.json`);

  if (!existsSync(resultsPath)) {
    throw new Error(`Results not found for simulation ${id}`);
  }

  try {
    return JSON.parse(readFileSync(resultsPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load results for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get results for a specific simulation number within a Monte Carlo run.
 * Replaces account IDs with account names in yearlyAccountBalances for readability.
 */
export async function getSimulationResultByNumber(req: Request): Promise<unknown> {
  const { id, simNumber } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  const simNum = parseInt(simNumber, 10);
  if (isNaN(simNum) || simNum < 1) {
    throw new Error('Simulation number must be a positive integer');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${id}.json`);

  if (!existsSync(resultsPath)) {
    throw new Error(`Results not found for simulation ${id}`);
  }

  try {
    const fileData = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const results = fileData.results as Array<{ simulationNumber: number; yearlyAccountBalances?: Record<string, Record<string, number>>; [key: string]: unknown }>;

    const simResult = results.find((r) => r.simulationNumber === simNum);
    if (!simResult) {
      throw new Error(`Simulation number ${simNum} not found (valid range: 1-${results.length})`);
    }

    // Build account ID → name lookup from metadata
    const accountNames: Array<{ id: string; name: string }> = fileData.metadata?.accountNames || [];
    const idToName: Record<string, string> = {};
    for (const acct of accountNames) {
      idToName[acct.id] = acct.name;
    }

    // Replace account IDs with names in yearlyAccountBalances
    if (simResult.yearlyAccountBalances && Object.keys(idToName).length > 0) {
      const namedBalances: Record<string, Record<string, number>> = {};
      for (const [year, accounts] of Object.entries(simResult.yearlyAccountBalances)) {
        namedBalances[year] = {};
        for (const [acctId, balance] of Object.entries(accounts as Record<string, number>)) {
          const name = idToName[acctId] || acctId;
          namedBalances[year][name] = balance;
        }
      }
      simResult.yearlyAccountBalances = namedBalances;
    }

    return { metadata: fileData.metadata, result: simResult };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    throw new Error(`Failed to load results for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get income/expense breakdown for a completed Monte Carlo simulation.
 * Computes breakdown at requested percentile, fan charts, and summary.
 */
export async function getIncomeExpense(req: Request): Promise<IncomeExpenseResult> {
  const { id } = req.params;
  const percentile = req.query.percentile ? parseInt(req.query.percentile as string, 10) : 50;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  if (!(await isSimulationComplete(id))) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  const clampedPercentile = Math.max(0, Math.min(100, isNaN(percentile) ? 50 : percentile));

  // Check cache
  const cacheKey = `${id}:${clampedPercentile}`;
  const cached = incomeExpenseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute on-demand
  try {
    const result = await computeIncomeExpense(id, clampedPercentile);
    incomeExpenseCache.set(cacheKey, result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'Flow data not available') {
      throw new Error('Flow data not available for this simulation. Please re-run.');
    }
    throw new Error(`Failed to compute income/expense data for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * #14: Get longevity analysis data for a completed Monte Carlo simulation.
 * Returns funded ratio and survival probability by age (65-100).
 */
export async function getLongevityData(req: Request): Promise<LongevityDataPoint[]> {
  const { id } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  if (!(await isSimulationComplete(id))) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  // Check cache
  const cached = longevityCache.get(id);
  if (cached) {
    return cached;
  }

  // Load birth years from person config
  const simulation = (req.query.simulation as string) || 'Default';
  let personBirthYears: Record<string, number> | undefined;
  try {
    const personConfigs = getPersonConfigs();
    const birthYearMap: Record<string, number> = {};
    for (const person of personConfigs) {
      try {
        const birthDate = getPersonBirthDate(person.name);
        birthYearMap[person.name] = dayjs.utc(birthDate).year();
      } catch (e) {
        // Skip this person if birth date can't be loaded
      }
    }
    if (Object.keys(birthYearMap).length > 0) {
      personBirthYears = birthYearMap;
    }
  } catch {
    // Fall back to heuristic if person config can't be loaded
  }

  // Compute on-demand
  try {
    const result = await computeLongevityAnalysis(id, personBirthYears);
    longevityCache.set(id, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to compute longevity data for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * #14: Get sequence-of-returns analysis for a completed Monte Carlo simulation.
 * Correlates early retirement returns with final portfolio outcomes.
 * Supports ?retirementYear (required), ?window (default 5), ?survivingOnly (default false).
 */
export async function getSequenceOfReturns(req: Request): Promise<SequenceOfReturnsData> {
  const { id } = req.params;
  const survivingOnly = req.query.survivingOnly === 'true';

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!UUID_REGEX.test(id)) {
    throw new Error('Invalid simulation ID format');
  }

  if (!(await isSimulationComplete(id))) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  const retirementYear = parseInt(req.query.retirementYear as string, 10);
  if (isNaN(retirementYear)) {
    throw new Error('retirementYear query parameter is required and must be a number');
  }

  const window = req.query.window ? parseInt(req.query.window as string, 10) : 5;
  const clampedWindow = Math.max(1, Math.min(30, isNaN(window) ? 5 : window));

  // Check cache
  const cacheKey = `${id}:${retirementYear}:${clampedWindow}:${survivingOnly ? 'surviving' : 'all'}`;
  const cached = sequenceOfReturnsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute on-demand
  try {
    const result = await loadAndComputeSequenceOfReturns(id, retirementYear, clampedWindow, survivingOnly);
    sequenceOfReturnsCache.set(cacheKey, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to compute sequence-of-returns data for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
