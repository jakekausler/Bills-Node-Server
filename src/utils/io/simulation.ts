import { Simulations } from '../simulation/types';
import { loadVariables, saveVariables } from './variable';
import { LoadedSimulations } from './types';
import { save } from './io';
import { load } from './io';
import { resetCache } from './cache';

const FILE_PATH = 'simulations.json';

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
