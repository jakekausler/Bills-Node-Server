import { PaycheckProfile } from '../../data/bill/paycheck-types';
import { PaycheckProcessor } from './paycheck-processor';
import { PaycheckStateTracker } from './paycheck-state-tracker';
import { ContributionLimitManager } from './contribution-limit-manager';
import { WithholdingCalculator, BracketLookup } from './withholding-calculator';
import type { TaxProfile } from './tax-profile-types';
import type { PaycheckResult, FilingStatus, MCRateGetter, MonteCarloSampleType } from './types';
import { computeAnnualFederalTax } from './bracket-calculator';

/**
 * Parameters for computing net pay from a gross paycheck.
 * This encapsulates the setup and processing of a single paycheck.
 */
export interface ComputeNetPayParams {
  /** Gross pay amount for this paycheck */
  grossPay: number;

  /** Paycheck profile with contribution/deduction configs */
  profile: PaycheckProfile;

  /** Bill name (used for paycheck counting) */
  billName: string;

  /** Date of the paycheck */
  date: Date;

  /** DOB of account owner (for contribution limits and FICA tracking) */
  accountOwnerDOB: Date | null;

  /** Expected number of paychecks per year (26 for biweekly, 12 for monthly, etc.) */
  paychecksPerYear: number;

  /** Current filing status (may be overridden by mortality manager) */
  filingStatus: FilingStatus;

  /** Bracket inflation rate for tax calculations */
  bracketInflationRate: number;

  /** Annual Social Security wage cap for this year */
  ssWageBaseCap: number;

  /** Optional function to get MC-sampled rates (MCRateGetter type from Calculator) */
  mcRateGetter?: MCRateGetter | null;

  /** Optional existing PaycheckProcessor to reuse (for calculator). If not provided, a fresh one is created. */
  processor?: PaycheckProcessor;
}

/**
 * Computes net pay from gross pay by setting up all the tax and contribution infrastructure.
 * This utility encapsulates the setup logic that was previously inline in the calculator.
 *
 * @param params - Configuration for net pay computation
 * @returns PaycheckResult with full breakdown of taxes and deductions
 */
export function computeNetPay(params: ComputeNetPayParams): PaycheckResult {
  const {
    grossPay,
    profile,
    billName,
    date,
    accountOwnerDOB,
    paychecksPerYear,
    filingStatus,
    bracketInflationRate,
    ssWageBaseCap,
    mcRateGetter,
  } = params;

  const year = date.getUTCFullYear();
  const additionalMedicareThreshold = filingStatus === 'mfj' ? 250000 : 200000;

  // Convert MCRateGetter (which takes type + year) to string-based function for processPaycheck
  const mcRateGetterFunc: ((type: string) => number | undefined) | undefined = mcRateGetter
    ? (type: string) => {
        const result = mcRateGetter(type as MonteCarloSampleType, year);
        return result ?? undefined;
      }
    : undefined;

  // Get standard deduction for this year and filing status
  const bracketDataForYear = computeAnnualFederalTax(
    0,
    0,
    filingStatus,
    year,
    bracketInflationRate,
    mcRateGetter,
  );
  const standardDeduction = bracketDataForYear.standardDeduction;

  // Create bracket lookup callback
  const bracketLookup: BracketLookup = (
    taxableIncome: number,
    fs: FilingStatus,
    yr: number,
  ): number => {
    const result = computeAnnualFederalTax(
      taxableIncome,
      0,
      fs,
      yr,
      bracketInflationRate,
      mcRateGetter,
    );
    return result.tax;
  };

  // Create tax profile for withholding
  const taxProfile: TaxProfile = {
    filingStatus,
    state: 'NC',
    stateTaxRate: 0.0409,
    stateStandardDeduction: 490.38,
    stateAllowances: 0,
    itemizationMode: 'standard' as const,
  };

  // Use provided processor or create fresh one
  const processor =
    params.processor ??
    createFreshProcessor(
      new PaycheckStateTracker(null, 0),
      new ContributionLimitManager(null, 0),
    );

  return processor.processPaycheck(
    grossPay,
    profile,
    billName,
    date,
    accountOwnerDOB,
    ssWageBaseCap,
    additionalMedicareThreshold,
    paychecksPerYear,
    mcRateGetterFunc,
    taxProfile,
    standardDeduction,
    bracketLookup,
    bracketInflationRate,
    mcRateGetter,
  );
}

/**
 * Creates a fresh PaycheckProcessor with default dependencies.
 * Used when a processor is not provided to the computeNetPay function.
 */
function createFreshProcessor(
  stateTracker: PaycheckStateTracker,
  limitManager: ContributionLimitManager,
): PaycheckProcessor {
  const withholding = new WithholdingCalculator(null, 0);
  return new PaycheckProcessor(stateTracker, limitManager, withholding, null, null, 0, null);
}
