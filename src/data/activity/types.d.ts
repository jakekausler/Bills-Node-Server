import { DateString } from '../../utils/date/types';
import { InvestmentActivityData } from '../investment/types';

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
  flagColor: string | null;
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
  investmentValue: number;
  investmentActivity: InvestmentActivityData | null;
  stockValues: Record<string, number>;
  stockAmounts: Record<string, number>;
};
