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
  flagColor: string | null;
  isTransfer: boolean;
  from: string | null;
  to: string | null;
  balance?: number;

  // Healthcare fields
  isHealthcare?: boolean;
  healthcarePerson?: string | null;
  copayAmount?: number | null;
  coinsurancePercent?: number | null;
  countsTowardDeductible?: boolean;
  countsTowardOutOfPocket?: boolean;

  // Spending category
  spendingCategory?: string | null;
};

export type ConsolidatedActivityData = ActivityData & {
  billId: string | null;
  firstBill: boolean;
  interestId: string | null;
  firstInterest: boolean;
  balance: number;
};
