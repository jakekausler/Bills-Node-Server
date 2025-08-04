import { Simulations } from '../simulation/types';
import { loadVariables, saveVariables } from './variable';
import { LoadedSimulations } from './types';
import { save } from './io';
import { load } from './io';
import { resetCache } from './cache';

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
  }));
  save(toSave, FILE_PATH);
  resetCache();
}
