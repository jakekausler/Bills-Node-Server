import { DateString } from '../../utils/date/types';
import { PaycheckDetails, PaycheckProfile } from '../bill/paycheck-types';

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

  // Paycheck fields
  paycheckDetails?: PaycheckDetails | null;
  isPaycheckActivity?: boolean;
  paycheckProfile?: PaycheckProfile | null;

  // Investment fields
  investmentActivityType?: 'buy' | 'sell' | 'dividend' | 'fee' | null;
  investmentActions?: { symbol: string; shares: number; pricePerShare: number; totalPrice: number }[];
  cashBalance?: number;
  investmentValue?: number;
  costBasis?: number;
  unrealizedGain?: number;
  unrealizedGainPercent?: number;
};

export type ConsolidatedActivityData = ActivityData & {
  billId: string | null;
  firstBill: boolean;
  interestId: string | null;
  firstInterest: boolean;
  spendingTrackerId: string | null;
  firstSpendingTracker: boolean;
  balance: number;
  cashBalance: number;
  investmentValue: number;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
};
