import * as fs from 'fs';
import * as path from 'path';
import type { DebugLogger } from './debug-logger';
import type { MCRateGetter } from './types';
import { MonteCarloSampleType } from './types';
import { compoundMCInflation } from './mc-utils';
import { getAnnualDeathProbability } from './ssa-mortality';

// ===== Type Definitions =====

export type LTCState = 'healthy' | 'homeCare' | 'assistedLiving' | 'nursingHome' | 'deceased';

export interface LTCPersonState {
  currentState: LTCState;
  episodeCount: number;
  currentEpisodeStartMonth: number | null;
  eliminationDaysRemaining: number;
  benefitPoolRemaining: number;
  costFactor: number;
}

export interface LTCConfig {
  personName: string;
  gender: 'male' | 'female';
  birthDateVariable: string;
  hasInsurance: boolean;
  insurancePurchaseAge?: number;
  annualPremium?: number;
  premiumInflationRate?: number;
  dailyBenefitCap?: number;
  benefitInflationRate?: number;
  benefitPeriodYears?: number;
  eliminationDays?: number;
}

export interface LTCTransitionData {
  [ageBand: string]: {
    [gender: string]: {
      healthy_to_homeCare: number;
      healthy_to_assistedLiving: number;
      healthy_to_nursingHome: number;
      homeCare: { healthy: number; assistedLiving: number; nursingHome: number; deceased: number };
      assistedLiving: { healthy: number; nursingHome: number; deceased: number };
      nursingHome: { deceased: number; remain: number };
      mortality_multiplier: { homeCare: number; assistedLiving: number; nursingHome: number };
    };
  };
}

interface SSALifeTable {
  male: Record<string, number>;
  female: Record<string, number>;
}

// ===== Helper Functions =====

function getAgeBand(age: number): string {
  if (age < 65) return ''; // Under 65, no LTC modeling
  if (age < 70) return '65-69';
  if (age < 75) return '70-74';
  if (age < 80) return '75-79';
  if (age < 85) return '80-84';
  if (age < 90) return '85-89';
  return '90+';
}

function boxMullerNormal(random: () => number): number {
  const u1 = random();
  const u2 = random();
  const normalSample = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return normalSample;
}

// ===== MortalityManager =====

export class MortalityManager {
  private transitionData: LTCTransitionData;
  private configs: Map<string, LTCConfig>;
  private personStates: Map<string, LTCPersonState>;
  private costFactors: Map<string, number> = new Map();
  private baseCosts = { homeCare: 6300, assistedLiving: 5350, nursingHome: 9700 };
  private baseYear = 2024;
  private healthcareInflationRate = 0.05;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private mcRateGetter: MCRateGetter | null = null;
  private ssaLifeTable: SSALifeTable | null = null;
  private deathDates: Map<string, Date | null> = new Map();
  private personNameMapping: Map<string, string> = new Map();
  private checkpointData: string | null = null;
  private lockedSurvivorBenefits: Map<string, number> = new Map();
  private retirementPersonConfigs: Map<string, { birthDateVariable: string; gender: 'male' | 'female' }> = new Map();
  private deathCobraMonthsElapsed: Map<string, number> = new Map();  // Track months in death COBRA for each policyholder
  private lastDeathCobraMonth: Map<string, number | null> = new Map();  // Track last month COBRA was generated

  constructor(debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.transitionData = this.loadTransitionData();
    this.configs = this.loadConfigs();
    this.personStates = new Map();
    this.initializePersonStates();
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.loadSSAData();
  }

  /** Load SSA life table data from JSON file */
  private loadSSAData(): void {
    try {
      const ssaPath = path.join(__dirname, '../../../data/ssaLifeTable.json');
      this.ssaLifeTable = JSON.parse(fs.readFileSync(ssaPath, 'utf-8'));
      this.log('ssa-data-loaded', { loaded: true });
    } catch (e) {
      // SSA data optional — mortality features won't work without it
      this.log('ssa-data-load-failed', { error: String(e) });
      this.ssaLifeTable = null;
    }
  }

