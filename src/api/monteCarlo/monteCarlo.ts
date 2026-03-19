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
import { PercentileGraphData, computePercentileGraph } from '../../utils/monteCarlo/statisticsGraph';
import { MC_RESULTS_DIR } from '../../utils/monteCarlo/paths';
import { DebugLogger } from '../../utils/calculate-v3/debug-logger';

// In-memory cache for computed percentile graphs
// Key: `{simulationId}:{accountId || 'combined'}`
const graphCache = new Map<string, PercentileGraphData>();

/**
 * Invalidate all cached graph data for a given simulation
 */
export function invalidateGraphCache(simulationId: string): void {
  for (const key of graphCache.keys()) {
    if (key.startsWith(`${simulationId}:`)) {
      graphCache.delete(key);
    }
  }
}

/**
 * Clear all cached MC graph data (used by /api/cache/clear)
 */
export function clearAllGraphCache(): void {
  graphCache.clear();
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
 * Returns both nominal (data) and real (realValues) in each dataset.
 */
export async function getSimulationGraph(req: Request): Promise<PercentileGraphData> {
  const { id } = req.params;
  const accountId = req.query.account as string | undefined;

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
  const cacheKey = `${id}:${accountId || 'combined'}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Compute on-demand
  try {
    const graphData = await computePercentileGraph(id, accountId);
    graphCache.set(cacheKey, graphData);
    return graphData;
  } catch (error) {
    throw new Error(`Failed to compute graph data for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
