import { DateString } from '../../utils/date/types';

export type ActivityData = {
	id: string;
	date: DateString;
	dateIsVariable: boolean;
	dateVariable: string | null;
	name: string;
	category: string;
	amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
	amountIsVariable: boolean;
	amountVariable: string | null;
	flag: boolean;
	isTransfer: boolean;
	from: string | null;
	to: string | null;
};

export type ConsolidatedActivityData = ActivityData & {
	billId: string | null;
	firstBill: boolean;
	interestId: string | null;
	firstInterest: boolean;
	balance: number;
};
