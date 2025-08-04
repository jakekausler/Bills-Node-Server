import { parseDate } from '../date/date';
import { DateString } from '../date/types';
import { VariableValue } from './types';
import { loadVariable } from './variable';

/**
 * Parses a string value and determines whether it represents a date or numeric amount
 *
 * The function uses the following logic:
 * 1. If the value matches the strict date pattern (YYYY-MM-DD), it's treated as a date
 * 2. If the value is a valid numeric string, it's treated as an amount
 * 3. If the value can be parsed as a date, it's treated as a date
 * 4. Otherwise, an error is thrown
 *
 * @param value - The string value to parse
 * @returns An object containing the parsed value and its type ('date' or 'amount')
 * @throws Error if the value cannot be parsed as either a date or number
 */
export function loadVariableValue(value: string): VariableValue {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  // First check if it matches the strict date pattern
  if (datePattern.test(value)) {
    return {
      value: new Date(value),
      type: 'date',
    };
  }

  // Try to parse as a number - check if the entire string is a valid number
  const parsedNumber = parseFloat(value);
  if (!isNaN(parsedNumber) && isFinite(parsedNumber) && value.trim() === parsedNumber.toString()) {
    return {
      value: parsedNumber,
      type: 'amount',
    };
  }

  // Try to parse as a date if it's not a number
  try {
    const parsedDate = new Date(value);
    if (!isNaN(parsedDate.getTime())) {
      return {
        value: parsedDate,
        type: 'date',
      };
    }
  } catch (_) {
    // Fall through to error
  }

  throw new Error(`Invalid value '${value}'`);
}

/**
 * Loads a date value either from a direct date string or from a simulation variable
 *
 * @param date - The date string to parse
 * @param dateIsVariable - Whether the date should be loaded from a variable
 * @param dateVariable - The variable name to load the date from (if dateIsVariable is true)
 * @param simulation - The simulation context for variable loading
 * @returns An object containing the resolved date, whether it was loaded from a variable, and the variable name
 * @throws Error if the date cannot be parsed and no valid variable is provided
 */
export function loadDateOrVariable(
  date: DateString,
  dateIsVariable: boolean,
  dateVariable: string | null,
  simulation: string,
): {
  date: Date;
  dateIsVariable: boolean;
  dateVariable: string | null;
} {
  let parsedDate: Date | null = null;
  let isDateVariable: boolean = dateIsVariable;
  try {
    parsedDate = parseDate(date);
  } catch (_) {
    isDateVariable = true;
  }
  if (isDateVariable && dateVariable) {
    return {
      date: loadVariable(dateVariable, simulation) as Date,
      dateIsVariable: true,
      dateVariable: dateVariable,
    };
  } else if ((isDateVariable && !dateVariable) || !parsedDate) {
    throw new Error(`Invalid date '${date}'`);
  }
  return {
    date: parsedDate,
    dateIsVariable: isDateVariable,
    dateVariable: dateVariable,
  };
}

/**
 * Loads a numeric amount either from a direct value or from a simulation variable
 *
 * Supports special fraction values like '{HALF}', '{FULL}', '-{HALF}', '-{FULL}'
 * that represent dynamic amounts calculated at runtime.
 *
 * @param amount - The amount value to parse (number or special fraction string)
 * @param amountIsVariable - Whether the amount should be loaded from a variable
 * @param amountVariable - The variable name to load the amount from (if amountIsVariable is true)
 * @param simulation - The simulation context for variable loading
 * @returns An object containing the resolved amount, whether it was loaded from a variable, and the variable name
 * @throws Error if the amount cannot be parsed and no valid variable is provided
 */
export function loadNumberOrVariable(
  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}',
  amountIsVariable: boolean,
  amountVariable: string | null,
  simulation: string,
): {
  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  amountIsVariable: boolean;
  amountVariable: string | null;
} {
  let parsedAmount: number | null = null;
  let isAmountVariable: boolean = amountIsVariable;

  // Handle special fraction values
  if (typeof amount === 'string' && (amount.includes('{HALF}') || amount.includes('{FULL}'))) {
    return {
      amount: amount as '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}',
      amountIsVariable: false,
      amountVariable: amountVariable,
    };
  }

  try {
    parsedAmount = parseFloat(amount as string);
    if (isNaN(parsedAmount)) {
      throw new Error(`Invalid amount '${amount}'`);
    }
  } catch (_) {
    isAmountVariable = true;
  }
  if (isAmountVariable && amountVariable) {
    return {
      amount: loadVariable(amountVariable, simulation) as number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}',
      amountIsVariable: true,
      amountVariable: amountVariable,
    };
  } else if ((isAmountVariable && !amountVariable) || parsedAmount === null) {
    throw new Error(
      `Invalid amount '${amount}'. AmountVariable: ${amountVariable}, parsedAmount: ${parsedAmount}, simulation: ${simulation}`,
    );
  }
  return {
    amount: parsedAmount,
    amountIsVariable: isAmountVariable,
    amountVariable: amountVariable,
  };
}
