export type TaxProfile = {
  filingStatus: 'single' | 'mfj' | 'mfs' | 'hoh';
  state: string;
  stateTaxRate: number;
  dependents?: Dependent[];
  itemizationMode: 'standard' | 'itemized' | 'auto';
};

export type Dependent = {
  name: string;
  birthYear: number;
  relationship: 'child' | 'other';
};

export type TaxScenario = {
  name: 'currentLaw' | 'currentPolicy' | 'rising' | 'custom';
  bracketEvolution: 'tcjaExpires' | 'tcjaPermanent' | 'rateCreep' | 'custom';
  customRates?: { year: number; bracketMultiplier: number }[] | null;
};
