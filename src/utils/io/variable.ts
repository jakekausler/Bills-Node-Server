import { parse as parseSync } from 'csv-parse/sync';
import * as csv from 'fast-csv';
import { createWriteStream, readFileSync } from 'fs';
import { Simulations, Variables } from '../simulation/types';
import { loadVariableValue } from '../simulation/loadVariableValue';
import { formatDate } from '../date/date';
import { backup, BASE_DATA_DIR, shouldBackup } from './io';
import path from 'path';

const FILE_PATH = 'variables.csv';

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
