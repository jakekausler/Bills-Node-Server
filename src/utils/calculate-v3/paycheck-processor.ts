import { PaycheckProfile, EmployerMatchConfig } from '../../data/bill/paycheck-types';
import { PaycheckResult } from './types';
import { PaycheckStateTracker } from './paycheck-state-tracker';
import { ContributionLimitManager } from './contribution-limit-manager';
import { WithholdingCalculator, BracketLookup } from './withholding-calculator';
import { TaxManager } from './tax-manager';
import type { TaxProfile } from './tax-profile-types';
import type { DebugLogger } from './debug-logger';
import { JobLossManager } from './job-loss-manager';

/**
 * Create an empty paycheck result (used when paychecks are suppressed during unemployment)
 */
export function createEmptyPaycheckResult(): PaycheckResult {
  return {
    netPay: 0,
    grossPay: 0,
    traditional401k: 0,
    roth401k: 0,
    employerMatch: 0,
    hsa: 0,
    hsaEmployer: 0,
    ssTax: 0,
    medicareTax: 0,
    federalWithholding: 0,
    stateWithholding: 0,
    preTaxDeductions: [],
    postTaxDeductions: [],
    depositActivities: [],
  };
}

/**
 * Processes individual paychecks, computing net pay, taxes, and retirement contributions.
 */
