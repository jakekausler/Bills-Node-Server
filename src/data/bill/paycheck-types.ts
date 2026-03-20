/**
 * Paycheck Profile and related types for employer income configuration
 */

export type ContributionConfig = {
  type: 'percent' | 'fixed';
  value: number;
  destinationAccount: string;
  frequency?: DeductionFrequency;
};

export type EmployerMatchConfig = {
  mode: 'simple' | 'tiered' | 'fixed';
  simplePercent?: number;
  tiers?: { matchPercent: number; upToPercent: number }[];
  fixedAmount?: number;
  destinationAccount: string;
};

export type PaycheckDeduction = {
  label: string;
  amount: number;
  type: 'preTax' | 'postTax';
  frequency?: DeductionFrequency;
  inflationVariable?: string;
  reducesSSWages?: boolean;
  destinationAccount?: string;
};

export type BonusConfig = {
  percent: number;
  month: number;
  subjectTo401k?: boolean;
};

export type W4Config = {
  filingStatus: 'single' | 'mfj' | 'mfs' | 'hoh';
  extraWithholding?: number;
  multipleJobs?: boolean;
};

export type DeductionFrequency = 'perPaycheck' | 'monthly' | 'annual';

export type PaycheckProfile = {
  grossPay: number;
  traditional401k?: ContributionConfig;
  roth401k?: ContributionConfig;
  employerMatch?: EmployerMatchConfig;
  hsa?: ContributionConfig;
  hsaEmployerContribution?: number;  // annual amount, deposits to hsa.destinationAccount
  deductions?: PaycheckDeduction[];
  bonus?: BonusConfig;
  w4?: W4Config;
};

/**
 * PaycheckDetails on Activity - breakdown of a single paycheck
 */
export type PaycheckDetails = {
  grossPay: number;
  traditional401k: number;
  roth401k: number;
  employerMatch: number;
  hsa: number;
  hsaEmployer: number;
  ssTax: number;
  medicareTax: number;
  preTaxDeductions: { label: string; amount: number }[];
  postTaxDeductions: { label: string; amount: number }[];
  netPay: number;
  parentPaycheckId?: string;
};
