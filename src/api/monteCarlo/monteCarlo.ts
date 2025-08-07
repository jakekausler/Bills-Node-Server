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

interface MonteCarloRequestData {
  totalSimulations?: number;
  batchSize?: number;
}

/**
 * Start a new Monte Carlo simulation
 */
export async function startSimulation(req: Request): Promise<{ id: string }> {
  const { accountsAndTransfers, data, startDate, endDate } = await getData<MonteCarloRequestData>(req);

  const totalSimulations = data?.totalSimulations || 1000;
  const batchSize = data?.batchSize || 5;

  const id = startMonteCarloSimulation(accountsAndTransfers, totalSimulations, batchSize, startDate, endDate);

  return { id };
}

/**
 * Get the status of a specific Monte Carlo simulation
 */
export function getSimulationStatus(req: Request): SimulationProgress {
  const { id } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  const progress = getSimulationProgress(id);

  if (!progress) {
    throw new Error(`Simulation with ID ${id} not found`);
  }

  return progress;
}

/**
 * Get all Monte Carlo simulation statuses
 */
export function getAllSimulations(_req: Request): SimulationProgress[] {
  const runner = MonteCarloSimulationRunner.getInstance();
  return runner.getAllSimulations();
}

/**
 * Get the graph data for a completed Monte Carlo simulation
 */
export function getSimulationGraph(req: Request): PercentileGraphData {
  const { id } = req.params;

  if (!id) {
    throw new Error('Simulation ID is required');
  }

  if (!isSimulationComplete(id)) {
    throw new Error(`Simulation with ID ${id} is not yet completed`);
  }

  // Load graph data from saved file
  const graphFilePath = join(__dirname, '../../utils/monteCarlo/graphs', `${id}.json`);
  
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
