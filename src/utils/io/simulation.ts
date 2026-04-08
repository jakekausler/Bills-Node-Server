import { Simulations } from '../simulation/types';
import { loadVariables, saveVariables } from './variable';
import { LoadedSimulations } from './types';
import { save } from './io';
import { load } from './io';
import { resetCache } from './cache';
import { clearDataCache } from './dataCache';
import { clearProjectionsCache } from './projectionsCache';

const FILE_PATH = 'simulations.json';

/**
 * Loads simulation configurations from storage.
 *
 * Reads simulation metadata from simulations.json and loads variables
 * for each simulation from the variables.csv file.
 *
 * @returns Array of simulation objects with loaded variables
 *
 * @example
 * ```typescript
 * const simulations = loadSimulations();
 * // Returns: [
 * //   {
 * //     name: "Base Scenario",
 * //     enabled: true,
 * //     selected: true,
 * //     variables: {
 * //       retirementDate: { value: new Date('2030-01-01'), type: 'date' },
 * //       initialBalance: { value: 100000, type: 'number' }
 * //     }
 * //   }
 * // ]
 * ```
 */
export function loadSimulations() {
  let loadedSimulations: LoadedSimulations;
  loadedSimulations = load<LoadedSimulations>(FILE_PATH);

  const simulations: Simulations = [];
  for (const simulation of loadedSimulations) {
    simulations.push({
      name: simulation.name,
      enabled: simulation.enabled,
      selected: simulation.selected,
      variables: loadVariables(simulation.name),
      ...(simulation.rateOverrides && { rateOverrides: simulation.rateOverrides }),
      ...(simulation.systemVariableOverrides && { systemVariableOverrides: simulation.systemVariableOverrides }),
    });
  }
  return simulations;
}

/**
 * Saves simulation configurations to storage.
 *
 * Saves simulation metadata to simulations.json and variables to variables.csv.
 * Also resets the cache after saving.
 *
 * @param simulations - Array of simulation objects to save
 *
 * @example
 * ```typescript
 * const simulations = [
 *   {
 *     name: "Updated Scenario",
 *     enabled: true,
 *     selected: true,
 *     variables: {
 *       retirementDate: { value: new Date('2030-01-01'), type: 'date' },
 *       initialBalance: { value: 200000, type: 'number' }
 *     }
 *   }
 * ];
 * saveSimulations(simulations);
 * ```
 */
export function saveSimulations(simulations: Simulations) {
  saveVariables(simulations);
  const toSave: LoadedSimulations = simulations.map((simulation) => ({
    name: simulation.name,
    enabled: simulation.enabled,
    selected: simulation.selected,
    ...(simulation.rateOverrides && { rateOverrides: simulation.rateOverrides }),
    ...(simulation.systemVariableOverrides && { systemVariableOverrides: simulation.systemVariableOverrides }),
  }));
  save(toSave, FILE_PATH);
  clearDataCache();
  clearProjectionsCache();
  resetCache();
}

/**
 * Returns the per-simulation overrides for a given simulation name,
 * or null if the simulation has no overrides.
 */
export function getSimulationOverrides(simulationName: string): {
  rateOverrides?: Record<string, number>;
  systemVariableOverrides?: Record<string, string>;
} | null {
  const loaded = load<LoadedSimulations>(FILE_PATH);
  const sim = loaded.find((s) => s.name === simulationName);
  if (!sim) return null;
  if (!sim.rateOverrides && !sim.systemVariableOverrides) return null;
  return {
    ...(sim.rateOverrides && { rateOverrides: sim.rateOverrides }),
    ...(sim.systemVariableOverrides && { systemVariableOverrides: sim.systemVariableOverrides }),
  };
}
