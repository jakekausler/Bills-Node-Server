import { PaycheckProfile, EmployerMatchConfig } from '../../data/bill/paycheck-types';
import { PaycheckResult } from './types';
import { PaycheckStateTracker } from './paycheck-state-tracker';
import { ContributionLimitManager } from './contribution-limit-manager';
import type { DebugLogger } from './debug-logger';

/**
 * Processes individual paychecks, computing net pay, taxes, and retirement contributions.
 */
export class PaycheckProcessor {
  private paycheckStateTracker: PaycheckStateTracker;
  private contributionLimitManager: ContributionLimitManager;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(
    paycheckStateTracker: PaycheckStateTracker,
    contributionLimitManager: ContributionLimitManager,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
  ) {
    this.paycheckStateTracker = paycheckStateTracker;
    this.contributionLimitManager = contributionLimitManager;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
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
  ): PaycheckResult {
    const year = date.getUTCFullYear();
    const yearMonth = `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const paycheckIndex = this.paycheckStateTracker.getAndIncrementPaycheckCount(billName, yearMonth);
    // Determine if first paycheck of year (January and paycheckIndex === 0 for first Jan paycheck)
    const isFirstPaycheckOfYear = date.getUTCMonth() === 0 && paycheckIndex === 0;

    const preTaxDeductions: { label: string; amount: number }[] = [];
    const postTaxDeductions: { label: string; amount: number }[] = [];
    const depositActivities: { accountId: string; amount: number; label: string }[] = [];

    let totalPreTax = 0;
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
          preTaxDeductions.push({ label: 'Traditional 401k', amount: amount401k });
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
          preTaxDeductions.push({ label: 'HSA Employee', amount: hsaAmount });
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

    // Step 4: Post-tax deductions
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
          postTaxDeductions.push({ label: 'Roth 401k', amount: roth401kAmount });
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

    // Step 5: Employer match (computed from employee 401k contribution)
    if (profile.employerMatch) {
      const totalEmployee401k = traditional401k + roth401k;
      employerMatch = this.computeEmployerMatch(grossPay, totalEmployee401k, profile.employerMatch, paychecksPerYear);
      if (employerMatch > 0) {
        depositActivities.push({
          accountId: profile.employerMatch.destinationAccount,
          amount: employerMatch,
          label: 'Employer 401k Match',
        });
        this.log('employer-match-computed', { amount: employerMatch, mode: profile.employerMatch.mode });
      }
    }

    // Step 6: Net pay
    const netPay = grossPay - totalPreTax - ssTax - medicareTax - totalPostTax;

    if (netPay < 0) {
      this.log('negative-net-pay', { grossPay, totalPreTax, ssTax, medicareTax, totalPostTax, netPay });
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
      federalWithholding: 0, // Cycle A: not implemented
      stateWithholding: 0, // Cycle A: not implemented
      preTaxDeductions,
      postTaxDeductions,
      depositActivities,
    };
  }

  /**
   * Compute employer match based on employee contribution and match configuration.
   */
  computeEmployerMatch(
    grossPay: number,
    employeeContribution: number,
    config: EmployerMatchConfig,
    paychecksPerYear: number,
  ): number {
    if (employeeContribution <= 0) return 0;

    switch (config.mode) {
      case 'simple': {
        const maxMatch = grossPay * (config.simplePercent ?? 0);
        return Math.min(maxMatch, employeeContribution);
      }
      case 'tiered': {
        let totalMatch = 0;
        let remainingEmployee = employeeContribution;
        let prevTierCap = 0;
        let lastTierMatchPercent = 0;
        for (const tier of config.tiers ?? []) {
          const tierBand = (tier.upToPercent - prevTierCap) * grossPay;
          const matchable = Math.min(tierBand, remainingEmployee);
          totalMatch += matchable * tier.matchPercent;
          remainingEmployee -= matchable;
          prevTierCap = tier.upToPercent;
          lastTierMatchPercent = tier.matchPercent;
          if (remainingEmployee <= 0) break;
        }
        // Any remaining employee contribution gets matched at the last tier rate
        if (remainingEmployee > 0 && lastTierMatchPercent > 0) {
          totalMatch += remainingEmployee * lastTierMatchPercent;
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
