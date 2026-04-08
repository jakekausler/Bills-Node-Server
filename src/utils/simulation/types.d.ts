import { DateString } from '../date/types';

type UsedVariable = {
  type: 'activity' | 'bill' | 'transfer' | 'interest' | 'socialSecurity' | 'pension' | 'spendingTracker' | 'monteCarlo';
  name: string;
  account?: string;
  from?: string;
  to?: string;
  date?: string;
};

export type UsedVariables = {
  [key: string]: UsedVariable[];
};

export type Simulations = Simulation[];

export type Simulation = {
  name: string;
  enabled: boolean;
  selected: boolean;
  variables: Variables;
  rateOverrides?: Record<string, number>;
  systemVariableOverrides?: Record<string, string>;
};

export type Variables = Record<string, VariableValue>;

export type VariableValue =
  | {
      type: 'amount';
      value: string | number;
    }
  | {
      type: 'date';
      value: DateString | Date;
    };
