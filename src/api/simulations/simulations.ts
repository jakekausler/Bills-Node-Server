import { Request } from 'express';
import { loadSimulations, saveSimulations } from '../../utils/io/simulation';
import { formatDate } from '../../utils/date/date';
import { getSystemVariables } from '../system-variables/system-variables';
import { getRates } from '../rates-config/rates-config';

/**
 * Retrieves all simulation configurations with variables merged from three sources.
 *
 * Each variable includes a `source` field indicating its origin:
 * - 'system': Person-derived dates (retirement, SS start)
 * - 'rate': Financial rates from ratesConfig.json
 * - 'user': User-configured variables from variables.csv
 *
 * @param _request - Express request object (unused)
 * @returns Array of simulation objects with merged, source-tagged variables
 */
export function getSimulations(_request: Request) {
  const systemVars = getSystemVariables();
  const rates = getRates();

  return loadSimulations().map((simulation) => {
    const variables: Record<string, { value: string | number; type: string; source: string }> = {};

    // System variables (person-derived dates)
    for (const sv of systemVars) {
      variables[sv.name] = { value: formatDate(sv.value as Date), type: 'date', source: 'system' };
    }

    // Rate variables (from ratesConfig.json)
    for (const rate of rates) {
      variables[rate.name] = { value: rate.value, type: 'amount', source: 'rate' };
    }

    // User variables (from variables.csv per simulation)
    for (const [key, val] of Object.entries(simulation.variables)) {
      variables[key] = {
        value: val.type === 'date' ? formatDate(val.value as Date) : val.value,
        type: val.type,
        source: 'user',
      };
    }

    // Per-simulation overrides (take precedence over defaults)
    if (simulation.rateOverrides) {
      for (const [name, value] of Object.entries(simulation.rateOverrides)) {
        if (variables[name]) {
          variables[name] = { ...variables[name], value, source: 'override' };
        } else {
          variables[name] = { value, type: 'amount', source: 'override' };
        }
      }
    }
    if (simulation.systemVariableOverrides) {
      for (const [name, value] of Object.entries(simulation.systemVariableOverrides)) {
        if (variables[name]) {
          variables[name] = { ...variables[name], value, source: 'override' };
        } else {
          variables[name] = { value, type: 'date', source: 'override' };
        }
      }
    }

    return {
      name: simulation.name,
      enabled: simulation.enabled,
      selected: simulation.selected,
      variables,
    };
  });
}

/**
 * Updates simulation configurations with new data.
 *
 * Saves the provided simulation data to storage and returns the saved data.
 * Only user variables are persisted — system and rate variables are read-only.
 *
 * @param request - Express request object containing simulation data
 * @returns The updated simulation data that was saved
 */
export function updateSimulations(request: Request) {
  const simulations = request.body;
  if (!Array.isArray(simulations)) {
    throw new Error('Simulations data must be an array');
  }
  for (const sim of simulations) {
    if (typeof sim.name !== 'string' || typeof sim.enabled !== 'boolean' || typeof sim.selected !== 'boolean') {
      throw new Error('Invalid simulation format: each simulation must have name (string), enabled (boolean), and selected (boolean)');
    }
  }
  // Strip system/rate variables that may have been included in client payload
  for (const sim of simulations) {
    if (sim.variables) {
      for (const [key, val] of Object.entries(sim.variables)) {
        if (val && typeof val === 'object' && 'source' in val && (val.source === 'system' || val.source === 'rate' || val.source === 'override')) {
          delete sim.variables[key];
        }
      }
    }
  }
  saveSimulations(simulations);
  return simulations;
}
