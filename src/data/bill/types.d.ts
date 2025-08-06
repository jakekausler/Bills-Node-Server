import { DateString } from '../../utils/date/types';

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
  monteCarloSampleType: string | null;
  isTransfer: boolean;
  from: string | null;
  to: string | null;
  flagColor: string | null;
  flag: boolean;
};

export type CalendarBill = BillData & {
  account: string;
  accountId: string;
  date: DateString;
};
