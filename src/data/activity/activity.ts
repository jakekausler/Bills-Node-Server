import { formatDate } from '../../utils/date/date';
import { loadDateOrVariable, loadNumberOrVariable } from '../../utils/simulation/loadVariableValue';
import { ActivityData } from './types';
import { v4 as uuidv4 } from 'uuid';

export class Activity {
	id: string;
	name: string;
	category: string;

	flag: boolean;
	isTransfer: boolean;
	fro: string | null;
	to: string | null;

	amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
	amountIsVariable: boolean;
	amountVariable: string | null;

	date: Date;
	dateIsVariable: boolean;
	dateVariable: string | null;

	constructor(data: ActivityData, simulation: string = 'Default') {
		this.id = data.id || uuidv4();
		this.name = data.name;
		this.category = data.category;

		this.flag = data.flag || false;
		this.isTransfer = data.isTransfer || false;
		this.fro = this.isTransfer ? data.from : null;
		this.to = this.isTransfer ? data.to : null;

		const { date, dateIsVariable, dateVariable } = loadDateOrVariable(
			data.date,
			data.dateIsVariable,
			data.dateVariable,
			simulation,
		);
		this.date = date;
		this.dateIsVariable = dateIsVariable;
		this.dateVariable = dateVariable;

		const { amount, amountIsVariable, amountVariable } = loadNumberOrVariable(
			data.amount,
			data.amountIsVariable,
			data.amountVariable,
			simulation,
		);
		this.amount = amount;
		this.amountIsVariable = amountIsVariable;
		this.amountVariable = amountVariable;
	}

	serialize(): ActivityData {
		return {
			id: this.id,
			name: this.name,
			category: this.category,
			flag: this.flag,
			isTransfer: this.isTransfer,
			from: this.fro,
			to: this.to,
			amount: this.amount,
			amountIsVariable: this.amountIsVariable,
			amountVariable: this.amountVariable,
			date: formatDate(this.date),
			dateIsVariable: this.dateIsVariable,
			dateVariable: this.dateVariable,
		};
	}
}
