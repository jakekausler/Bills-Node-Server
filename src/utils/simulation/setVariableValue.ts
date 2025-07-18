import { parseDate } from '../date/date';
import { DateString } from '../date/types';
import { VariableValue } from './types';

/**
 * Sets and normalizes a variable value, ensuring proper type conversion
 * 
 * This function processes variable values to ensure they are in the correct
 * format. It handles conversion of string amounts to numbers and string dates
 * to Date objects while preserving the original type information.
 * 
 * @param value - The variable value to set and normalize
 * @returns The normalized variable value with proper type conversion
 * @throws Error if the value type is invalid
 */
export function setVariableValue(value: VariableValue): VariableValue {
  if (value.type === 'amount') {
    if (typeof value.value === 'string') {
      return {
        value: parseFloat(value.value),
        type: 'amount',
      };
    } else {
      return {
        value: value.value,
        type: 'amount',
      };
    }
  } else if (value.type === 'date') {
    return {
      value: parseDate(value.value as DateString),
      type: 'date',
    };
  } else {
    throw new Error(`Invalid value type: ${value}`);
  }
}
