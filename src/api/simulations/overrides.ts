import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import { LoadedSimulations } from '../../utils/io/types';
import { clearDataCache } from '../../utils/io/dataCache';
import { clearProjectionsCache } from '../../utils/io/projectionsCache';
import { resetCache } from '../../utils/io/cache';
import { ApiError } from '../errors';

const FILE_PATH = 'simulations.json';

export interface SimulationOverridesResponse {
  rateOverrides: Record<string, number>;
  systemVariableOverrides: Record<string, string>;
}

/**
 * GET /api/simulations/:name/overrides
 * Returns the overrides for a simulation.
 */
export function getSimulationOverridesHandler(req: Request): SimulationOverridesResponse {
  const name = decodeURIComponent(req.params.name);
  const simulations = load<LoadedSimulations>(FILE_PATH);
  const sim = simulations.find((s) => s.name === name);
  if (!sim) {
    throw new ApiError(`Simulation '${name}' not found`, 404);
  }
  return {
    rateOverrides: sim.rateOverrides ?? {},
    systemVariableOverrides: sim.systemVariableOverrides ?? {},
  };
}

/**
 * PUT /api/simulations/:name/overrides
 * Replaces the overrides for a simulation.
 * Body: { rateOverrides?: Record<string, number>, systemVariableOverrides?: Record<string, string> }
 */
export function updateSimulationOverridesHandler(req: Request): SimulationOverridesResponse {
  const name = decodeURIComponent(req.params.name);
  const simulations = load<LoadedSimulations>(FILE_PATH);
  const index = simulations.findIndex((s) => s.name === name);
  if (index === -1) {
    throw new ApiError(`Simulation '${name}' not found`, 404);
  }

  const { rateOverrides, systemVariableOverrides } = req.body;

  // Validate rateOverrides
  if (rateOverrides !== undefined) {
    if (typeof rateOverrides !== 'object' || rateOverrides === null || Array.isArray(rateOverrides)) {
      throw new ApiError('rateOverrides must be an object', 400);
    }
    for (const [key, val] of Object.entries(rateOverrides)) {
      if (typeof val !== 'number') {
        throw new ApiError(`rateOverrides['${key}'] must be a number`, 400);
      }
    }
  }

  // Validate systemVariableOverrides
  if (systemVariableOverrides !== undefined) {
    if (typeof systemVariableOverrides !== 'object' || systemVariableOverrides === null || Array.isArray(systemVariableOverrides)) {
      throw new ApiError('systemVariableOverrides must be an object', 400);
    }
    for (const [key, val] of Object.entries(systemVariableOverrides)) {
      if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        throw new ApiError(`systemVariableOverrides['${key}'] must be a date string in YYYY-MM-DD format`, 400);
      }
    }
  }

  // Update
  simulations[index].rateOverrides = rateOverrides ?? {};
  simulations[index].systemVariableOverrides = systemVariableOverrides ?? {};

  // Remove empty override objects to keep JSON clean
  if (Object.keys(simulations[index].rateOverrides!).length === 0) {
    delete simulations[index].rateOverrides;
  }
  if (Object.keys(simulations[index].systemVariableOverrides!).length === 0) {
    delete simulations[index].systemVariableOverrides;
  }

  save(simulations, FILE_PATH);
  clearDataCache();
  clearProjectionsCache();
  resetCache();

  return {
    rateOverrides: simulations[index].rateOverrides ?? {},
    systemVariableOverrides: simulations[index].systemVariableOverrides ?? {},
  };
}
