export interface RetirementAge {
  years: number;
  months: number;
  days: number;
}

export interface PersonConfig {
  name: string;
  gender: 'male' | 'female';
  birthDate: string; // YYYY-MM-DD
  retirementAge: RetirementAge;
  ssStartAge: number; // integer years
}
