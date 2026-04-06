/**
 * LifeInsuranceManager — models employer life insurance policies,
 * coverage calculations, employment gating, and death payouts.
 *
 * Two-pass evaluation handles cappedByPolicyId ordering:
 * Pass 1 processes uncapped policies, Pass 2 processes capped ones.
 *
 * Coverage is deactivated (temporary) during unemployment and
 * permanently upon retirement for employment-tied policies.
 */

import type { DebugLogger } from './debug-logger';
import type { MCRateGetter } from './types';
import { MonteCarloSampleType } from './types';
import { ManagerPayout, createPayoutActivity } from './manager-payout';
import { loadVariable } from '../simulation/variable';
import type { TermRateEntry, LifeInsurancePremiumRates } from '../../types/life-insurance-rates';

// ===== Public Types =====

/** Shared coverage configuration for employer policies */
export interface LifeInsuranceCoverage {
  formula: 'multiplier' | 'fixed';
  multiplier?: number;
  fixedAmount?: number;
  maxCoverage: number;
  maxCoverageInflationVariable: string;
  cappedByPolicyId?: string;
}

/** Employer-sponsored life insurance (existing, must not break) */
export interface LifeInsuranceEmployerPolicy {
  id: string;
  name: string;
  type: 'employer';
  insuredPerson: string;
  beneficiary: string;
  depositAccountId: string;
  enabled: boolean;
  coverage: LifeInsuranceCoverage;
  employmentTied: boolean;
  linkedPaycheckBillName?: string;
  employmentPerson?: string;
}

/** Term life insurance (new) */
export interface LifeInsuranceTermPolicy {
  id: string;
  name: string;
  type: 'term';
  insuredPerson: string;
  beneficiary: string;
  depositAccountId: string;
  enabled: boolean;
  faceAmount: number;
  termYears: number;
  startDate: string; // YYYY-MM-DD
  premiumAmount: number;
  premiumFrequency: 'monthly' | 'annual';
  payFromAccountId: string;
  renewalOption: 'expire' | 'renew' | 'convertToWhole';
  insuredGender: 'male' | 'female';
  insuredBirthDate: string; // YYYY-MM-DD
}

/** Whole life insurance (new) */
export interface LifeInsuranceWholePolicy {
  id: string;
  name: string;
  type: 'whole';
  insuredPerson: string;
  beneficiary: string;
  depositAccountId: string;
  enabled: boolean;
  deathBenefit: number;
  premiumAmount: number;
  premiumFrequency: 'monthly' | 'annual';
  payFromAccountId: string;
  guaranteedRate: number; // decimal (0.02 = 2%)
  savingsRatio: number; // decimal (~0.50)
  surrenderChargeSchedule?: number[]; // optional, per-year decimals
  insuredGender: 'male' | 'female';
  insuredBirthDate: string; // YYYY-MM-DD
}

/** Discriminated union of all life insurance policy types */
export type LifeInsurancePolicyConfig =
  | LifeInsuranceEmployerPolicy
  | LifeInsuranceTermPolicy
  | LifeInsuranceWholePolicy;

/** Minimal interface for the job loss manager dependency. */
export interface EmploymentGate {
  isUnemployed(personKey: string, date: Date): boolean;
}

// ===== Internal State =====

interface PolicyState {
  config: LifeInsurancePolicyConfig;
  currentCoverageAmount: number;
  currentMaxCoverage: number;
  payoutMade: boolean;
  coverageActive: boolean;
  retiredPermanently: boolean;
  /** Tracks the payout date if a payout was made */
  payoutDate: string | null;
  /** Tracks the payout amount if a payout was made */
  payoutAmount: number;
  /** Whether coverage was active when death occurred */
  coverageActiveAtDeath: boolean;
  // --- Term policy state (028-003) ---
  /** Is this term policy currently active (paying premiums, providing coverage)? */
  termActive: boolean;
  /** Year when the current term expires (startDate year + termYears) */
  termExpirationYear: number;
  /** Cumulative premiums paid over the life of the policy */
  totalPremiumsPaid: number;
  /** Current annual premium amount (may change on renewal) */
  currentPremiumAmount: number;
  /** How many times this term has been renewed */
  renewalCount: number;
  /** Date when converted to whole life (028-004 picks this up), null if not converted */
  convertedToWholeDate: string | null;
}

