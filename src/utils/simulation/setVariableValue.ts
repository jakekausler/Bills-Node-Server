import { parseDate } from '../date/date';
import { DateString } from '../date/types';
import { VariableValue } from './types';

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
