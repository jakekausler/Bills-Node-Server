export type TaxProfile = {
  filingStatus: 'single' | 'mfj' | 'mfs' | 'hoh';
  state: string;
  stateTaxRate: number;
  stateStandardDeduction?: number; // Per-period standard deduction (e.g., biweekly portion)
  stateAllowances?: number; // Number of allowances claimed on state W-4
  dependents?: Dependent[];
  itemizationMode: 'standard' | 'itemized' | 'auto';
};

export type Dependent = {
  name: string;
  birthYear: number;
  relationship: 'child' | 'parent' | 'other';
};

export type TaxScenario = {
  name: 'currentLaw' | 'currentPolicy' | 'rising' | 'custom';
  bracketEvolution: 'tcjaExpires' | 'tcjaPermanent' | 'rateCreep' | 'custom';
  customRates?: { year: number; bracketMultiplier: number }[] | null;
};
