/**
 * Paycheck Profile and related types for employer income configuration
 */

export type ContributionConfig = {
  type: 'percent' | 'fixed';
  value: number;
  destinationAccount: string;
  frequency?: DeductionFrequency;
  increaseBy?: number;
  increaseByIsVariable?: boolean;
  increaseByVariable?: string | null;
};

export type EmployerMatchConfig = {
  mode: 'simple' | 'tiered' | 'fixed';
  simplePercent?: number;
  tiers?: { matchPercent: number; upToPercent: number }[];
  fixedAmount?: number;
  destinationAccount: string;
  increaseBy?: number;
  increaseByIsVariable?: boolean;
  increaseByVariable?: string | null;
};

export type PaycheckDeduction = {
  label: string;
  amount: number;
  type: 'preTax' | 'postTax';
  frequency?: DeductionFrequency;
  increaseBy?: number;
  increaseByIsVariable?: boolean;
  increaseByVariable?: string | null;
  reducesSSWages?: boolean;
  destinationAccount?: string;
  imputed?: boolean; // true = amount is added to gross and deducted back (nets to $0 cash, affects taxable wages)
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

export type JobLossConfig = {
  enabled: boolean;
  scaleFactor?: number; // default 0.5
};

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
  jobLoss?: JobLossConfig;
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
  federalWithholding: number;
  stateWithholding: number;
  preTaxDeductions: { label: string; amount: number }[];
  postTaxDeductions: { label: string; amount: number }[];
  netPay: number;
  parentPaycheckId?: string;
};
