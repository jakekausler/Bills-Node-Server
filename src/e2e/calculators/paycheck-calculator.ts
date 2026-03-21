/**
 * Shadow paycheck calculator — gross-to-net pipeline.
 * Independent implementation — no engine imports.
 * Replicates logic from paycheck-processor.ts
 */

export interface PaycheckBreakdown {
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
  preTaxTotal: number;
  postTaxTotal: number;
  netPay: number;
}

export interface SimpleProfile {
  grossPay: number;
  traditional401kPercent?: number;
  traditional401kFixed?: number;
  roth401kPercent?: number;
  employerMatchPercent?: number;
  hsaFixed?: number;
  hsaEmployerAnnual?: number;
  preTaxDeductions?: number;
  postTaxDeductions?: number;
  bonusPercent?: number;
  bonusMonth?: number;
}

const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD_MFJ = 250000;

/**
 * Compute a single paycheck gross-to-net breakdown.
 * Does NOT include federal/state withholding (those are Cycle B).
 */
export function computePaycheckGrossToNet(
  grossPay: number,
  profile: SimpleProfile,
  ytdSSWages: number,
  ssWageBase: number,
  ytdMedicareWages: number,
  paychecksPerYear: number,
  isMonthlyDeductionPaycheck: boolean,
): PaycheckBreakdown {
  // Pre-tax deductions
  let traditional401k = 0;
  if (profile.traditional401kPercent) {
    traditional401k = grossPay * profile.traditional401kPercent;
  } else if (profile.traditional401kFixed) {
    traditional401k = profile.traditional401kFixed;
  }

  let roth401k = 0;
  if (profile.roth401kPercent) {
    roth401k = grossPay * profile.roth401kPercent;
  }

  let hsa = 0;
  if (profile.hsaFixed && isMonthlyDeductionPaycheck) {
    hsa = profile.hsaFixed;
  }

  let hsaEmployer = 0;
  if (profile.hsaEmployerAnnual && isMonthlyDeductionPaycheck) {
    // HSA employer is monthly too, so divide by ~24 (paychecks that are monthly-deducted)
    // For biweekly: 24 of 26 paychecks have monthly deductions
    hsaEmployer = profile.hsaEmployerAnnual / 24;
  }

  const preTaxMedical = isMonthlyDeductionPaycheck ? (profile.preTaxDeductions ?? 0) : 0;
  const preTaxTotal = traditional401k + hsa + preTaxMedical;

  // SS wages: gross minus deductions that reduce SS wages (HSA, medical, dental, vision)
  const ssWageReduction = hsa + hsaEmployer + preTaxMedical;
  const ssWages = grossPay - ssWageReduction;

  // SS tax (capped at wage base)
  const roomUnderCap = Math.max(0, ssWageBase - ytdSSWages);
  const taxableSS = Math.min(ssWages, roomUnderCap);
  const ssTax = taxableSS * SS_RATE;

  // Medicare tax
  const baseMedicare = grossPay * MEDICARE_RATE;
  const newYTDMedicare = ytdMedicareWages + grossPay;
  let additionalMedicare = 0;
  if (newYTDMedicare > ADDITIONAL_MEDICARE_THRESHOLD_MFJ) {
    const aboveThreshold = Math.min(grossPay, newYTDMedicare - ADDITIONAL_MEDICARE_THRESHOLD_MFJ);
    additionalMedicare = Math.max(0, aboveThreshold) * ADDITIONAL_MEDICARE_RATE;
  }
  const medicareTax = baseMedicare + additionalMedicare;

  // Post-tax deductions (Roth 401k + custom post-tax)
  const postTaxTotal = roth401k + (profile.postTaxDeductions ?? 0);

  // Employer match
  let employerMatch = 0;
  if (profile.employerMatchPercent) {
    const totalEmployee401k = traditional401k + roth401k;
    const maxMatch = grossPay * profile.employerMatchPercent;
    employerMatch = Math.min(maxMatch, totalEmployee401k);
  }

  // Net pay (Cycle A: no federal/state withholding)
  const netPay = grossPay - preTaxTotal - ssTax - medicareTax - postTaxTotal;

  return {
    grossPay,
    traditional401k,
    roth401k,
    employerMatch,
    hsa,
    hsaEmployer,
    ssTax,
    medicareTax,
    federalWithholding: 0,
    stateWithholding: 0,
    preTaxTotal,
    postTaxTotal,
    netPay,
  };
}

/**
 * Compute annual employer match for simple mode.
 */
export function computeAnnualEmployerMatch(
  annualGross: number,
  annualEmployee401k: number,
  matchPercent: number,
): number {
  const maxMatch = annualGross * matchPercent;
  return Math.min(maxMatch, annualEmployee401k);
}

/**
 * Compute bonus gross amount.
 */
export function computeBonusGross(
  perPaycheckGross: number,
  paychecksPerYear: number,
  bonusPercent: number,
): number {
  return perPaycheckGross * paychecksPerYear * bonusPercent;
}
