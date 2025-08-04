import { parse as parseSync } from 'csv-parse/sync';
import * as csv from 'fast-csv';
import { createWriteStream, readFileSync } from 'fs';
import { Simulations, Variables } from '../simulation/types';
import { loadVariableValue } from '../simulation/loadVariableValue';
import { formatDate } from '../date/date';
import { backup, BASE_DATA_DIR, shouldBackup } from './io';
import path from 'path';

const FILE_PATH = 'variables.csv';

/**
 * Loads variables for a specific simulation from the variables.csv file.
 *
 * Parses the CSV file and extracts variables for the specified simulation,
 * converting string values to their appropriate types (date, number, string).
 *
 * @param simulation - Name of the simulation to load variables for
 * @returns Variables object with typed values
 *
 * @example
 * ```typescript
 * const variables = loadVariables('Base Scenario');
 * // Returns: {
 * //   retirementDate: { value: new Date('2030-01-01'), type: 'date' },
 * //   initialBalance: { value: 100000, type: 'number' },
 * //   riskProfile: { value: 'conservative', type: 'string' }
 * // }
 * ```
 */
export function loadVariables(simulation: string): Variables {
  const variables: Variables = {};
  const fileContent = readFileSync(path.join(BASE_DATA_DIR, FILE_PATH), 'utf-8');
  const rows = parseSync(fileContent, { columns: true });

  for (const row of rows) {
    if (Object.keys(row).length > 1) {
      variables[row['variable']] = loadVariableValue(row[simulation]);
    }
  }

  return variables;
}

/**
 * Saves variables for all simulations to the variables.csv file.
 *
 * Creates a CSV file with variables as rows and simulations as columns.
 * Handles backup creation and proper formatting of different data types.
 * Date values are formatted using formatDate utility.
 *
 * @param simulations - Array of simulation objects containing variables
 *
 * @example
 * ```typescript
 * const simulations = [
 *   {
 *     name: "Conservative",
 *     enabled: true,
 *     selected: true,
 *     variables: {
 *       retirementDate: { value: new Date('2030-01-01'), type: 'date' },
 *       initialBalance: { value: 100000, type: 'number' }
 *     }
 *   },
 *   {
 *     name: "Aggressive",
 *     enabled: true,
 *     selected: false,
 *     variables: {
 *       retirementDate: { value: new Date('2025-01-01'), type: 'date' },
 *       initialBalance: { value: 150000, type: 'number' }
 *     }
 *   }
 * ];
 * saveVariables(simulations);
 * // Creates CSV:
 * // variable,Conservative,Aggressive
 * // retirementDate,2030-01-01,2025-01-01
 * // initialBalance,100000,150000
 * ```
 */
export function saveVariables(simulations: Simulations) {
  if (shouldBackup(FILE_PATH)) {
    backup(FILE_PATH);
  }
  const stream = csv.format({ headers: true });
  stream.pipe(createWriteStream(path.join(BASE_DATA_DIR, FILE_PATH)));
  stream.write(['variable', ...simulations.map((simulation) => simulation.name)]);
  const allVariables = new Set<string>();
  for (const simulation of simulations) {
    for (const variable of Object.keys(simulation.variables)) {
      allVariables.add(variable);
    }
  }
  for (const variable of [...allVariables].sort()) {
    const row: string[] = [variable];
    for (const simulation of simulations) {
      if (
        typeof simulation.variables[variable].value === 'string' ||
        typeof simulation.variables[variable].value === 'number'
      ) {
        row.push(simulation.variables[variable].value.toString());
      } else {
        row.push(formatDate(simulation.variables[variable].value as Date));
      }
    }
    stream.write(row);
  }
  stream.end();
}
