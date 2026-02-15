import { DateString } from '../date/types';

type UsedVariable = {
  type: 'activity' | 'bill' | 'transfer' | 'interest' | 'socialSecurity' | 'pension' | 'spendingTracker';
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
