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
