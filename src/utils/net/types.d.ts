import { AccountsAndTransfers } from '../../data/account/types';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';

export type DefaultData = {
  defaultSimulation: string;
  defaultStartDate: Date;
  defaultEndDate: Date;
  defaultSelectedAccounts: string[];
  defaultSelectedSimulations: string[];
  defaultIsTransfer: boolean;
  defaultAsActivity: boolean;
  defaultSkip: boolean;
  defaultPath: string[];
};

export type PartialDefaultData = Partial<DefaultData>;

export type Options = {
  overrideStartDateForCalculations?: Date;
  updateCache?: boolean;
};

export type RequestData<T = undefined> = {
  simulation: string;
  startDate: Date;
  endDate: Date;
  selectedAccounts: string[];
  selectedSimulations: string[];
  isTransfer: boolean;
  skip: boolean;
  accountsAndTransfers: AccountsAndTransfers;
  asActivity: boolean;
  data: T;
  path: string[];
  socialSecurities: SocialSecurity[];
  pensions: Pension[];
  options: Options;
};
