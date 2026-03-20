import { DateString } from '../../utils/date/types';
import { PaycheckProfile } from './paycheck-types';

export type BillData = {
  id: string;
  startDate: DateString;
  startDateIsVariable: boolean;
  startDateVariable: string | null;
  endDate: DateString | null;
  endDateIsVariable: boolean;
  endDateVariable: string | null;
  everyN: number;
  periods: 'day' | 'week' | 'month' | 'year';
  annualStartDate: string | null;
  annualEndDate: string | null;
  isAutomatic: boolean;
  name: string;
  category: string;
  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  amountIsVariable: boolean;
  amountVariable: string | null;
  increaseBy: number;
  increaseByIsVariable: boolean;
  increaseByVariable: string | null;
  increaseByDate: string;
  ceilingMultiple: number;
  isTransfer: boolean;
  from: string | null;
  to: string | null;
  flagColor: string | null;
  flag: boolean;

  // Healthcare fields
  isHealthcare?: boolean;
  healthcarePerson?: string | null;
  copayAmount?: number | null;
  coinsurancePercent?: number | null;
  countsTowardDeductible?: boolean;
  countsTowardOutOfPocket?: boolean;

  // Spending category
  spendingCategory?: string | null;

  // Paycheck fields
  paycheckProfile?: PaycheckProfile | null;
  taxDeductible?: boolean;
  studentLoanInterest?: boolean;
};

export type CalendarBill = BillData & {
  account: string;
  accountId: string;
  date: DateString;
};