export class PaycheckProcessor {
  private paycheckStateTracker: PaycheckStateTracker;
  private contributionLimitManager: ContributionLimitManager;
  private withholdingCalculator: WithholdingCalculator | null;
  private taxManager: TaxManager | null;
  private jobLossManager: JobLossManager | null;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(
    paycheckStateTracker: PaycheckStateTracker,
    contributionLimitManager: ContributionLimitManager,
    withholdingCalculator?: WithholdingCalculator | null,
    taxManager?: TaxManager | null,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
    jobLossManager?: JobLossManager | null,
  ) {
    this.paycheckStateTracker = paycheckStateTracker;
    this.contributionLimitManager = contributionLimitManager;
    this.withholdingCalculator = withholdingCalculator ?? null;
    this.taxManager = taxManager ?? null;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.jobLossManager = jobLossManager ?? null;
  }

  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, {
      component: 'paycheck-processor',
      event,
      ...(this.currentDate ? { ts: this.currentDate } : {}),
      ...data,
    });
  }

  /**
   * Process a single paycheck and return the breakdown of deductions, taxes, and deposits.
   *
   * @param grossPay - Gross pay amount for this paycheck
   * @param profile - Paycheck profile with contribution/deduction configs
   * @param billName - Bill name (for paycheck counting)
   * @param date - Paycheck date
   * @param accountOwnerDOB - DOB of account owner (for contribution limits and FICA tracking)
   * @param ssWageBaseCap - Annual Social Security wage cap for this year
   * @param additionalMedicareThreshold - Additional Medicare tax threshold (200k single / 250k MFJ)
   * @param paychecksPerYear - Expected number of paychecks per year (26 for biweekly, 12 for monthly, etc.)
   * @param mcRateGetter - Optional function to get MC-sampled rates
   * @param taxProfile - Optional tax profile for withholding calculations
   * @param standardDeduction - Optional standard deduction amount
   * @param bracketLookup - Optional callback to compute federal tax from taxable income
   */
  processPaycheck(
    grossPay: number,
    profile: PaycheckProfile,
    billName: string,
    date: Date,
    accountOwnerDOB: Date | null,
    ssWageBaseCap: number,
    additionalMedicareThreshold: number,
    paychecksPerYear: number,
    mcRateGetter?: ((type: string) => number | undefined),
    taxProfile?: TaxProfile | null,
    standardDeduction?: number,
    bracketLookup?: BracketLookup,
  ): PaycheckResult {
    // Check for unemployment and skip paycheck if unemployed
    if (this.jobLossManager?.isUnemployed(billName, date)) {
      this.log('paycheck-suppressed-unemployment', { billName, date: date.toISOString() });
      return createEmptyPaycheckResult();
    }

    const year = date.getUTCFullYear();
    const yearMonth = `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const paycheckIndex = this.paycheckStateTracker.getAndIncrementPaycheckCount(billName, yearMonth);
    // Determine if first paycheck of year (January and paycheckIndex === 0 for first Jan paycheck)
    const isFirstPaycheckOfYear = date.getUTCMonth() === 0 && paycheckIndex === 0;

    const preTaxDeductions: { label: string; amount: number }[] = [];
    const postTaxDeductions: { label: string; amount: number }[] = [];
    const depositActivities: { accountId: string; amount: number; label: string }[] = [];

    let totalPreTax = 0;
    let totalPreTaxForWithholding = 0;
    let traditional401k = 0;
    let roth401k = 0;
    let hsa = 0;
    let hsaEmployer = 0;
    let employerMatch = 0;

    // Step 1: Pre-tax deductions
    // Traditional 401k
    if (profile.traditional401k) {
      const freq = profile.traditional401k.frequency ?? 'perPaycheck';
      if (this.paycheckStateTracker.shouldApplyDeduction(freq, paycheckIndex, isFirstPaycheckOfYear)) {
        let amount401k =
          profile.traditional401k.type === 'percent'
            ? grossPay * profile.traditional401k.value
            : profile.traditional401k.value;
        // Cap via ContributionLimitManager
        const mcRatio = mcRateGetter ? mcRateGetter('401k_limit_change') : undefined;
        const remaining = this.contributionLimitManager.getRemainingLimit(
          accountOwnerDOB,
          year,
          '401k',
          mcRatio,
        );
        amount401k = Math.min(amount401k, remaining);
        if (amount401k > 0) {
          this.contributionLimitManager.recordContribution(accountOwnerDOB, year, '401k', amount401k);
          traditional401k = amount401k;
          totalPreTax += amount401k;
          totalPreTaxForWithholding += amount401k;
          depositActivities.push({
            accountId: profile.traditional401k.destinationAccount,
            amount: amount401k,
            label: 'Traditional 401k Contribution',
          });
          this.log('traditional401k-deducted', { amount: amount401k, capped: amount401k < (profile.traditional401k.type === 'percent' ? grossPay * profile.traditional401k.value : profile.traditional401k.value) });
        }
      }
    }

    // HSA employee
    if (profile.hsa) {
      const freq = profile.hsa.frequency ?? 'perPaycheck';
      if (this.paycheckStateTracker.shouldApplyDeduction(freq, paycheckIndex, isFirstPaycheckOfYear)) {
        let hsaAmount =
          profile.hsa.type === 'percent' ? grossPay * profile.hsa.value : profile.hsa.value;
        const mcRatio = mcRateGetter ? mcRateGetter('hsa_limit_change') : undefined;
        const remaining = this.contributionLimitManager.getRemainingLimit(
          accountOwnerDOB,
          year,
          'hsa',
          mcRatio,
        );
        hsaAmount = Math.min(hsaAmount, remaining);
        if (hsaAmount > 0) {
          this.contributionLimitManager.recordContribution(accountOwnerDOB, year, 'hsa', hsaAmount);
          hsa = hsaAmount;
          totalPreTax += hsaAmount;
          totalPreTaxForWithholding += hsaAmount;
          this.log('hsa-employee-deducted', { amount: hsaAmount });
          // HSA deposit handled below (combined with employer)
        }
      }
    }

    // HSA employer contribution (pro-rated per paycheck)
    // NOTE: Employer HSA contribution does NOT reduce net pay or SS wages (employer pays separately)
    if (profile.hsaEmployerContribution && profile.hsaEmployerContribution > 0) {
      hsaEmployer = profile.hsaEmployerContribution / paychecksPerYear;
      // Cap employer HSA to remaining limit
      const hsaRemaining = this.contributionLimitManager.getRemainingLimit(accountOwnerDOB, year, 'hsa');
      hsaEmployer = Math.min(hsaEmployer, hsaRemaining);
      if (hsaEmployer > 0) {
        this.contributionLimitManager.recordContribution(accountOwnerDOB, year, 'hsa', hsaEmployer);
      }
      this.log('hsa-employer-added', { amount: hsaEmployer, annual: profile.hsaEmployerContribution, paychecksPerYear });
      // HSA employer contributions reduce federal/state taxable wages (Section 125/223)
      totalPreTaxForWithholding += hsaEmployer;
    }

    // HSA deposit (employee + employer combined)
    if ((hsa > 0 || hsaEmployer > 0) && profile.hsa) {
      depositActivities.push({
        accountId: profile.hsa.destinationAccount,
        amount: hsa + hsaEmployer,
        label: 'HSA Contribution',
      });
    }

    // Pre-tax custom deductions
    if (profile.deductions) {
      for (const ded of profile.deductions) {
        if (ded.type === 'preTax') {
          const freq = ded.frequency ?? 'perPaycheck';
          if (this.paycheckStateTracker.shouldApplyDeduction(freq, paycheckIndex, isFirstPaycheckOfYear)) {
            totalPreTax += ded.amount;
            if (!ded.imputed) {
              totalPreTaxForWithholding += ded.amount;
            }
            preTaxDeductions.push({ label: ded.label, amount: ded.amount });
            if (ded.destinationAccount) {
              depositActivities.push({
                accountId: ded.destinationAccount,
                amount: ded.amount,
                label: ded.label,
              });
            }
            this.log('pretax-deduction-applied', { label: ded.label, amount: ded.amount });
          }
        }
      }
    }

    // Step 2: Compute SS wages
    // Note: 401k contributions do NOT reduce SS wages (they're FICA wages)
    // Only certain pre-tax deductions like HSA reduce SS wages (employer HSA does NOT reduce SS wages)
    let ssWageReduction = 0;
    // HSA reduces SS wages (employee contribution only, not employer)
    if (hsa > 0) ssWageReduction += hsa;
    // Check custom deductions with reducesSSWages flag
    if (profile.deductions) {
      for (const ded of profile.deductions) {
        if (ded.type === 'preTax' && ded.reducesSSWages) {
          ssWageReduction += ded.amount;
        }
      }
    }
    const ssWages = grossPay - ssWageReduction;

    // Step 3: Compute FICA
    // NOTE: personKey must match the format used in ContributionLimitManager.createPersonKey()
    const personKey = accountOwnerDOB ? accountOwnerDOB.getTime().toString() : 'unknown';

    // SS Tax: 6.2% of SS wages, capped at annual wage base
    const taxableSS = this.paycheckStateTracker.addSSWages(personKey, year, ssWages, ssWageBaseCap);
    const ssTax = taxableSS * 0.062;

    // Medicare Tax: 1.45% + additional 0.9% above threshold
    const medicareResult = this.paycheckStateTracker.addMedicareWages(
      personKey,
      year,
      grossPay,
      additionalMedicareThreshold,
    );
    const baseMedicare = grossPay * 0.0145;
    const additionalMedicare = medicareResult.wagesAboveThreshold * 0.009;
    const medicareTax = baseMedicare + additionalMedicare;

    this.log('fica-computed', {
      ssWages,
      taxableSS,
      ssTax,
      medicareWages: grossPay,
      medicareTax,
    });

    // Step 4b: Federal withholding
    let federalWithholding = 0;
    if (this.withholdingCalculator && taxProfile && standardDeduction !== undefined && standardDeduction !== null && bracketLookup) {
      const taxableWagesPerPeriod = grossPay - totalPreTaxForWithholding; // gross minus pre-tax deductions
      federalWithholding = this.withholdingCalculator.computeFederalWithholding(
        taxableWagesPerPeriod,
        paychecksPerYear,
        taxProfile.filingStatus,
        profile.w4,
        date.getUTCFullYear(),
        standardDeduction,
        bracketLookup,
      );
    }

    // Step 4c: State withholding (NC formula: apply rate to wages minus standard deduction and allowances, round to nearest dollar)
    let stateWithholding = 0;
    if (taxProfile) {
      const stateWages = grossPay - totalPreTaxForWithholding;
      const stateDeduction = (taxProfile.stateStandardDeduction ?? 0) + (taxProfile.stateAllowances ?? 0) * 96.15;
      const netStateWages = Math.max(0, stateWages - stateDeduction);
      stateWithholding = Math.round(netStateWages * taxProfile.stateTaxRate);
    }

    this.log('withholding-computed', {
      federalWithholding,
      stateWithholding,
      taxableWagesPerPeriod: grossPay - totalPreTax,
    });

    // Step 5: Post-tax deductions
    let totalPostTax = 0;

    // Roth 401k (post-tax — does NOT reduce taxable income)
    if (profile.roth401k) {
      const freq = profile.roth401k.frequency ?? 'perPaycheck';
      if (this.paycheckStateTracker.shouldApplyDeduction(freq, paycheckIndex, isFirstPaycheckOfYear)) {
        let roth401kAmount =
          profile.roth401k.type === 'percent' ? grossPay * profile.roth401k.value : profile.roth401k.value;
        // Roth 401k shares the same 402(g) limit as traditional 401k
        const mcRatio = mcRateGetter ? mcRateGetter('401k_limit_change') : undefined;
        const remaining = this.contributionLimitManager.getRemainingLimit(
          accountOwnerDOB,
          year,
          '401k',
          mcRatio,
        );
        roth401kAmount = Math.min(roth401kAmount, remaining);
        if (roth401kAmount > 0) {
          this.contributionLimitManager.recordContribution(accountOwnerDOB, year, '401k', roth401kAmount);
          roth401k = roth401kAmount;
          totalPostTax += roth401kAmount;
          depositActivities.push({
            accountId: profile.roth401k.destinationAccount,
            amount: roth401kAmount,
            label: 'Roth 401k Contribution',
          });
          this.log('roth401k-deducted', { amount: roth401kAmount });
        }
      }
    }

    // Post-tax custom deductions
    if (profile.deductions) {
      for (const ded of profile.deductions) {
        if (ded.type === 'postTax') {
          const freq = ded.frequency ?? 'perPaycheck';
          if (this.paycheckStateTracker.shouldApplyDeduction(freq, paycheckIndex, isFirstPaycheckOfYear)) {
            totalPostTax += ded.amount;
            postTaxDeductions.push({ label: ded.label, amount: ded.amount });
            if (ded.destinationAccount) {
              depositActivities.push({
                accountId: ded.destinationAccount,
                amount: ded.amount,
                label: ded.label,
              });
            }
            this.log('posttax-deduction-applied', { label: ded.label, amount: ded.amount });
          }
        }
      }
    }

    // Step 6: Employer match (computed from employee 401k contribution)
    if (profile.employerMatch) {
      const totalEmployee401k = traditional401k + roth401k;
      // Base gross excludes imputed income additions for match % calculation
      let baseGross = grossPay;
      if (profile.deductions) {
        for (const ded of profile.deductions) {
          if (ded.imputed) baseGross -= ded.amount;
        }
      }
      // Also subtract hsaEmployerContribution if present (it's imputed)
      if (profile.hsaEmployerContribution) {
        baseGross -= profile.hsaEmployerContribution / paychecksPerYear;
      }
      employerMatch = this.computeEmployerMatch(baseGross, totalEmployee401k, profile.employerMatch, paychecksPerYear);
      if (employerMatch > 0) {
        depositActivities.push({
          accountId: profile.employerMatch.destinationAccount,
          amount: employerMatch,
          label: 'Employer 401k Match',
        });
        this.log('employer-match-computed', { amount: employerMatch, mode: profile.employerMatch.mode, baseGross });
      }
    }

    // Step 7: Net pay
    const netPay = grossPay - totalPreTax - ssTax - medicareTax - federalWithholding - stateWithholding - totalPostTax;

    if (netPay < 0) {
      this.log('negative-net-pay', {
        grossPay,
        totalPreTax,
        ssTax,
        medicareTax,
        federalWithholding,
        stateWithholding,
        totalPostTax,
        netPay,
      });
    }

    // Record withholding in TaxManager if amounts are present
    if (this.taxManager && (federalWithholding > 0 || stateWithholding > 0)) {
      this.taxManager.addWithholdingOccurrence({
        date,
        year,
        federalAmount: federalWithholding,
        stateAmount: stateWithholding,
        source: billName,
      });
    }

    this.log('paycheck-processed', {
      grossPay,
      netPay,
      traditional401k,
      roth401k,
      employerMatch,
      hsa,
      hsaEmployer,
      ssTax,
      medicareTax,
      federalWithholding,
      stateWithholding,
      totalPreTax,
      totalPostTax,
    });

    return {
      netPay,
      grossPay,
      traditional401k,
      roth401k,
      employerMatch,
      hsa,
      hsaEmployer,
      ssTax,
      medicareTax,
      federalWithholding,
      stateWithholding,
      preTaxDeductions,
      postTaxDeductions,
      depositActivities,
    };
  }

  /**
   * Process a bonus paycheck and return the breakdown of deductions, taxes, and deposits.
   * Bonus is a one-time payment subject to simplified processing:
   * - 401k only (if subjectTo401k is true)
   * - No HSA, no custom deductions
   * - FICA applies (counts toward YTD SS and Medicare)
   * - Withholding uses 22% flat supplemental rate
   *
   * @param grossPay - Gross pay per regular paycheck (used as base for bonus %)
   * @param paychecksPerYear - Expected number of paychecks per year (26 for biweekly, etc.)
   * @param profile - Paycheck profile with bonus config
   * @param billName - Bill name (for state tracking)
   * @param date - Bonus date
   * @param accountOwnerDOB - DOB of account owner (for contribution limits and FICA tracking)
   * @param ssWageBaseCap - Annual Social Security wage cap for this year
   * @param additionalMedicareThreshold - Additional Medicare tax threshold
   * @param taxProfile - Optional tax profile for withholding calculations
   */
  processBonusPaycheck(
    grossPay: number,
    paychecksPerYear: number,
    profile: PaycheckProfile,
    billName: string,
    date: Date,
    accountOwnerDOB: Date | null,
    ssWageBaseCap: number,
    additionalMedicareThreshold: number,
    taxProfile?: TaxProfile | null,
  ): PaycheckResult {
    // Check for unemployment and skip bonus if unemployed
    if (this.jobLossManager?.isUnemployed(billName, date)) {
      this.log('bonus-paycheck-suppressed-unemployment', { billName, date: date.toISOString() });
      return createEmptyPaycheckResult();
    }

    const year = date.getUTCFullYear();
    const bonusGross = grossPay * paychecksPerYear * (profile.bonus?.percent ?? 0);

    const preTaxDeductions: { label: string; amount: number }[] = [];
    const postTaxDeductions: { label: string; amount: number }[] = [];
    const depositActivities: { accountId: string; amount: number; label: string }[] = [];

    let totalPreTax = 0;
    let totalPostTax = 0;
    let traditional401k = 0;
    let roth401k = 0;
    let employerMatch = 0;

    // Bonus 401k: only if subjectTo401k is true
    if (profile.bonus?.subjectTo401k) {
      if (profile.traditional401k) {
        let amount = profile.traditional401k.type === 'percent' ? bonusGross * profile.traditional401k.value : profile.traditional401k.value;
        const remaining = this.contributionLimitManager.getRemainingLimit(accountOwnerDOB, year, '401k');
        amount = Math.min(amount, remaining);
        if (amount > 0) {
          this.contributionLimitManager.recordContribution(accountOwnerDOB, year, '401k', amount);
          traditional401k = amount;
          totalPreTax += amount;
          preTaxDeductions.push({ label: 'Traditional 401k (Bonus)', amount });
          depositActivities.push({
            accountId: profile.traditional401k.destinationAccount,
            amount,
            label: 'Traditional 401k Contribution (Bonus)',
          });
          this.log('bonus-traditional401k-deducted', { amount, bonusGross });
        }
      }

      if (profile.roth401k) {
        let amount = profile.roth401k.type === 'percent' ? bonusGross * profile.roth401k.value : profile.roth401k.value;
        const remaining = this.contributionLimitManager.getRemainingLimit(accountOwnerDOB, year, '401k');
        amount = Math.min(amount, remaining);
        if (amount > 0) {
          this.contributionLimitManager.recordContribution(accountOwnerDOB, year, '401k', amount);
          roth401k = amount;
          totalPostTax += amount;
          postTaxDeductions.push({ label: 'Roth 401k (Bonus)', amount });
          depositActivities.push({
            accountId: profile.roth401k.destinationAccount,
            amount,
            label: 'Roth 401k Contribution (Bonus)',
          });
          this.log('bonus-roth401k-deducted', { amount, bonusGross });
        }
      }

      // Employer match on bonus 401k contributions
      if (profile.employerMatch) {
        const totalEmployee = traditional401k + roth401k;
        // For bonus, calculate base bonus gross (excluding imputed deductions)
        let bonusBaseGross = bonusGross;
        if (profile.deductions) {
          for (const ded of profile.deductions) {
            if (ded.imputed) bonusBaseGross -= ded.amount * paychecksPerYear;
          }
        }
        if (profile.hsaEmployerContribution) {
          bonusBaseGross -= profile.hsaEmployerContribution;
        }
        employerMatch = this.computeEmployerMatch(bonusBaseGross, totalEmployee, profile.employerMatch, 1); // 1 = single bonus payment
        if (employerMatch > 0) {
          depositActivities.push({
            accountId: profile.employerMatch.destinationAccount,
            amount: employerMatch,
            label: 'Employer 401k Match (Bonus)',
          });
          this.log('bonus-employer-match-computed', { amount: employerMatch, bonusGross, bonusBaseGross });
        }
      }
    }

    // FICA on bonus (SS wages = bonusGross, 401k does NOT reduce SS wages)
    const personKey = accountOwnerDOB ? accountOwnerDOB.getTime().toString() : 'unknown';
    const taxableSS = this.paycheckStateTracker.addSSWages(personKey, year, bonusGross, ssWageBaseCap);
    const ssTax = taxableSS * 0.062;

    const medicareResult = this.paycheckStateTracker.addMedicareWages(
      personKey,
      year,
      bonusGross,
      additionalMedicareThreshold,
    );
    const baseMedicare = bonusGross * 0.0145;
    const additionalMedicare = medicareResult.wagesAboveThreshold * 0.009;
    const medicareTax = baseMedicare + additionalMedicare;

    this.log('bonus-fica-computed', {
      bonusGross,
      taxableSS,
      ssTax,
      medicareTax,
    });

    // Bonus federal withholding: 22% flat supplemental rate
    let federalWithholding = 0;
    if (this.withholdingCalculator) {
      federalWithholding = this.withholdingCalculator.computeBonusWithholding(bonusGross, totalPreTax);
    }

    // Bonus state withholding: same flat rate
    let stateWithholding = 0;
    if (taxProfile) {
      stateWithholding = taxProfile.stateTaxRate * (bonusGross - totalPreTax);
    }

    this.log('bonus-withholding-computed', {
      federalWithholding,
      stateWithholding,
      taxableBonusAmount: bonusGross - totalPreTax,
    });

    // Net pay = bonus gross - pre-tax deductions - FICA - withholding - post-tax deductions
    const netPay = bonusGross - totalPreTax - ssTax - medicareTax - federalWithholding - stateWithholding - totalPostTax;

    if (netPay < 0) {
      this.log('bonus-negative-net-pay', {
        bonusGross,
        totalPreTax,
        ssTax,
        medicareTax,
        federalWithholding,
        stateWithholding,
        netPay,
      });
    }

    // Record withholding in TaxManager if amounts are present
    if (this.taxManager && (federalWithholding > 0 || stateWithholding > 0)) {
      this.taxManager.addWithholdingOccurrence({
        date,
        year,
        federalAmount: federalWithholding,
        stateAmount: stateWithholding,
        source: billName,
      });
    }

    this.log('bonus-paycheck-processed', {
      bonusGross,
      netPay,
      traditional401k,
      roth401k,
      employerMatch,
      ssTax,
      medicareTax,
      federalWithholding,
      stateWithholding,
      totalPreTax,
    });

    return {
      netPay,
      grossPay: bonusGross,
      traditional401k,
      roth401k,
      employerMatch,
      hsa: 0,
      hsaEmployer: 0,
      ssTax,
      medicareTax,
      federalWithholding,
      stateWithholding,
      preTaxDeductions,
      postTaxDeductions,
      depositActivities,
    };
  }

  /**
   * Compute employer match based on employee contribution and match configuration.
   * Note: deductions with increaseByVariable will be consumed when the bill's increaseByVariable
   * is applied during yearly inflation processing (deferred to future PR).
   */
  computeEmployerMatch(
    baseGross: number,
    employeeContribution: number,
    config: EmployerMatchConfig,
    paychecksPerYear: number,
  ): number {
    if (employeeContribution <= 0) return 0;

    switch (config.mode) {
      case 'simple': {
        const maxMatch = baseGross * (config.simplePercent ?? 0);
        return Math.min(maxMatch, employeeContribution);
      }
      case 'tiered': {
        let totalMatch = 0;
        let remainingEmployee = employeeContribution;
        let prevTierCap = 0;
        for (const tier of config.tiers ?? []) {
          const tierBand = (tier.upToPercent - prevTierCap) * baseGross;
          const matchable = Math.min(tierBand, remainingEmployee);
          totalMatch += matchable * tier.matchPercent;
          remainingEmployee -= matchable;
          prevTierCap = tier.upToPercent;
          if (remainingEmployee <= 0) break;
        }
        return totalMatch;
      }
      case 'fixed': {
        return (config.fixedAmount ?? 0) / paychecksPerYear;
      }
      default:
        return 0;
    }
  }
}
