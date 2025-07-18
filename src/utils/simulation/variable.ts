import { parseDate } from '../date/date';
import { DateString } from '../date/types';
import { loadSimulations } from '../io/simulation';

/**
 * Loads and resolves a variable value from a simulation configuration
 * 
 * This function retrieves variable values from simulation configurations,
 * handling both date and amount types. It also supports special fraction
 * values for partial amounts ({HALF}, {FULL}, etc.).
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
  const simulations = loadSimulations();
  const variables = simulations.find((s) => s.name === simulation)?.variables;
  if (!variables) {
    throw new Error(`Simulation '${simulation}' not found`);
  }
  variable = variable.trim();
  if (variable === '{HALF}' || variable === '{FULL}' || variable === '-{HALF}' || variable === '-{FULL}') {
    return variable;
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
