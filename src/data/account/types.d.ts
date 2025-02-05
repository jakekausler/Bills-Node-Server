import { Account } from './account';
import { Activity } from '../activity/activity';
import { ActivityData } from '../activity/types';
import { Bill } from '../bill/bill';
import { BillData } from '../bill/types';
import { InterestData } from '../interest/types';

export type AccountsAndTransfers = {
  accounts: Account[];
  transfers: Transfers;
};

export type Transfers = {
  activity: Activity[];
  bills: Bill[];
};

export type AccountsAndTransfersData = {
  accounts: AccountData[];
  transfers: TransfersData;
};

export type AccountData = {
  id: string;
  name: string;
  interests: InterestData[];
  activity: ActivityData[];
  bills: BillData[];
  hidden: boolean;
  type: string;
  pullPriority?: number;
  interestTaxRate?: number;
  withdrawalTaxRate?: number;
  earlyWithdrawlPenalty?: number;
  earlyWithdrawlDate?: Date | null;
  interestPayAccount?: string | null;
  usesRMD?: boolean;
  accountOwnerDOB?: Date | null;
  rmdAccount?: string | null;
  minimumBalance?: number | null;
  minimumPullAmount?: number | null;
  performPulls?: boolean;
};

export type TransfersData = {
  activity: ActivityData[];
  bills: BillData[];
};