// ===== LifeInsuranceManager =====

export class LifeInsuranceManager {
  private states: Map<string, PolicyState> = new Map();
  private jobLossManager: EmploymentGate;
  private simulation: string;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private mcRateGetter: MCRateGetter | null = null;
  private payoutBuffer: ManagerPayout[] = [];
  private termRateTable: TermRateEntry[] = [];

  constructor(
    configs: LifeInsurancePolicyConfig[],
    jobLossManager: EmploymentGate,
    simulation: string,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
  ) {
    this.jobLossManager = jobLossManager;
    this.simulation = simulation;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;

    for (const config of configs) {
      this.states.set(config.id, this.createInitialState(config));
    }
  }

  // ---- Public API ----

  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetter = getter;
  }

  setTermRateTable(rates: TermRateEntry[]): void {
    this.termRateTable = rates;
  }

  evaluateYear(
    year: number,
    currentSalaries: Map<string, number>,
    retirementDates: Map<string, Date>,
  ): void {
    // Pass 1: Process employer policies WITHOUT cappedByPolicyId
    for (const [, state] of this.states) {
      if (!state.config.enabled || state.payoutMade) continue;
      if (!this.isEmployerPolicy(state.config)) continue;
      if (state.config.coverage.cappedByPolicyId) continue;
      this.evaluatePolicy(state, year, currentSalaries, retirementDates);
    }

    // Pass 2: Process employer policies WITH cappedByPolicyId
    for (const [, state] of this.states) {
      if (!state.config.enabled || state.payoutMade) continue;
      if (!this.isEmployerPolicy(state.config)) continue;
      if (!state.config.coverage.cappedByPolicyId) continue;
      this.evaluatePolicy(state, year, currentSalaries, retirementDates);
    }

    // Pass 3: Process term policies — premium deduction + expiration/renewal
    for (const [, state] of this.states) {
      if (!state.config.enabled || state.payoutMade) continue;
      if (!this.isTermPolicy(state.config)) continue;
      this.evaluateTermPolicy(state, year);
    }
  }

  evaluateDeath(person: string, deathDate: Date): void {
    // Find policies where person is the insured
    for (const [, state] of this.states) {
      if (!state.config.enabled) continue;

      if (state.config.insuredPerson === person && !state.payoutMade) {
        const dateStr = `${deathDate.getUTCFullYear()}-${String(deathDate.getUTCMonth() + 1).padStart(2, '0')}-${String(deathDate.getUTCDate()).padStart(2, '0')}`;

        if (this.isEmployerPolicy(state.config)) {
          // --- Employer policy death payout (existing logic, unchanged) ---
          if (state.coverageActive) {
            const activity = createPayoutActivity(
              `life-insurance-${state.config.id}-${dateStr}`,
              dateStr,
              `Life Insurance Payout: ${state.config.name}`,
              state.currentCoverageAmount,
              'Income.LifeInsurance',
            );

            this.payoutBuffer.push({
              activity,
              targetAccountId: state.config.depositAccountId,
              incomeSourceName: 'Income.LifeInsurance',
            });

            state.payoutDate = dateStr;
            state.payoutAmount = state.currentCoverageAmount;
            state.coverageActiveAtDeath = true;

            this.log('payout-created', {
              policy: state.config.name,
              amount: state.currentCoverageAmount,
              deathDate: deathDate.toISOString(),
              depositAccount: state.config.depositAccountId,
            });
          } else {
            state.coverageActiveAtDeath = false;
            this.log('payout-skipped-inactive', {
              policy: state.config.name,
              reason: state.retiredPermanently ? 'retired' : 'unemployed',
            });
          }
          state.payoutMade = true;

        } else if (this.isTermPolicy(state.config)) {
          // --- Term policy death payout ---
          if (state.termActive && state.coverageActive) {
            const payoutAmount = state.config.faceAmount;
            const activity = createPayoutActivity(
              `life-insurance-${state.config.id}-${dateStr}`,
              dateStr,
              `Life Insurance Payout: ${state.config.name}`,
              payoutAmount,
              'Income.LifeInsurance',
            );

            this.payoutBuffer.push({
              activity,
              targetAccountId: state.config.depositAccountId,
              incomeSourceName: 'Income.LifeInsurance',
            });

            state.payoutDate = dateStr;
            state.payoutAmount = payoutAmount;
            state.coverageActiveAtDeath = true;
            state.termActive = false; // Policy ends on payout

            this.log('term-payout-created', {
              policy: state.config.name,
              amount: payoutAmount,
              deathDate: deathDate.toISOString(),
              depositAccount: state.config.depositAccountId,
            });
          } else {
            state.coverageActiveAtDeath = false;
            this.log('term-payout-skipped-inactive', {
              policy: state.config.name,
              reason: !state.termActive ? 'term-expired' : 'coverage-inactive',
            });
          }
          state.payoutMade = true;
        }
        // Whole life death payout: deferred to 028-004
      }

      // Find policies where person is the beneficiary → deactivate
      if (state.config.beneficiary === person) {
        state.coverageActive = false;
        this.log('beneficiary-died', {
          policy: state.config.name,
          beneficiary: person,
        });
      }
    }
  }

  getPayoutActivities(): ManagerPayout[] {
    const payouts = [...this.payoutBuffer];
    this.payoutBuffer = [];
    return payouts;
  }

  getCurrentCoverage(policyId: string): number {
    const state = this.states.get(policyId);
    if (!state) return 0;
    return state.currentCoverageAmount;
  }

  checkpoint(): string {
    const serialised: Record<string, unknown> = {};
    for (const [id, state] of this.states) {
      serialised[id] = {
        currentCoverageAmount: state.currentCoverageAmount,
        currentMaxCoverage: state.currentMaxCoverage,
        payoutMade: state.payoutMade,
        coverageActive: state.coverageActive,
        retiredPermanently: state.retiredPermanently,
        payoutDate: state.payoutDate,
        payoutAmount: state.payoutAmount,
        coverageActiveAtDeath: state.coverageActiveAtDeath,
        // Term fields (028-003)
        termActive: state.termActive,
        termExpirationYear: state.termExpirationYear,
        totalPremiumsPaid: state.totalPremiumsPaid,
        currentPremiumAmount: state.currentPremiumAmount,
        renewalCount: state.renewalCount,
        convertedToWholeDate: state.convertedToWholeDate,
      };
    }
    return JSON.stringify(serialised);
  }

  restore(data: string): void {
    const parsed = JSON.parse(data) as Record<
      string,
      {
        currentCoverageAmount: number;
        currentMaxCoverage: number;
        payoutMade: boolean;
        coverageActive: boolean;
        retiredPermanently: boolean;
        payoutDate: string | null;
        payoutAmount: number;
        coverageActiveAtDeath: boolean;
        // Term fields (028-003) — optional for backward compat with old checkpoints
        termActive?: boolean;
        termExpirationYear?: number;
        totalPremiumsPaid?: number;
        currentPremiumAmount?: number;
        renewalCount?: number;
        convertedToWholeDate?: string | null;
      }
    >;

    for (const [id, snap] of Object.entries(parsed)) {
      const state = this.states.get(id);
      if (!state) continue;
      state.currentCoverageAmount = snap.currentCoverageAmount;
      state.currentMaxCoverage = snap.currentMaxCoverage;
      state.payoutMade = snap.payoutMade;
      state.coverageActive = snap.coverageActive;
      state.retiredPermanently = snap.retiredPermanently;
      state.payoutDate = snap.payoutDate;
      state.payoutAmount = snap.payoutAmount;
      state.coverageActiveAtDeath = snap.coverageActiveAtDeath;
      // Term fields — use defaults if missing (backward compat)
      state.termActive = snap.termActive ?? state.termActive;
      state.termExpirationYear = snap.termExpirationYear ?? state.termExpirationYear;
      state.totalPremiumsPaid = snap.totalPremiumsPaid ?? state.totalPremiumsPaid;
      state.currentPremiumAmount = snap.currentPremiumAmount ?? state.currentPremiumAmount;
      state.renewalCount = snap.renewalCount ?? state.renewalCount;
      state.convertedToWholeDate = snap.convertedToWholeDate ?? state.convertedToWholeDate;
    }
  }

  resetPolicyStates(): void {
    for (const [id, state] of this.states) {
      const fresh = this.createInitialState(state.config);
      this.states.set(id, fresh);
    }
    this.payoutBuffer = [];
  }

  getResults(): Array<{
    policyId: string;
    payoutDate: string | null;
    payoutAmount: number;
    coverageActiveAtDeath: boolean;
  }> {
    const results: Array<{
      policyId: string;
      payoutDate: string | null;
      payoutAmount: number;
      coverageActiveAtDeath: boolean;
    }> = [];

    for (const [, state] of this.states) {
      results.push({
        policyId: state.config.id,
        payoutDate: state.payoutDate,
        payoutAmount: state.payoutAmount,
        coverageActiveAtDeath: state.coverageActiveAtDeath,
      });
    }

    return results;
  }

  // ---- Private helpers ----

  private isEmployerPolicy(config: LifeInsurancePolicyConfig): config is LifeInsuranceEmployerPolicy {
    return config.type === 'employer';
  }

  private isTermPolicy(config: LifeInsurancePolicyConfig): config is LifeInsuranceTermPolicy {
    return config.type === 'term';
  }

  private createInitialState(config: LifeInsurancePolicyConfig): PolicyState {
    // Only employer policies have maxCoverage; term and whole start at 0
    const maxCoverage = this.isEmployerPolicy(config) ? config.coverage.maxCoverage : 0;

    // Term-specific initial state
    let termActive = false;
    let termExpirationYear = 0;
    let currentPremiumAmount = 0;
    let currentCoverageAmount = 0;

    if (this.isTermPolicy(config)) {
      termActive = true;
      termExpirationYear = parseInt(config.startDate.slice(0, 4), 10) + config.termYears;
      // Normalize premium to annual total
      currentPremiumAmount =
        config.premiumFrequency === 'monthly'
          ? config.premiumAmount * 12
          : config.premiumAmount;
      // Term policies have fixed face amount as coverage
      currentCoverageAmount = config.faceAmount;
    }

    return {
      config,
      currentCoverageAmount,
      currentMaxCoverage: maxCoverage,
      payoutMade: false,
      coverageActive: true,
      retiredPermanently: false,
      payoutDate: null,
      payoutAmount: 0,
      coverageActiveAtDeath: false,
      // Term fields
      termActive,
      termExpirationYear,
      totalPremiumsPaid: 0,
      currentPremiumAmount,
      renewalCount: 0,
      convertedToWholeDate: null,
    };
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'life-insurance', event, ...data });
  }

  private evaluatePolicy(
    state: PolicyState,
    year: number,
    currentSalaries: Map<string, number>,
    retirementDates: Map<string, Date>,
  ): void {
    const config = state.config;

    // Only employer policies have coverage calculation logic
    if (!this.isEmployerPolicy(config)) {
      // Term and whole policies: skip for now (future stage will implement)
      return;
    }

    // Step 1: Inflate maxCoverage
    const inflationRate = this.getInflationRate(state, year);
    if (inflationRate !== null) {
      state.currentMaxCoverage = state.currentMaxCoverage * (1 + inflationRate);
    }

    // Step 2: Calculate base coverage
    let coverageAmount: number;
    if (config.coverage.formula === 'multiplier') {
      const salary = currentSalaries.get(config.linkedPaycheckBillName!) ?? 0;
      coverageAmount = (config.coverage.multiplier ?? 0) * salary;
    } else {
      coverageAmount = config.coverage.fixedAmount ?? 0;
    }

    // Cap at max coverage
    coverageAmount = Math.min(coverageAmount, state.currentMaxCoverage);

    // Cap by referenced policy if cappedByPolicyId is set
    // Only apply cap if the reference policy is still active — if the reference
    // policy is inactive (retired/job loss), the cap does not apply so the
    // capped policy uses its own fixedAmount or max.
    if (config.coverage.cappedByPolicyId) {
      const refState = this.states.get(config.coverage.cappedByPolicyId);
      if (refState && refState.coverageActive) {
        coverageAmount = Math.min(coverageAmount, refState.currentCoverageAmount);
      }
    }

    state.currentCoverageAmount = coverageAmount;

    this.log('coverage-updated', {
      policy: config.name,
      year,
      formula: config.coverage.formula,
      coverageAmount,
      maxCoverage: state.currentMaxCoverage,
    });

    // Step 3: Employment gating
    if (config.employmentTied) {
      // Check retirement (permanent)
      const retDate = retirementDates.get(config.linkedPaycheckBillName!);
      if (retDate && year >= retDate.getUTCFullYear()) {
        state.coverageActive = false;
        state.retiredPermanently = true;
        this.log('coverage-deactivated-retired', { policy: config.name, year });
        return;
      }

      // Check if already permanently retired
      if (state.retiredPermanently) {
        state.coverageActive = false;
        return;
      }

      // Check unemployment (temporary) — use employmentPerson if set,
      // so spouse policies gate on the employee's job status, not the insured's.
      const employmentPerson = config.employmentPerson ?? config.insuredPerson;
      const evalDate = new Date(Date.UTC(year, 0, 1));
      if (this.jobLossManager.isUnemployed(employmentPerson, evalDate)) {
        state.coverageActive = false;
        this.log('coverage-deactivated-unemployed', { policy: config.name, year });
      } else {
        state.coverageActive = true;
      }
    }
  }

  /**
   * Evaluate a term life insurance policy for the given year.
   * Handles premium deduction, expiration checks, renewal repricing,
   * and conversion to whole life.
   */
  private evaluateTermPolicy(state: PolicyState, year: number): void {
    const config = state.config as LifeInsuranceTermPolicy;

    // Skip if term is not active (expired or converted)
    if (!state.termActive) {
      return;
    }

    // --- Premium deduction ---
    const premiumAmount = state.currentPremiumAmount;
    if (premiumAmount > 0) {
      const dateStr = `${year}-01-01`;
      // NOTE: Annual premium deducted as lump sum on Jan 1. Monthly granularity deferred to future stage.
      const activity = createPayoutActivity(
        `life-insurance-premium-${config.id}-${year}`,
        dateStr,
        `Term Life Premium: ${config.name}`,
        -premiumAmount, // negative = deduction from account
        'Expense.Insurance.LifeInsurance',
      );

      this.payoutBuffer.push({
        activity,
        targetAccountId: config.payFromAccountId,
        incomeSourceName: 'Expense.Insurance.LifeInsurance',
      });

      state.totalPremiumsPaid += premiumAmount;

      this.log('term-premium-deducted', {
        policy: config.name,
        year,
        amount: premiumAmount,
        totalPaid: state.totalPremiumsPaid,
        payFromAccount: config.payFromAccountId,
      });
    }

    // --- Expiration check ---
    // Expiration checked after premium: policy covers through expiration year, final premium is charged.
    while (year >= state.termExpirationYear && state.termActive) {
      this.handleTermExpiration(state, config, year);
    }
  }

  /**
   * Handle term expiration based on the renewalOption setting.
   */
  private handleTermExpiration(
    state: PolicyState,
    config: LifeInsuranceTermPolicy,
    year: number,
  ): void {
    if (config.termYears <= 0) {
      state.termActive = false;
      state.coverageActive = false;
      return;
    }

    switch (config.renewalOption) {
      case 'expire': {
        state.termActive = false;
        state.coverageActive = false;
        this.log('term-expired', {
          policy: config.name,
          year,
          totalPremiumsPaid: state.totalPremiumsPaid,
        });
        break;
      }

      case 'renew': {
        // Calculate insured's age at renewal
        const birthYear = parseInt(config.insuredBirthDate.slice(0, 4), 10);
        // Age approximation using year only — sufficient for rate table bands spanning 5-10 years
        const currentAge = year - birthYear;

        // Look up new premium from rate table
        let newAnnualPremium = this.lookupTermPremiumFromTable(
          currentAge,
          config.insuredGender,
          config.termYears,
          config.faceAmount,
        );

        if (newAnnualPremium === null) {
          // No rate available at this age — policy cannot renew, expires instead
          state.termActive = false;
          state.coverageActive = false;
          this.log('term-renewal-failed-no-rate', {
            policy: config.name,
            year,
            age: currentAge,
          });
          return;
        }

        // Apply MC-sampled PPI inflation if available
        if (this.mcRateGetter) {
          const ppiRate = this.mcRateGetter(MonteCarloSampleType.TERM_LIFE_PPI, year);
          if (ppiRate !== null) {
            newAnnualPremium = newAnnualPremium * (1 + ppiRate);
          }
        }

        state.currentPremiumAmount = newAnnualPremium;
        state.termExpirationYear += config.termYears;
        state.renewalCount += 1;

        this.log('term-renewed', {
          policy: config.name,
          year,
          age: currentAge,
          newPremium: newAnnualPremium,
          newExpiration: state.termExpirationYear,
          renewalCount: state.renewalCount,
        });
        break;
      }

      case 'convertToWhole': {
        state.termActive = false;
        state.convertedToWholeDate = `${year}-01-01`;
        // coverageActive stays true — whole-life conversion preserves coverage
        // Actual whole-life behavior (cash value, dividends) deferred to 028-004
        this.log('term-converted-to-whole', {
          policy: config.name,
          year,
          conversionDate: state.convertedToWholeDate,
        });
        break;
      }
    }
  }

  private getInflationRate(state: PolicyState, year: number): number | null {
    // Only employer policies have inflation rates
    if (!this.isEmployerPolicy(state.config)) {
      return null;
    }

    // MC mode: use mcRateGetter
    if (this.mcRateGetter) {
      const mcRate = this.mcRateGetter(MonteCarloSampleType.INFLATION, year);
      if (mcRate !== null) return mcRate;
    }

    // Deterministic mode: load from simulation variable
    const varName = state.config.coverage.maxCoverageInflationVariable;
    if (varName) {
      try {
        const val = loadVariable(varName, this.simulation);
        if (typeof val === 'number') return val;
        this.log('inflation-variable-not-numeric', { variable: varName, type: typeof val });
      } catch {
        // fall through
      }
    }

    return null;
  }

  /**
   * Look up term premium from the rate table for the insured's current age,
   * gender, and term length. Returns the annual premium for the full face amount,
   * or null if no matching rate is found.
   */
  private lookupTermPremiumFromTable(
    age: number,
    gender: 'male' | 'female',
    termYears: number,
    faceAmount: number,
  ): number | null {
    const entry = this.termRateTable.find(
      (r) =>
        age >= r.ageMin &&
        age <= r.ageMax &&
        r.gender === gender &&
        r.termYears === termYears,
    );
    if (!entry) {
      this.log('term-rate-lookup-miss', { age, gender, termYears });
      return null;
    }
    // ratePerThousandMonthly * (faceAmount / 1000) * 12 = annual premium
    return entry.ratePerThousandMonthly * (faceAmount / 1000) * 12;
  }
}
