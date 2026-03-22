/**
 * InheritanceManager — models benefactor estate drawdown and inheritance payouts.
 *
 * In MC mode, parent death ages are sampled from SSA life tables.
 * In deterministic mode, inheritance triggers when the youngest parent
 * reaches `deterministicTriggerAge`.
 *
 * Drawdown reduces the estate each year while any parent is alive,
 * optionally modulated by healthcare inflation.
 */

import type { DebugLogger } from './debug-logger';
import type { MCRateGetter } from './types';
import { MonteCarloSampleType } from './types';
import { getAnnualDeathProbability, SSALifeTable } from './ssa-mortality';
import { ManagerPayout, createPayoutActivity } from './manager-payout';
import { loadVariable } from '../simulation/variable';

// ===== Public Types =====

export interface BenefactorConfig {
  id: string;
  name: string;
  person: string | null;
  depositAccountId: string;
  estimatedPostTaxEstateValue: number;
  parents: Array<{ name: string; gender: 'male' | 'female'; birthDate: string }>;
  drawdown: {
    tiers: Array<{ minAge: number; maxAge: number; baseRate: number }>;
    healthcareInflationModulated: boolean;
    healthcareInflationVariable: string;
    referenceHealthcareRate: number;
  };
  deterministicTriggerAge: number;
  enabled: boolean;
}

/** Minimal interface for the mortality manager dependency. */
export interface MortalityGate {
  isDeceased(person: string): boolean;
  allDeceased(): boolean;
}

// ===== Internal State =====

interface BenefactorState {
  config: BenefactorConfig;
  currentEstateValue: number;
  parentDeathDates: Map<string, Date | null>;
  inheritancePaid: boolean;
  inheritancePaidDate: Date | null;
  blocked: boolean;
  lastDrawdownYear: number;
}

// ===== InheritanceManager =====

export class InheritanceManager {
  private states: Map<string, BenefactorState> = new Map();
  private ssaLifeTable: SSALifeTable;
  private mortalityManager: MortalityGate;
  private simulation: string;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private mcRateGetter: MCRateGetter | null = null;
  private payoutBuffer: ManagerPayout[] = [];

