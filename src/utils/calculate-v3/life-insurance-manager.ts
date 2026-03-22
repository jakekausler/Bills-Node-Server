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

// ===== Public Types =====

export interface LifeInsurancePolicyConfig {
  id: string;
  name: string;
  type: 'employer';
  insuredPerson: string;
  beneficiary: string;
  depositAccountId: string;
  coverage: {
    formula: 'multiplier' | 'fixed';
    multiplier?: number;
    fixedAmount?: number;
    maxCoverage: number;
    maxCoverageInflationVariable: string;
    cappedByPolicyId?: string;
  };
  employmentTied: boolean;
  linkedPaycheckBillName?: string;
  enabled: boolean;
}

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

  evaluateYear(
    year: number,
    currentSalaries: Map<string, number>,
    retirementDates: Map<string, Date>,
  ): void {
    // Pass 1: Process policies WITHOUT cappedByPolicyId
    for (const [, state] of this.states) {
      if (!state.config.enabled || state.payoutMade) continue;
      if (state.config.coverage.cappedByPolicyId) continue;
      this.evaluatePolicy(state, year, currentSalaries, retirementDates);
    }

    // Pass 2: Process policies WITH cappedByPolicyId
    for (const [, state] of this.states) {
      if (!state.config.enabled || state.payoutMade) continue;
      if (!state.config.coverage.cappedByPolicyId) continue;
      this.evaluatePolicy(state, year, currentSalaries, retirementDates);
    }
  }

  evaluateDeath(person: string, deathDate: Date): void {
    // Find policies where person is the insured
    for (const [, state] of this.states) {
      if (!state.config.enabled) continue;

      if (state.config.insuredPerson === person && !state.payoutMade) {
        if (state.coverageActive) {
          // Create payout
          const dateStr = `${deathDate.getUTCFullYear()}-${String(deathDate.getUTCMonth() + 1).padStart(2, '0')}-${String(deathDate.getUTCDate()).padStart(2, '0')}`;
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

  private createInitialState(config: LifeInsurancePolicyConfig): PolicyState {
    return {
      config,
      currentCoverageAmount: 0,
      currentMaxCoverage: config.coverage.maxCoverage,
      payoutMade: false,
      coverageActive: true,
      retiredPermanently: false,
      payoutDate: null,
      payoutAmount: 0,
      coverageActiveAtDeath: false,
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

      // Check unemployment (temporary)
      const evalDate = new Date(Date.UTC(year, 0, 1));
      if (this.jobLossManager.isUnemployed(config.insuredPerson, evalDate)) {
        state.coverageActive = false;
        this.log('coverage-deactivated-unemployed', { policy: config.name, year });
      } else {
        state.coverageActive = true;
      }
    }
  }

  private getInflationRate(state: PolicyState, year: number): number | null {
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
}
