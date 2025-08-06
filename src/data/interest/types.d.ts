import { DateString } from '../../utils/date/types';

export type InterestData = {
  id?: string;
  apr: number;
  aprIsVariable: boolean;
  aprVariable: string | null;
  monteCarloSampleType: string | null;
  compounded: 'day' | 'week' | 'month' | 'year';
  applicableDate: DateString;
  applicableDateIsVariable: boolean;
  applicableDateVariable: string | null;
};