  /** Set the MC rate getter for sampling healthcare inflation in MC mode */
  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetter = getter;
  }

  /**
   * Get healthcare inflation rate for a given year.
   * In MC mode, uses the healthcare CPI draw. In deterministic, uses fixed 5%.
   */
  private getHealthcareInflationRateForYear(year: number): number {
    if (this.mcRateGetter) {
      const mcRate = this.mcRateGetter(MonteCarloSampleType.HEALTHCARE_INFLATION, year);
      if (mcRate !== null) return mcRate;
    }
    return this.healthcareInflationRate;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'mortality', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  private loadTransitionData(): LTCTransitionData {
    const dataPath = path.join(__dirname, '../../../data/ltcTransitions.json');
    const data = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(data);
  }

  private loadConfigs(): Map<string, LTCConfig> {
    const configPath = path.join(__dirname, '../../../data/ltcConfig.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    const configs: LTCConfig[] = JSON.parse(data);
    const map = new Map<string, LTCConfig>();
    configs.forEach((config) => {
      map.set(config.personName, config);
    });
    return map;
  }

  private initializePersonStates(): void {
    this.configs.forEach((config) => {
      const benefitPeriodYears = config.benefitPeriodYears ?? 4;
      const dailyBenefitCap = config.dailyBenefitCap ?? 200;
      const benefitPool = dailyBenefitCap * 365 * benefitPeriodYears;

      this.personStates.set(config.personName, {
        currentState: 'healthy',
        episodeCount: 0,
        currentEpisodeStartMonth: null,
        eliminationDaysRemaining: 0,
        benefitPoolRemaining: benefitPool,
        costFactor: 1.0,
      });
      this.log('person-initialized', { person: config.personName, benefit_pool: benefitPool, daily_benefit_cap: dailyBenefitCap });
    });
  }

  /**
   * Initialize person states for all people from retirement data (SocialSecurities).
   * This is called after construction to ensure all tracked persons can have mortality events,
   * not just those in ltcConfig.json. Persons already initialized (LTC configs) are skipped.
   */
  initializeRetirementPersonStates(socialSecurities: any[]): void {
    if (!socialSecurities || socialSecurities.length === 0) {
      this.log('retirement-persons-init-skipped', { reason: 'no_social_securities' });
      return;
    }

    for (const ss of socialSecurities) {
      if (!ss.name) continue;

      // Extract the person name (remove " Social Security" suffix if present)
      const personName = ss.name.replace(/ Social Security$/, '');

      // Skip if already initialized (from LTC config)
      if (this.personStates.has(personName)) {
        continue;
      }

      // Initialize with default person state for mortality tracking
      this.personStates.set(personName, {
        currentState: 'healthy',
        episodeCount: 0,
        currentEpisodeStartMonth: null,
        eliminationDaysRemaining: 0,
        benefitPoolRemaining: 0, // No LTC insurance
        costFactor: 1.0,
      });

      // Store the SS data for later retrieval (needed for annual mortality evaluation)
      // For now, we infer gender from ltcConfig if available, or default to 'male'
      // A better solution would be to add gender to the SocialSecurity data model
      const ltcConfig = this.configs.get(personName);
      const gender = ltcConfig?.gender ?? 'male';

      this.retirementPersonConfigs.set(personName, {
        birthDateVariable: ss.birthDateVariable,
        gender,
      });

      this.log('person-initialized-from-retirement', { person: personName, has_ltc_config: false, birthDateVariable: ss.birthDateVariable, gender });
    }
  }

  /**
   * Initialize cost factor once per person per simulation (lognormal)
   */
  private initializeCostFactor(random: () => number): number {
    const normalSample = boxMullerNormal(random);
    return Math.exp(normalSample * 0.25);
  }

  /**
   * Get recurrence multiplier based on episode count and target state
   */
  private getRecurrenceMultiplier(episodeCount: number, targetState: LTCState): number {
    if (episodeCount === 0) return 1.0;

    const multipliers: Record<number, Record<string, number>> = {
      1: { homeCare: 1.8, assistedLiving: 2.2, nursingHome: 2.5 },
      2: { homeCare: 2.5, assistedLiving: 3.0, nursingHome: 3.5 },
    };

    const caps: Record<string, number> = {
      homeCare: 3.0,
      assistedLiving: 3.5,
      nursingHome: 4.0,
    };

    if (episodeCount <= 2) {
      return multipliers[episodeCount]?.[targetState] ?? 1.0;
    }
    return caps[targetState] ?? 3.0;
  }

  /**
   * Get monthly death probability based on SSA life table and LTC state
   */
  getMonthlyDeathProbability(age: number, gender: 'male' | 'female', ltcState: LTCState): number {
    if (!this.ssaLifeTable) return 0;

    const annualQ = getAnnualDeathProbability(age, gender, this.ssaLifeTable);
    const monthlyBaseline = 1 - Math.pow(1 - annualQ, 1 / 12);

    if (ltcState === 'healthy') {
      return monthlyBaseline;
    }

    // For LTC care states, apply mortality multiplier from transition data
    const ageBand = getAgeBand(age);
    if (!ageBand) return monthlyBaseline;

    const transitions = this.transitionData[ageBand]?.[gender];
    if (!transitions) return monthlyBaseline;

    // Only apply multiplier for care states (not deceased or healthy)
    if (ltcState !== 'homeCare' && ltcState !== 'assistedLiving' && ltcState !== 'nursingHome') {
      return monthlyBaseline;
    }

    const multiplier = transitions.mortality_multiplier?.[ltcState] ?? 1.0;
    return Math.min(1, monthlyBaseline * multiplier);
  }

  /**
   * Step the Markov chain for one month
   */
  stepMonth(
    personName: string,
    ageInYears: number,
    gender: string,
    monthIndex: number,
    random: () => number,
  ): void {
    if (this.isDeceased(personName)) return;

    const state = this.personStates.get(personName);
    if (!state) return;

    const ageBand = getAgeBand(ageInYears);
    if (!ageBand) return; // Under 65, no LTC modeling
    this.log('age-band-determined', { person: personName, age: ageInYears, age_band: ageBand });
    const transitions = this.transitionData[ageBand]?.[gender];
    if (!transitions) return;

    this.log('monthly-step', { person: personName, age: ageInYears, current_state: state.currentState, month: monthIndex });

    // Initialize cost factor on transition to LTC (not on every month)
    if (!this.costFactors.has(personName)) {
      // Will be initialized when transitioning to LTC state
      this.costFactors.set(personName, 1.0);
    }

    const config = this.configs.get(personName);
    const isInsured = config?.hasInsurance ?? false;
    const MORAL_HAZARD_ENTRY_MULTIPLIER = isInsured ? 1.25 : 1.0;
    const MORAL_HAZARD_EXIT_MULTIPLIER = isInsured ? 0.85 : 1.0;

    // Check SSA-based death first (before Markov transitions)
    const deathProb = this.getMonthlyDeathProbability(ageInYears, gender as 'male' | 'female', state.currentState);
    if (random() < deathProb) {
      this.log('state-transition', { person: personName, from_state: state.currentState, to_state: 'deceased', probability: deathProb, source: 'ssa-mortality' });
      this.recordDeath(personName, new Date(this.currentDate));
      return;
    }

    const rand = random();

    // State transition logic
    if (state.currentState === 'healthy') {
      // From healthy: can go to home care, AL, NH, or stay healthy
      let probHomeCare = transitions.healthy_to_homeCare;
      let probAL = transitions.healthy_to_assistedLiving;
      let probNH = transitions.healthy_to_nursingHome;

      // Apply recurrence multiplier
      const hcMult = this.getRecurrenceMultiplier(state.episodeCount, 'homeCare');
      const alMult = this.getRecurrenceMultiplier(state.episodeCount, 'assistedLiving');
      const nhMult = this.getRecurrenceMultiplier(state.episodeCount, 'nursingHome');

      probHomeCare *= hcMult * MORAL_HAZARD_ENTRY_MULTIPLIER;
      probAL *= alMult * MORAL_HAZARD_ENTRY_MULTIPLIER;
      probNH *= nhMult * MORAL_HAZARD_ENTRY_MULTIPLIER;

      // Cap at 0.05 per month
      probHomeCare = Math.min(probHomeCare, 0.05);
      probAL = Math.min(probAL, 0.05);
      probNH = Math.min(probNH, 0.05);

      const cumHC = probHomeCare;
      const cumAL = cumHC + probAL;
      const cumNH = cumAL + probNH;

      if (rand < cumHC) {
        // Initialize cost factor on first LTC entry
        if (this.costFactors.get(personName) === 1.0) {
          this.costFactors.set(personName, this.initializeCostFactor(random));
          this.log('cost-factor-set', { person: personName, cost_factor: this.costFactors.get(personName) });
        }
        const prevState = state.currentState;
        state.currentState = 'homeCare';
        state.currentEpisodeStartMonth = monthIndex;
        state.eliminationDaysRemaining = config?.eliminationDays ?? 90;
        this.log('state-transition', { person: personName, from_state: prevState, to_state: 'homeCare', probability: cumHC });
        this.log('episode-started', { person: personName, state: 'homeCare', episode_count: state.episodeCount + 1 });
      } else if (rand < cumAL) {
        // Initialize cost factor on first LTC entry
        if (this.costFactors.get(personName) === 1.0) {
          this.costFactors.set(personName, this.initializeCostFactor(random));
          this.log('cost-factor-set', { person: personName, cost_factor: this.costFactors.get(personName) });
        }
        const prevState = state.currentState;
        state.currentState = 'assistedLiving';
        state.currentEpisodeStartMonth = monthIndex;
        state.eliminationDaysRemaining = config?.eliminationDays ?? 90;
        this.log('state-transition', { person: personName, from_state: prevState, to_state: 'assistedLiving', probability: cumAL - cumHC });
        this.log('episode-started', { person: personName, state: 'assistedLiving', episode_count: state.episodeCount + 1 });
      } else if (rand < cumNH) {
        // Initialize cost factor on first LTC entry
        if (this.costFactors.get(personName) === 1.0) {
          this.costFactors.set(personName, this.initializeCostFactor(random));
          this.log('cost-factor-set', { person: personName, cost_factor: this.costFactors.get(personName) });
        }
        const prevState = state.currentState;
        state.currentState = 'nursingHome';
        state.currentEpisodeStartMonth = monthIndex;
        state.eliminationDaysRemaining = config?.eliminationDays ?? 90;
        this.log('state-transition', { person: personName, from_state: prevState, to_state: 'nursingHome', probability: cumNH - cumAL });
        this.log('episode-started', { person: personName, state: 'nursingHome', episode_count: state.episodeCount + 1 });
      }
    } else if (state.currentState === 'homeCare') {
      // From home care: can recover to healthy, progress to AL/NH, or die (SSA check handled above)
      const probs = transitions.homeCare;
      const probHealthy = probs.healthy * MORAL_HAZARD_EXIT_MULTIPLIER;
      const probAL = probs.assistedLiving;
      const probNH = probs.nursingHome;

      const cumHealthy = probHealthy;
      const cumAL = cumHealthy + probAL;
      const cumNH = cumAL + probNH;

      if (rand < cumHealthy) {
        this.log('state-transition', { person: personName, from_state: 'homeCare', to_state: 'healthy', probability: probHealthy });
        state.currentState = 'healthy';
        state.episodeCount++;
        state.currentEpisodeStartMonth = null;
      } else if (rand < cumAL) {
        this.log('state-transition', { person: personName, from_state: 'homeCare', to_state: 'assistedLiving', probability: probAL });
        state.currentState = 'assistedLiving';
        // Same episode continues, elimination continues counting down
      } else if (rand < cumNH) {
        this.log('state-transition', { person: personName, from_state: 'homeCare', to_state: 'nursingHome', probability: probNH });
        state.currentState = 'nursingHome';
        // Same episode continues
      }
    } else if (state.currentState === 'assistedLiving') {
      // From AL: can rarely recover to healthy, progress to NH, or die (SSA check handled above)
      const probs = transitions.assistedLiving;
      const probHealthy = (probs.healthy ?? 0) * MORAL_HAZARD_EXIT_MULTIPLIER;
      const probNH = probs.nursingHome;

      const cumHealthy = probHealthy;
      const cumNH = cumHealthy + probNH;

      if (rand < cumHealthy) {
        this.log('state-transition', { person: personName, from_state: 'assistedLiving', to_state: 'healthy', probability: probHealthy });
        state.currentState = 'healthy';
        state.episodeCount++;
        state.currentEpisodeStartMonth = null;
      } else if (rand < cumNH) {
        this.log('state-transition', { person: personName, from_state: 'assistedLiving', to_state: 'nursingHome', probability: probNH });
        state.currentState = 'nursingHome';
        // Same episode continues
      }
    } else if (state.currentState === 'nursingHome') {
      // From NH: can remain (SSA death check handled above)
      // No other transitions from nursing home except death
    }

    // Decrement elimination period
    if (state.eliminationDaysRemaining > 0) {
      state.eliminationDaysRemaining -= 30;
      this.log('elimination-tracked', { person: personName, remaining_days: state.eliminationDaysRemaining });
    }
  }

  /**
   * Compute compound healthcare inflation multiplier from baseYear to targetYear.
   * Delegates to shared compoundMCInflation utility.
   */
  compoundHealthcareInflation(targetYear: number): number {
    return compoundMCInflation(
      this.baseYear, targetYear, this.healthcareInflationRate,
      this.mcRateGetter, MonteCarloSampleType.HEALTHCARE_INFLATION,
    );
  }

  /**
   * Get monthly cost for a person in their current state
   */
  getMonthlyCost(personName: string, year: number): number {
    const state = this.personStates.get(personName);
    if (!state || state.currentState === 'healthy' || state.currentState === 'deceased') {
      return 0;
    }

    const baseCost = this.baseCosts[state.currentState] ?? 0;
    const inflated = baseCost * this.compoundHealthcareInflation(year);
    const costFactor = this.costFactors.get(personName) ?? 1.0;
    return inflated * costFactor;
  }

  /**
   * Get insurance benefit for a person
   */
  getInsuranceBenefit(personName: string, monthlyCost: number, year: number, birthYear: number): number {
    const state = this.personStates.get(personName);
    const config = this.configs.get(personName);

    if (!config?.hasInsurance || !state) return 0;

    // Only pay benefits if person is actually in care (not healthy or deceased)
    if (state.currentState === 'healthy' || state.currentState === 'deceased') return 0;

    // Check elimination period
    if (state.eliminationDaysRemaining > 0) return 0;

    // Check benefit pool
    if (state.benefitPoolRemaining <= 0) return 0;

    // Calculate inflated monthly benefit cap
    const purchaseAge = config.insurancePurchaseAge ?? 60;
    const yearsSincePurchase = year - (birthYear + purchaseAge);
    const benefitInflationRate = config.benefitInflationRate ?? 0.03;
    const dailyBenefitCap = config.dailyBenefitCap ?? 200;
    const monthlyBenefitCap = dailyBenefitCap * 30 * Math.pow(1 + benefitInflationRate, yearsSincePurchase);

    // Insurance pays up to cap, deducted from pool
    const benefit = Math.min(monthlyCost, monthlyBenefitCap, state.benefitPoolRemaining);
    state.benefitPoolRemaining -= benefit;
    this.log('benefit-pool-used', { person: personName, cost: monthlyCost, benefit_applied: benefit, pool_remaining: state.benefitPoolRemaining });

    return benefit;
  }

  /**
   * Get net monthly cost (gross - insurance benefit)
   */
  getNetMonthlyCost(personName: string, year: number, birthYear: number): number {
    const grossCost = this.getMonthlyCost(personName, year);
    const benefit = this.getInsuranceBenefit(personName, grossCost, year, birthYear);
    return grossCost - benefit;
  }

  /**
   * Get person state
   */
  getPersonState(personName: string): LTCPersonState | undefined {
    return this.personStates.get(personName);
  }

  /**
   * Get config for a person
   */
  getConfig(personName: string): LTCConfig | undefined {
    return this.configs.get(personName);
  }

  /**
   * Get retirement person config (for persons initialized from Social Security, not LTC config)
   */
  getRetirementPersonConfig(personName: string): { birthDateVariable: string; gender: 'male' | 'female' } | undefined {
    return this.retirementPersonConfigs.get(personName);
  }

  /**
   * Get the SSA life table data (for use by other managers, e.g. InheritanceManager)
   */
  getSSALifeTable(): Record<string, Record<string, number>> {
    return this.ssaLifeTable as Record<string, Record<string, number>>;
  }

  /**
   * Get all configs
   */
  getAllConfigs(): LTCConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Get expected monthly cost (deterministic mode) without state transitions
   */
  getExpectedMonthlyCost(age: number, gender: string, year: number): number {
    const ageBand = getAgeBand(age);
    if (!ageBand) return 0; // Under 65, no LTC modeling
    const t = this.transitionData[ageBand]?.[gender];
    if (!t) return 0;

    // Expected cost = sum of (probability of being in state × state cost)
    const pHome = t.healthy_to_homeCare;
    const pAL = t.healthy_to_assistedLiving;
    const pNH = t.healthy_to_nursingHome;

    const inflationMultiplier = this.compoundHealthcareInflation(year);
    const costs = {
      homeCare: this.baseCosts.homeCare * inflationMultiplier,
      assistedLiving: this.baseCosts.assistedLiving * inflationMultiplier,
      nursingHome: this.baseCosts.nursingHome * inflationMultiplier,
    };

    return pHome * costs.homeCare + pAL * costs.assistedLiving + pNH * costs.nursingHome;
  }

  /**
   * Check if a person is deceased
   */
  isDeceased(person: string): boolean {
    const state = this.personStates.get(person);
    return state ? state.currentState === 'deceased' : false;
  }

  /**
   * Extract person name from SS/Pension entity names.
   * Strips known suffixes like " Social Security" to get the canonical person name.
   */
  extractPersonNameFromEntity(entityName: string): string {
    if (!entityName) return entityName;
    return entityName.replace(/ Social Security$/, '').replace(/ Pension$/, '');
  }

  /**
   * Check if the owner of an account is deceased.
   * If account has explicit person, use it. Otherwise fall back to name matching.
   * Matches account names like "Jake 401(k)" or "Kendall Checking" to tracked person names.
   * Returns true if any tracked person's name appears in the account name and that person is deceased.
   * Handles SS/Pension names by stripping suffixes (e.g., "Jake Social Security" → "Jake").
   */
  isAccountOwnerDeceased(accountName: string, accountPerson?: string | null): boolean {
    if (!accountName && !accountPerson) return false;

    // If account has explicit person, use it
    if (accountPerson) {
      return this.isDeceased(accountPerson);
    }

    // Fallback: check if any deceased person's name appears in account name
    for (const person of this.personStates.keys()) {
      if (accountName.toLowerCase().includes(person.toLowerCase())) {
        // Found the person — check if they're deceased
        if (this.isDeceased(person)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get the death date for a person (null if still alive)
   */
  getDeathDate(person: string): Date | null {
    return this.deathDates.get(person) ?? null;
  }

  /**
   * Get months elapsed in death-triggered COBRA for a policyholder
   */
  getDeathCobraMonthsElapsed(person: string): number {
    return this.deathCobraMonthsElapsed.get(person) ?? 0;
  }

  /**
   * Increment the death COBRA month counter for a policyholder
   */
  incrementDeathCobraMonth(person: string): void {
    const current = this.deathCobraMonthsElapsed.get(person) ?? 0;
    this.deathCobraMonthsElapsed.set(person, current + 1);
  }

  /**
   * Get the last month death COBRA was generated (0-11)
   */
  getLastDeathCobraMonth(person: string): number | null {
    return this.lastDeathCobraMonth.get(person) ?? null;
  }

  /**
   * Set the last month death COBRA was generated (0-11)
   */
  setLastDeathCobraMonth(person: string, month: number): void {
    this.lastDeathCobraMonth.set(person, month);
  }

  /**
   * Check if a policyholder is in the death COBRA period (within 36 months of death)
   */
  isInDeathCobra(person: string): boolean {
    const deathDate = this.getDeathDate(person);
    if (!deathDate) return false;
    const monthsElapsed = this.getDeathCobraMonthsElapsed(person);
    return monthsElapsed < 36;
  }

  /**
   * Check if all tracked persons are deceased
   * Returns false if no persons tracked (no LTC config = no mortality modeling)
   */
  allDeceased(): boolean {
    if (this.personStates.size === 0) return false;
    for (const [, state] of this.personStates) {
      if (state.currentState !== 'deceased') return false;
    }
    return true;
  }

  /**
   * Get list of persons still alive
   */
  getAlivePeople(): string[] {
    const alive: string[] = [];
    for (const [person, state] of this.personStates) {
      if (state.currentState !== 'deceased') {
        alive.push(person);
      }
    }
    return alive;
  }

  /**
   * Get filing status based on alive persons and death year rule
   * MFJ if both alive, single if one alive, MFJ for death year then single
   * @param date - Must be provided for year-of-death rule to apply correctly
   */
  getFilingStatus(date?: Date): 'single' | 'mfj' {
    const alive = this.getAlivePeople();
    if (alive.length >= 2) return 'mfj';
    if (alive.length === 0) return 'single';

    // One person dead — check year-of-death rule
    for (const [person, deathDate] of this.deathDates) {
      if (deathDate && date) {
        if (date.getUTCFullYear() === deathDate.getUTCFullYear()) {
          return 'mfj'; // MFJ for year of death
        }
      }
    }
    return 'single';
  }

  /**
   * Set person name mapping (config name to canonical name)
   */
  setPersonNameMapping(configName: string, canonicalName: string): void {
    this.personNameMapping.set(configName, canonicalName);
  }

  /**
   * Get canonical name for a person (from config)
   */
  getCanonicalName(configName: string): string {
    return this.personNameMapping.get(configName) ?? configName;
  }

  /**
   * Record death event with current date
   */
  recordDeath(person: string, date: Date): void {
    const state = this.personStates.get(person);
    if (state) {
      state.currentState = 'deceased';
      // Ensure date is valid; if not, use today's date as fallback
      let deathDate = date;
      if (isNaN(date.getTime())) {
        deathDate = new Date();
      }
      this.deathDates.set(person, deathDate);
      this.log('death-recorded', { person, date: deathDate.toISOString() });
    }
  }

  /**
   * Lock a person's SS benefit when they die
   * Survivor spouse will use max(own benefit, deceased's locked benefit)
   */
  lockSurvivorBenefit(person: string, monthlyBenefit: number): void {
    this.lockedSurvivorBenefits.set(person, monthlyBenefit);
    this.log('survivor-benefit-locked', { person, monthly_benefit: monthlyBenefit });
  }

  /**
   * Get the locked survivor benefit for a deceased person
   * Returns 0 if person not deceased or benefit not locked
   */
  getLockedSurvivorBenefit(person: string): number {
    return this.lockedSurvivorBenefits.get(person) ?? 0;
  }

  /**
   * Evaluate annual mortality for under-65 persons (outside of monthly LTC checks)
   * For age >= 65, death is handled by stepMonth monthly checks
   */
  evaluateAnnualMortality(person: string, age: number, gender: 'male' | 'female', date: Date, random: () => number): void {
    this.log('annual-mortality-eval-start', { person, age, gender, isDeceased: this.isDeceased(person) });

    if (this.isDeceased(person)) return;
    if (age >= 65) return; // Monthly checks handle 65+

    if (!this.ssaLifeTable) {
      this.log('annual-mortality-no-ssa-table', { person, age, gender });
      return;
    }

    const annualQ = getAnnualDeathProbability(age, gender, this.ssaLifeTable);
    const roll = random();

    this.log('annual-mortality-roll', { person, age, gender, annualQ, roll, willDie: roll < annualQ });

    if (roll < annualQ) {
      this.recordDeath(person, date);
      this.log('annual-mortality-check', { person, age, gender, died: true });
    }
  }

  /**
   * Save a checkpoint of mortality state.
   * Used for push/pull reprocessing to restore state if segment needs to be recomputed.
   */
  checkpoint(): void {
    // Deep-clone all state via JSON serialization
    const personStatesObj: Record<string, LTCPersonState> = {};
    for (const [person, state] of this.personStates) {
      personStatesObj[person] = { ...state };
    }

    const deathDatesObj: Record<string, string | null> = {};
    for (const [person, date] of this.deathDates) {
      deathDatesObj[person] = date ? date.toISOString() : null;
    }

    const nameMapObj: Record<string, string> = {};
    for (const [config, canonical] of this.personNameMapping) {
      nameMapObj[config] = canonical;
    }

    const costFactorsObj: Record<string, number> = {};
    for (const [person, factor] of this.costFactors) {
      costFactorsObj[person] = factor;
    }

    const survivorBenefitsObj: Record<string, number> = {};
    for (const [person, benefit] of this.lockedSurvivorBenefits) {
      survivorBenefitsObj[person] = benefit;
    }

    const deathCobraMonthsElapsedObj: Record<string, number> = {};
    for (const [person, months] of this.deathCobraMonthsElapsed) {
      deathCobraMonthsElapsedObj[person] = months;
    }

    const lastDeathCobraMonthObj: Record<string, number | null> = {};
    for (const [person, month] of this.lastDeathCobraMonth) {
      lastDeathCobraMonthObj[person] = month;
    }

    this.checkpointData = JSON.stringify({
      personStates: personStatesObj,
      deathDates: deathDatesObj,
      personNameMapping: nameMapObj,
      costFactors: costFactorsObj,
      lockedSurvivorBenefits: survivorBenefitsObj,
      deathCobraMonthsElapsed: deathCobraMonthsElapsedObj,
      lastDeathCobraMonth: lastDeathCobraMonthObj,
    });
  }

  /**
   * Restore mortality state from the last checkpoint.
   * Used when segment is reprocessed after push/pull handling.
   */
  restore(): void {
    if (!this.checkpointData) return;

    try {
      const data = JSON.parse(this.checkpointData) as {
        personStates: Record<string, LTCPersonState>;
        deathDates: Record<string, string | null>;
        personNameMapping: Record<string, string>;
        costFactors: Record<string, number>;
        lockedSurvivorBenefits?: Record<string, number>;
        deathCobraMonthsElapsed?: Record<string, number>;
        lastDeathCobraMonth?: Record<string, number | null>;
      };

      // Restore person states
      this.personStates.clear();
      for (const [person, state] of Object.entries(data.personStates)) {
        this.personStates.set(person, { ...state });
      }

      // Restore death dates (convert ISO strings back to Dates)
      this.deathDates.clear();
      for (const [person, dateStr] of Object.entries(data.deathDates)) {
        this.deathDates.set(person, dateStr ? new Date(dateStr) : null);
      }

      // Restore person name mapping
      this.personNameMapping.clear();
      for (const [config, canonical] of Object.entries(data.personNameMapping)) {
        this.personNameMapping.set(config, canonical);
      }

      // Restore cost factors
      this.costFactors.clear();
      for (const [person, factor] of Object.entries(data.costFactors)) {
        this.costFactors.set(person, factor);
      }

      // Restore locked survivor benefits
      this.lockedSurvivorBenefits.clear();
      if (data.lockedSurvivorBenefits) {
        for (const [person, benefit] of Object.entries(data.lockedSurvivorBenefits)) {
          this.lockedSurvivorBenefits.set(person, benefit);
        }
      }

      // Restore death COBRA months elapsed
      this.deathCobraMonthsElapsed.clear();
      if (data.deathCobraMonthsElapsed) {
        for (const [person, months] of Object.entries(data.deathCobraMonthsElapsed)) {
          this.deathCobraMonthsElapsed.set(person, months);
        }
      }

      // Restore last death COBRA month
      this.lastDeathCobraMonth.clear();
      if (data.lastDeathCobraMonth) {
        for (const [person, month] of Object.entries(data.lastDeathCobraMonth)) {
          this.lastDeathCobraMonth.set(person, month);
        }
      }
    } catch (e) {
      this.log('checkpoint-restore-failed', { error: String(e) });
    }
  }

  /**
   * Reset person states (for new simulation)
   */
  resetPersonStates(): void {
    this.initializePersonStates();
    this.costFactors.clear();
    this.deathDates.clear();
    this.lockedSurvivorBenefits.clear();
    this.deathCobraMonthsElapsed.clear();
    this.lastDeathCobraMonth.clear();
    // Do NOT clear personNameMapping — it's configuration, not per-simulation state
  }

  /**
   * Get all death dates (person -> ISO string or null if alive)
   * Returns map of all tracked persons with their death dates
   */
  getDeathDates(): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const [person, state] of this.personStates) {
      const deathDate = this.deathDates.get(person);
      result[person] = deathDate ? deathDate.toISOString() : null;
    }
    return result;
  }
}
