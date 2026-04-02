import { load, save } from './io';

const TAX_PROFILE_FILE = 'taxProfile.json';

export interface TaxProfileDependent {
  name: string;
  birthYear: number;
  relationship: 'child' | 'parent' | 'other';
}

export interface TaxProfile {
  filingStatus: 'single' | 'mfj' | 'mfs' | 'hoh';
  state: string;
  stateTaxRate: number;
  stateStandardDeduction: number;
  stateAllowances: number;
  dependents: TaxProfileDependent[];
  itemizationMode: 'standard' | 'itemized' | 'auto';
}

const DEFAULT_TAX_PROFILE: TaxProfile = {
  filingStatus: 'mfj',
  state: 'NC',
  stateTaxRate: 0.0409,
  stateStandardDeduction: 490.38,
  stateAllowances: 0,
  dependents: [],
  itemizationMode: 'auto',
};

export function loadTaxProfile(): TaxProfile {
  try {
    return load<TaxProfile>(TAX_PROFILE_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_TAX_PROFILE;
    }
    throw error;
  }
}

export function saveTaxProfile(profile: TaxProfile): void {
  save(profile, TAX_PROFILE_FILE);
}
