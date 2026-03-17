import * as fs from 'fs';
import * as path from 'path';

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

// ===== LTCManager =====

export class LTCManager {
  private transitionData: LTCTransitionData;
  private configs: Map<string, LTCConfig>;
  private personStates: Map<string, LTCPersonState>;
  private costFactors: Map<string, number> = new Map();
  private baseCosts = { homeCare: 6300, assistedLiving: 5350, nursingHome: 9700 };
  private baseYear = 2024;
  private healthcareInflationRate = 0.05;

  constructor() {
    this.transitionData = this.loadTransitionData();
    this.configs = this.loadConfigs();
    this.personStates = new Map();
    this.initializePersonStates();
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
    });
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
   * Step the Markov chain for one month
   */
  stepMonth(
    personName: string,
    ageInYears: number,
    gender: string,
    monthIndex: number,
    random: () => number,
  ): void {
    const state = this.personStates.get(personName);
    if (!state || state.currentState === 'deceased') return;

    const ageBand = getAgeBand(ageInYears);
    if (!ageBand) return; // Under 65, no LTC modeling
    const transitions = this.transitionData[ageBand]?.[gender];
    if (!transitions) return;

    // Initialize cost factor on transition to LTC (not on every month)
    if (!this.costFactors.has(personName)) {
      // Will be initialized when transitioning to LTC state
      this.costFactors.set(personName, 1.0);
    }

    const config = this.configs.get(personName);
    const isInsured = config?.hasInsurance ?? false;
    const MORAL_HAZARD_ENTRY_MULTIPLIER = isInsured ? 1.25 : 1.0;
    const MORAL_HAZARD_EXIT_MULTIPLIER = isInsured ? 0.85 : 1.0;

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
        }
        state.currentState = 'homeCare';
        state.currentEpisodeStartMonth = monthIndex;
        state.eliminationDaysRemaining = config?.eliminationDays ?? 90;
      } else if (rand < cumAL) {
        // Initialize cost factor on first LTC entry
        if (this.costFactors.get(personName) === 1.0) {
          this.costFactors.set(personName, this.initializeCostFactor(random));
        }
        state.currentState = 'assistedLiving';
        state.currentEpisodeStartMonth = monthIndex;
        state.eliminationDaysRemaining = config?.eliminationDays ?? 90;
      } else if (rand < cumNH) {
        // Initialize cost factor on first LTC entry
        if (this.costFactors.get(personName) === 1.0) {
          this.costFactors.set(personName, this.initializeCostFactor(random));
        }
        state.currentState = 'nursingHome';
        state.currentEpisodeStartMonth = monthIndex;
        state.eliminationDaysRemaining = config?.eliminationDays ?? 90;
      }
    } else if (state.currentState === 'homeCare') {
      // From home care: can recover to healthy, progress to AL/NH, or die
      const probs = transitions.homeCare;
      const probHealthy = probs.healthy * MORAL_HAZARD_EXIT_MULTIPLIER;
      const probAL = probs.assistedLiving;
      const probNH = probs.nursingHome;
      const probDeceased = probs.deceased;

      const cumHealthy = probHealthy;
      const cumAL = cumHealthy + probAL;
      const cumNH = cumAL + probNH;

      if (rand < cumHealthy) {
        state.currentState = 'healthy';
        state.episodeCount++;
        state.currentEpisodeStartMonth = null;
      } else if (rand < cumAL) {
        state.currentState = 'assistedLiving';
        // Same episode continues, elimination continues counting down
      } else if (rand < cumNH) {
        state.currentState = 'nursingHome';
        // Same episode continues
      } else {
        state.currentState = 'deceased';
      }
    } else if (state.currentState === 'assistedLiving') {
      // From AL: can rarely recover to healthy, progress to NH, or die
      const probs = transitions.assistedLiving;
      const probHealthy = (probs.healthy ?? 0) * MORAL_HAZARD_EXIT_MULTIPLIER;
      const probNH = probs.nursingHome;
      const probDeceased = probs.deceased;

      const cumHealthy = probHealthy;
      const cumNH = cumHealthy + probNH;

      if (rand < cumHealthy) {
        state.currentState = 'healthy';
        state.episodeCount++;
        state.currentEpisodeStartMonth = null;
      } else if (rand < cumNH) {
        state.currentState = 'nursingHome';
        // Same episode continues
      } else {
        state.currentState = 'deceased';
      }
    } else if (state.currentState === 'nursingHome') {
      // From NH: can die or remain
      const probs = transitions.nursingHome;
      const probDeceased = probs.deceased;

      if (rand < probDeceased) {
        state.currentState = 'deceased';
      }
      // else remain in nursing home
    }

    // Decrement elimination period
    if (state.eliminationDaysRemaining > 0) {
      state.eliminationDaysRemaining -= 30;
    }
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
    const inflated = baseCost * Math.pow(1 + this.healthcareInflationRate, year - this.baseYear);
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

    const costs = {
      homeCare: this.baseCosts.homeCare * Math.pow(1 + this.healthcareInflationRate, year - this.baseYear),
      assistedLiving:
        this.baseCosts.assistedLiving * Math.pow(1 + this.healthcareInflationRate, year - this.baseYear),
      nursingHome: this.baseCosts.nursingHome * Math.pow(1 + this.healthcareInflationRate, year - this.baseYear),
    };

    return pHome * costs.homeCare + pAL * costs.assistedLiving + pNH * costs.nursingHome;
  }

  /**
   * Reset person states (for new simulation)
   */
  resetPersonStates(): void {
    this.initializePersonStates();
    this.costFactors.clear();
  }
}
