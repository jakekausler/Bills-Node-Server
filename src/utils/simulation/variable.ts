import { parseDate } from '../date/date';
import { DateString } from '../date/types';
import { loadSimulations, getSimulationOverrides } from '../io/simulation';
import { resolveSystemVariable } from '../../api/system-variables/system-variables';
import { isRate, getRate } from '../../api/rates-config/rates-config';

/**
 * Loads and resolves a variable value from a three-source hierarchy:
 *   1. System variables (person-derived dates from person config)
 *   2. Rate variables (from ratesConfig.json)
 *   3. User variables (from variables.csv per simulation)
 *
 * Also supports special fraction tokens ({HALF}, {FULL}, -{HALF}, -{FULL})
 * which pass through without any lookup.
 *
 * @param variable - The variable name to load, including special fraction values
 * @param simulation - The simulation name to load the variable from
 * @returns The resolved variable value as a number, Date, or special fraction string
 * @throws Error if the simulation or variable is not found, or if the variable type is invalid
 */
export function loadVariable(
  variable: string,
  simulation: string,
): number | Date | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}' {
  variable = variable.trim();

  // Fraction token pass-through (unchanged)
  if (variable === '{HALF}' || variable === '{FULL}' || variable === '-{HALF}' || variable === '-{FULL}') {
    return variable;
  }

  // 1. Per-simulation overrides (highest priority after fraction tokens)
  const overrides = getSimulationOverrides(simulation);
  if (overrides?.systemVariableOverrides && variable in overrides.systemVariableOverrides) {
    return parseDate(overrides.systemVariableOverrides[variable] as DateString);
  }
  if (overrides?.rateOverrides && variable in overrides.rateOverrides) {
    return overrides.rateOverrides[variable];
  }

  // 2. System variables (person-derived dates)
  const systemValue = resolveSystemVariable(variable);
  if (systemValue !== null) {
    return systemValue;
  }

  // 3. Rate variables (from ratesConfig.json)
  if (isRate(variable)) {
    return getRate(variable);
  }

  // 4. User variables (from variables.csv — existing behavior)
  const simulations = loadSimulations();
  const variables = simulations.find((s) => s.name === simulation)?.variables;
  if (!variables) {
    throw new Error(`Simulation '${simulation}' not found`);
  }
  if (variable in variables) {
    if (variables[variable].type === 'date') {
      if (typeof variables[variable].value === 'string') {
        return parseDate(variables[variable].value as DateString);
      } else {
        return variables[variable].value as Date;
      }
    } else if (variables[variable].type === 'amount') {
      if (typeof variables[variable].value === 'string') {
        return parseFloat(variables[variable].value as string);
      } else {
        return variables[variable].value as number;
      }
    } else {
      throw new Error(`Invalid variable type '${variables[variable].type}'`);
    }
  }
  throw new Error(`Invalid variable '${variable}'`);
}
