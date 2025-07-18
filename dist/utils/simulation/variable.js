import { parseDate } from '../date/date';
import { loadSimulations } from '../io/simulation';
export function loadVariable(variable, simulation) {
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
                return parseDate(variables[variable].value);
            }
            else {
                return variables[variable].value;
            }
        }
        else if (variables[variable].type === 'amount') {
            if (typeof variables[variable].value === 'string') {
                return parseFloat(variables[variable].value);
            }
            else {
                return variables[variable].value;
            }
        }
        else {
            throw new Error(`Invalid variable type '${variables[variable].type}'`);
        }
    }
    throw new Error(`Invalid variable '${variable}'`);
}