  constructor(
    configs: BenefactorConfig[],
    ssaLifeTable: SSALifeTable,
    mortalityManager: MortalityGate,
    simulation: string,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
  ) {
    this.ssaLifeTable = ssaLifeTable;
    this.mortalityManager = mortalityManager;
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

  evaluateYear(year: number, prng?: () => number): void {
    for (const [, state] of this.states) {
      if (!state.config.enabled || state.inheritancePaid) continue;
      this.evaluateBenefactor(state, year, prng);
    }
  }

  getPayoutActivities(): ManagerPayout[] {
    const payouts = [...this.payoutBuffer];
    this.payoutBuffer = [];
    return payouts;
  }

  checkpoint(): string {
    const serialised: Record<string, unknown> = {};
    for (const [id, state] of this.states) {
      const parentDeathDates: Record<string, string | null> = {};
      for (const [name, date] of state.parentDeathDates) {
        parentDeathDates[name] = date ? date.toISOString() : null;
      }
      serialised[id] = {
        currentEstateValue: state.currentEstateValue,
        parentDeathDates,
        inheritancePaid: state.inheritancePaid,
        inheritancePaidDate: state.inheritancePaidDate ? state.inheritancePaidDate.toISOString() : null,
        blocked: state.blocked,
        lastDrawdownYear: state.lastDrawdownYear,
      };
    }
    return JSON.stringify(serialised);
  }

  restore(data: string): void {
    const parsed = JSON.parse(data) as Record<
      string,
      {
        currentEstateValue: number;
        parentDeathDates: Record<string, string | null>;
        inheritancePaid: boolean;
        inheritancePaidDate: string | null;
        blocked: boolean;
        lastDrawdownYear: number;
      }
    >;

    for (const [id, snap] of Object.entries(parsed)) {
      const state = this.states.get(id);
      if (!state) continue;
      state.currentEstateValue = snap.currentEstateValue;
      state.inheritancePaid = snap.inheritancePaid;
      state.inheritancePaidDate = snap.inheritancePaidDate ? new Date(snap.inheritancePaidDate) : null;
      state.blocked = snap.blocked;
      state.lastDrawdownYear = snap.lastDrawdownYear;
      state.parentDeathDates.clear();
      for (const [name, dateStr] of Object.entries(snap.parentDeathDates)) {
        state.parentDeathDates.set(name, dateStr ? new Date(dateStr) : null);
      }
    }
  }

  resetBenefactorStates(): void {
    for (const [id, state] of this.states) {
      const fresh = this.createInitialState(state.config);
      this.states.set(id, fresh);
    }
    this.payoutBuffer = [];
  }

  getResults(): Array<{
    benefactorId: string;
    parentDeathDates: Record<string, string | null>;
    inheritancePaidDate: string | null;
    inheritanceAmount: number;
    blocked: boolean;
  }> {
    const results: Array<{
      benefactorId: string;
      parentDeathDates: Record<string, string | null>;
      inheritancePaidDate: string | null;
      inheritanceAmount: number;
      blocked: boolean;
    }> = [];

    for (const [, state] of this.states) {
      const parentDeathDates: Record<string, string | null> = {};
      for (const [name, date] of state.parentDeathDates) {
        parentDeathDates[name] = date ? date.toISOString() : null;
      }
      results.push({
        benefactorId: state.config.id,
        parentDeathDates,
        inheritancePaidDate: state.inheritancePaidDate ? state.inheritancePaidDate.toISOString() : null,
        inheritanceAmount: state.currentEstateValue,
        blocked: state.blocked,
      });
    }
    return results;
  }

  // ---- Private helpers ----

  private createInitialState(config: BenefactorConfig): BenefactorState {
    const parentDeathDates = new Map<string, Date | null>();
    for (const parent of config.parents) {
      parentDeathDates.set(parent.name, null);
    }
    return {
      config,
      currentEstateValue: config.estimatedPostTaxEstateValue,
      parentDeathDates,
      inheritancePaid: false,
      inheritancePaidDate: null,
      blocked: false,
      lastDrawdownYear: -1,
    };
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'inheritance', event, ...data });
  }

  private evaluateBenefactor(state: BenefactorState, year: number, prng?: () => number): void {
    const config = state.config;

    // Step 1: Evaluate parent mortality
    if (prng) {
      this.evaluateParentMortalityMC(state, year, prng);
    } else {
      this.evaluateParentMortalityDeterministic(state, year);
    }

    // Step 2: Drawdown while any parent is alive
    const anyParentAlive = this.anyParentAlive(state);
    if (anyParentAlive && state.lastDrawdownYear !== year) {
      this.applyDrawdown(state, year);
      state.lastDrawdownYear = year;
    }

    // Step 3: If all parents dead, attempt payout
    if (!this.anyParentAlive(state)) {
      this.attemptPayout(state, year);
    }
  }

  private evaluateParentMortalityMC(state: BenefactorState, year: number, prng: () => number): void {
    for (const parent of state.config.parents) {
      // Skip if already dead
      if (state.parentDeathDates.get(parent.name) !== null) continue;

      const birthYear = new Date(parent.birthDate).getUTCFullYear();
      const age = year - birthYear;
      if (age < 0) continue;

      const prob = getAnnualDeathProbability(age, parent.gender, this.ssaLifeTable);
      const roll = prng();

      this.log('parent-mortality-roll', { benefactor: state.config.name, parent: parent.name, age, prob, roll });

      if (roll < prob) {
        state.parentDeathDates.set(parent.name, new Date(Date.UTC(year, 0, 1)));
        this.log('parent-died', { benefactor: state.config.name, parent: parent.name, age, year });
      }
    }
  }

  private evaluateParentMortalityDeterministic(state: BenefactorState, year: number): void {
    // Find youngest parent's age
    let youngestAge = Infinity;
    for (const parent of state.config.parents) {
      const birthYear = new Date(parent.birthDate).getUTCFullYear();
      const age = year - birthYear;
      if (age < youngestAge) youngestAge = age;
    }

    if (youngestAge >= state.config.deterministicTriggerAge) {
      // Mark all parents as deceased
      for (const parent of state.config.parents) {
        if (state.parentDeathDates.get(parent.name) === null) {
          state.parentDeathDates.set(parent.name, new Date(Date.UTC(year, 0, 1)));
          this.log('parent-died-deterministic', { benefactor: state.config.name, parent: parent.name, year });
        }
      }
    }
  }

  private anyParentAlive(state: BenefactorState): boolean {
    for (const [, deathDate] of state.parentDeathDates) {
      if (deathDate === null) return true;
    }
    return false;
  }

  private applyDrawdown(state: BenefactorState, year: number): void {
    if (state.currentEstateValue <= 0) return;

    // Find oldest living parent's age
    let oldestAge = -Infinity;
    for (const parent of state.config.parents) {
      if (state.parentDeathDates.get(parent.name) !== null) continue;
      const birthYear = new Date(parent.birthDate).getUTCFullYear();
      const age = year - birthYear;
      if (age > oldestAge) oldestAge = age;
    }

    if (oldestAge === -Infinity) return; // no living parents

    // Find matching tier
    const tier = state.config.drawdown.tiers.find(
      (t) => oldestAge >= t.minAge && oldestAge <= t.maxAge,
    );
    if (!tier) return;

    let rate = tier.baseRate;

    // Modulate by healthcare inflation if enabled
    if (state.config.drawdown.healthcareInflationModulated) {
      const healthcareRate = this.getHealthcareInflationRate(state, year);
      const refRate = state.config.drawdown.referenceHealthcareRate;
      if (refRate > 0) {
        rate = tier.baseRate * (healthcareRate / refRate);
      }
    }

    const drawdownAmount = state.currentEstateValue * rate;
    state.currentEstateValue = Math.max(0, state.currentEstateValue - drawdownAmount);

    this.log('drawdown-applied', {
      benefactor: state.config.name,
      year,
      oldestAge,
      rate,
      drawdownAmount,
      remainingEstate: state.currentEstateValue,
    });
  }

  private getHealthcareInflationRate(state: BenefactorState, year: number): number {
    // MC mode: use mcRateGetter
    if (this.mcRateGetter) {
      const mcRate = this.mcRateGetter(MonteCarloSampleType.HEALTHCARE_INFLATION, year);
      if (mcRate !== null) return mcRate;
    }

    // Deterministic mode: load from simulation variable
    const varName = state.config.drawdown.healthcareInflationVariable;
    if (varName) {
      try {
        const val = loadVariable(varName, this.simulation);
        if (typeof val === 'number') return val;
        this.log('healthcare-variable-not-numeric', { variable: varName, type: typeof val });
      } catch {
        // fall through to reference rate
      }
    }

    return state.config.drawdown.referenceHealthcareRate;
  }

  private attemptPayout(state: BenefactorState, year: number): void {
    if (state.inheritancePaid) return;

    const config = state.config;

    // Person gating
    if (config.person !== null) {
      // Specific person — blocked if that person is deceased
      if (this.mortalityManager.isDeceased(config.person)) {
        state.inheritancePaid = true;
        state.blocked = true;
        this.log('payout-blocked-person-deceased', { benefactor: config.name, person: config.person });
        return;
      }
    } else {
      // Null person — blocked if all tracked persons are deceased
      if (this.mortalityManager.allDeceased()) {
        state.inheritancePaid = true;
        state.blocked = true;
        this.log('payout-blocked-all-deceased', { benefactor: config.name });
        return;
      }
    }

    // Create payout
    if (state.currentEstateValue > 0) {
      const activity = createPayoutActivity(
        `inheritance-${config.id}-${year}`,
        `${year}-01-15`,
        `Inheritance from ${config.name}`,
        state.currentEstateValue,
        'Income.Inheritance',
      );

      this.payoutBuffer.push({
        activity,
        targetAccountId: config.depositAccountId,
        incomeSourceName: 'Income.Inheritance',
      });

      this.log('payout-created', {
        benefactor: config.name,
        amount: state.currentEstateValue,
        year,
        depositAccount: config.depositAccountId,
      });
    }

    state.inheritancePaid = true;
    state.inheritancePaidDate = new Date(Date.UTC(year, 0, 15));
  }
}
