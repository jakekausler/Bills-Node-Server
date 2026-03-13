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
import { PercentileGraphData } from '../../utils/monteCarlo/statisticsGraph';
import { MC_GRAPHS_DIR } from '../../utils/monteCarlo/paths';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MonteCarloRequestData {
  totalSimulations?: number;
  batchSize?: number;
}

/**
 * Start a new Monte Carlo simulation
 */
export async function startSimulation(req: Request): Promise<{ id: string }> {
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

  const id = await startMonteCarloSimulation(accountsAndTransfers, totalSimulations, batchSize, startDate, endDate);

  return { id };
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
 * Get the graph data for a completed Monte Carlo simulation
 */
export async function getSimulationGraph(req: Request): Promise<PercentileGraphData> {
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

  // Load graph data from saved file
  const graphFilePath = join(MC_GRAPHS_DIR, `${id}.json`);

  if (!existsSync(graphFilePath)) {
    throw new Error(`Graph file not found for simulation ${id}. Graph may not have been generated yet.`);
  }

  try {
    const graphData = JSON.parse(readFileSync(graphFilePath, 'utf8')) as PercentileGraphData;
    return graphData;
  } catch (error) {
    throw new Error(`Failed to load graph data for simulation ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  const runner = await MonteCarloSimulationRunner.getInstance();
  const deleted = await runner.cancelOrDelete(id);
  if (!deleted) {
    throw new Error('Simulation not found');
  }

  return { success: true };
}
