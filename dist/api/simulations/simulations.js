import { getData } from '../../utils/net/request';
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
export function getSimulations(_request) {
    return loadSimulations().map((simulation) => ({
        name: simulation.name,
        enabled: simulation.enabled,
        selected: simulation.selected,
        variables: Object.fromEntries(Object.entries(simulation.variables).map(([key, value]) => [
            key,
            {
                value: value.type === 'date' ? formatDate(value.value) : value.value,
                type: value.type,
            },
        ])),
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
export function updateSimulations(request) {
    const data = getData(request);
    saveSimulations(data.data);
    return data.data;
}
