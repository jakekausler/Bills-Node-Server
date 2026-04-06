/**
 * Premium rate entry for term life insurance.
 * Rates are per $1000 of coverage per month.
 */
export interface TermRateEntry {
  ageMin: number;
  ageMax: number;
  gender: 'male' | 'female';
  termYears: number; // 10, 15, 20, 30
  ratePerThousandMonthly: number;
}

/**
 * Premium rate entry for whole life insurance.
 * Rates are per $1000 of coverage per month.
 */
export interface WholeRateEntry {
  ageMin: number;
  ageMax: number;
  gender: 'male' | 'female';
  ratePerThousandMonthly: number;
}

/**
 * Complete rate table for term and whole life insurance premiums.
 * Loaded from lifeInsurancePremiumRates.json.
 */
export interface LifeInsurancePremiumRates {
  term: TermRateEntry[];
  whole: WholeRateEntry[];
}
