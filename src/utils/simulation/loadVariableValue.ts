import { parseDate } from '../date/date';
import { DateString } from '../date/types';
import { VariableValue } from './types';
import { loadVariable } from './variable';

export function loadVariableValue(value: string): VariableValue {
	const datePattern = /^\d{4}-\d{2}-\d{2}$/;
	try {
		if (datePattern.test(value)) {
			return {
				value: new Date(value),
				type: 'date',
			};
		}
		return {
			value: parseFloat(value),
			type: 'amount',
		};
	} catch (_) {
		try {
			return {
				value: new Date(value),
				type: 'date',
			};
		} catch (_) {
			throw new Error(`Invalid value '${value}'`);
		}
	}
}

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
