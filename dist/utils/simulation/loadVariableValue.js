import { parseDate } from '../date/date';
import { loadVariable } from './variable';
export function loadVariableValue(value) {
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
    }
    catch (_) {
        try {
            return {
                value: new Date(value),
                type: 'date',
            };
        }
        catch (_) {
            throw new Error(`Invalid value '${value}'`);
        }
    }
}
export function loadDateOrVariable(date, dateIsVariable, dateVariable, simulation) {
    let parsedDate = null;
    let isDateVariable = dateIsVariable;
    try {
        parsedDate = parseDate(date);
    }
    catch (_) {
        isDateVariable = true;
    }
    if (isDateVariable && dateVariable) {
        return {
            date: loadVariable(dateVariable, simulation),
            dateIsVariable: true,
            dateVariable: dateVariable,
        };
    }
    else if ((isDateVariable && !dateVariable) || !parsedDate) {
        throw new Error(`Invalid date '${date}'`);
    }
    return {
        date: parsedDate,
        dateIsVariable: isDateVariable,
        dateVariable: dateVariable,
    };
}
export function loadNumberOrVariable(amount, amountIsVariable, amountVariable, simulation) {
    let parsedAmount = null;
    let isAmountVariable = amountIsVariable;
    try {
        parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            throw new Error(`Invalid amount '${amount}'`);
        }
    }
    catch (_) {
        isAmountVariable = true;
    }
    if (isAmountVariable && amountVariable) {
        return {
            amount: loadVariable(amountVariable, simulation),
            amountIsVariable: true,
            amountVariable: amountVariable,
        };
    }
    else if ((isAmountVariable && !amountVariable) || parsedAmount === null) {
        throw new Error(`Invalid amount '${amount}'. AmountVariable: ${amountVariable}, parsedAmount: ${parsedAmount}, simulation: ${simulation}`);
    }
    return {
        amount: parsedAmount,
        amountIsVariable: isAmountVariable,
        amountVariable: amountVariable,
    };
}
