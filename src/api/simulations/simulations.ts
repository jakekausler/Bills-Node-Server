import { Request } from 'express';
import { loadSimulations, saveSimulations } from '../../utils/io/simulation';
import { formatDate } from '../../utils/date/date';

/**
 * Retrieves all simulation configurations with formatted variables.
 *
 * Date variables are formatted as strings using formatDate utility.
 * Other variable types (number, string, boolean) are returned as-is.
 *
 * @param _request - Express request object (unused)
 * @returns Array of simulation objects with formatted variables
 *
 * @example
 * ```typescript
 * const simulations = getSimulations(request);
 * // Returns: [
 * //   {
 * //     name: "Base Scenario",
 * //     enabled: true,
 * //     selected: true,
 * //     variables: {
 * //       retirementDate: { value: "2030-01-01", type: "date" },
 * //       initialBalance: { value: 100000, type: "number" }
 * //     }
 * //   }
 * // ]
 * ```
 */
export function getSimulations(_request: Request) {
  return loadSimulations().map((simulation) => ({
    name: simulation.name,
    enabled: simulation.enabled,
    selected: simulation.selected,
    variables: Object.fromEntries(
      Object.entries(simulation.variables).map(([key, value]) => [
        key,
        {
          value: value.type === 'date' ? formatDate(value.value as Date) : value.value,
          type: value.type,
        },
      ]),
    ),
  }));
}

/**
 * Updates simulation configurations with new data.
 *
 * Saves the provided simulation data to storage and returns the saved data.
 *
 * @param request - Express request object containing simulation data
 * @returns The updated simulation data that was saved
 *
 * @example
 * ```typescript
 * // Request body should contain:
 * // {
 * //   data: [
 * //     {
 * //       name: "Updated Scenario",
 * //       enabled: true,
 * //       selected: true,
 * //       variables: {
 * //         retirementDate: { value: new Date('2030-01-01'), type: "date" },
 * //         initialBalance: { value: 200000, type: "number" }
 * //       }
 * //     }
 * //   ]
 * // }
 *
 * const updatedSimulations = updateSimulations(request);
 * ```
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
  saveSimulations(simulations);
  return simulations;
}
