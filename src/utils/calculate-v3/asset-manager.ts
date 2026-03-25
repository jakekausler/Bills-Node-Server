/**
 * AssetManager — models asset value changes (appreciation/depreciation) and
 * replacement cycles with MC-sampled failure distributions.
 *
 * In MC mode, replacement timing is sampled from failure distributions using a seeded PRNG.
 * In deterministic mode, replacements trigger at expectedYears.
 *
 * Asset values appreciate or depreciate each year, and replacement events buffer activities
 * as ManagerPayouts for injection into the calculation pipeline.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DebugLogger } from './debug-logger';
import type { MCRateGetter } from './types';
import { MonteCarloSampleType } from './types';
import { ManagerPayout, createPayoutActivity } from './manager-payout';
import { Asset } from '../../data/asset/asset';
import type { FailureDistribution, ReplacementCycleData } from '../../data/asset/types';
import { loadVariable } from '../simulation/variable';
import { formatDate } from '../date/date';

// ===== Internal State =====

interface AssetState {
  value: number;
  age: number;
}

// ===== Helper Functions for Failure Distributions =====

/**
 * Error function approximation (Abramowitz and Stegun 7.1.26)
 */
function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

/**
 * Normal CDF using error function approximation
 */
function normalCDF(x: number, mean: number, stddev: number): number {
  const z = (x - mean) / stddev;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ===== AssetManager =====

export class AssetManager {
  private assets: Asset[];
  private assetStates: Map<string, AssetState> = new Map();
  private pendingPayouts: ManagerPayout[] = [];
  private mcRateGetter: MCRateGetter | null = null;
  private prng: (() => number) | null = null;
  private debugLogger: DebugLogger | null = null;
  private simulation: string = '';
  private simNumber: number = 0;

  // Checkpoint state
  private statesCheckpoint: string | null = null;
  private payoutsCheckpoint: string | null = null;

  constructor(
    assets: Asset[],
    simulation?: string,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
  ) {
    this.assets = assets;
    this.simulation = simulation ?? '';
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;

    // Initialize asset states from asset data
    for (const asset of assets) {
      this.assetStates.set(asset.id, {
        value: asset.currentValue,
        age: asset.replacementCycle?.currentAge ?? 0,
      });
    }
  }

  // ---- Public API ----

  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetter = getter;
  }

  setPRNG(prng: (() => number) | null): void {
    this.prng = prng;
  }

  /**
   * Process year-boundary events for all assets
   */
  processYearBoundary(year: number): void {
    for (const asset of this.assets) {
      const state = this.assetStates.get(asset.id);
      if (!state) continue;

      // 1. Apply appreciation or depreciation
      this.applyValueChange(asset, state, year);

      // 2. Process replacement cycle (if applicable)
      if (asset.replacementCycle) {
        state.age += 1;
        this.checkAndTriggerReplacement(asset, state, year);
      }
    }
  }

  /**
   * Get all pending replacement activities and clear the buffer
   */
  getPendingPayouts(): ManagerPayout[] {
    const payouts = this.pendingPayouts;
    this.pendingPayouts = [];
    return payouts;
  }

  /**
   * Get current values for all assets (for MC snapshots)
   */
  getAssetValues(): Map<string, number> {
    const values = new Map<string, number>();
    for (const asset of this.assets) {
      const state = this.assetStates.get(asset.id);
      if (state) {
        values.set(asset.id, state.value);
      }
    }
    return values;
  }

  /**
   * Checkpoint mutable state for MC segment reprocessing
   */
  checkpoint(): void {
    this.statesCheckpoint = JSON.stringify(Array.from(this.assetStates.entries()));
    this.payoutsCheckpoint = JSON.stringify(
      this.pendingPayouts.map((p) => ({
        activity: p.activity.serialize(),
        targetAccountId: p.targetAccountId,
        incomeSourceName: p.incomeSourceName,
      })),
    );
  }

  /**
   * Restore mutable state from last checkpoint
   */
  restore(): void {
    if (this.statesCheckpoint === null) {
      return;
    }
    this.assetStates = new Map(JSON.parse(this.statesCheckpoint));
    this.pendingPayouts = [];
    // Note: activities are reconstructed from serialized data if needed, but for now
    // we just clear the buffer since payouts are per-segment events
  }

  // ---- Private Helpers ----

  /**
   * Apply appreciation or depreciation to asset value
   */
  private applyValueChange(asset: Asset, state: AssetState, year: number): void {
    if (state.value === 0) {
      // Zero-value assets don't change
      return;
    }

    if (asset.depreciationSchedule) {
      // Depreciation schedule mode
      const ageIndex = Math.min(state.age, asset.depreciationSchedule.length - 1);
      const depreciationRate = asset.depreciationSchedule[ageIndex];
      state.value *= 1 - depreciationRate;
    } else if (asset.appreciationIsVariable && asset.appreciationVariable) {
      // Variable appreciation mode
      let appreciationRate = 0;

      if (this.mcRateGetter) {
        // MC mode: use sampled rate
        const rate = this.mcRateGetter(MonteCarloSampleType.HOME_APPRECIATION, year);
        appreciationRate = rate ?? 0;
      } else {
        // Deterministic mode: load variable value
        try {
          const rate = loadVariable(asset.appreciationVariable, this.simulation);
          if (typeof rate === 'number') {
            appreciationRate = rate;
          }
        } catch (e) {
          // Variable not found, default to 0
          appreciationRate = 0;
        }
      }

      state.value *= 1 + appreciationRate;
    } else if (asset.appreciation !== 0) {
      // Static appreciation mode
      state.value *= 1 + asset.appreciation;
    }
  }

  /**
   * Check if replacement should trigger and process if needed
   */
  private checkAndTriggerReplacement(asset: Asset, state: AssetState, year: number): void {
    const cycle = asset.replacementCycle;
    if (!cycle) return;

    let shouldReplace = false;

    if (this.prng) {
      // MC mode: sample from failure distribution
      const conditionalProb = this.getConditionalFailureProbability(cycle.distribution, state.age);
      const random = this.prng();
      shouldReplace = random < conditionalProb;
    } else {
      // Deterministic mode: replace at expectedYears
      shouldReplace = state.age >= cycle.expectedYears;
    }

    if (shouldReplace) {
      this.executeReplacement(asset, state, year, cycle);
    }
  }

  /**
   * Compute conditional failure probability for current age
   */
  private getConditionalFailureProbability(dist: FailureDistribution, age: number): number {
    switch (dist.type) {
      case 'weibull': {
        const cdfNow = 1 - Math.exp(-Math.pow(age / dist.eta, dist.beta));
        const cdfPrev = age > 0 ? 1 - Math.exp(-Math.pow((age - 1) / dist.eta, dist.beta)) : 0;
        const survivalToPrev = 1 - cdfPrev;
        return survivalToPrev > 0 ? (cdfNow - cdfPrev) / survivalToPrev : 1;
      }
      case 'uniform': {
        if (age < dist.min) return 0;
        if (age >= dist.max) return 1;
        return 1 / (dist.max - age);
      }
      case 'normal': {
        const cdfNow = normalCDF(age, dist.mean, dist.stddev);
        const cdfPrev = age > 0 ? normalCDF(age - 1, dist.mean, dist.stddev) : 0;
        const survivalToPrev = 1 - cdfPrev;
        return survivalToPrev > 0 ? (cdfNow - cdfPrev) / survivalToPrev : 1;
      }
      case 'fixed':
        return age >= dist.years ? 1 : 0;
      default:
        return 0;
    }
  }

  /**
   * Execute replacement: compute cost, create activity, buffer as payout
   */
  private executeReplacement(asset: Asset, state: AssetState, year: number, cycle: ReplacementCycleData): void {
    // Compute base cost with inflation adjustment if needed
    let cost = cycle.cost;

    if (cycle.costIsVariable && cycle.costVariable) {
      try {
        let inflationRate = 0.0;

        if (this.mcRateGetter) {
          // MC mode: use sampled inflation rate
          const rate = this.mcRateGetter(MonteCarloSampleType.INFLATION, year);
          inflationRate = rate ?? 0;
        } else {
          // Deterministic mode: load inflation variable
          const rate = loadVariable(cycle.costVariable, this.simulation);
          if (typeof rate === 'number') {
            inflationRate = rate;
          }
        }

        // Inflate cost from asset's purchase year to current year
        const yearsSinceBaseline = year - asset.purchaseDate.getFullYear();
        if (yearsSinceBaseline > 0 && inflationRate !== 0) {
          cost = cost * Math.pow(1 + inflationRate, yearsSinceBaseline);
        }
      } catch (e) {
        // Variable not found, use base cost
      }
    }

    // Apply warranty: zero cost if still in warranty
    if (cycle.warrantyYears > 0 && state.age <= cycle.warrantyYears) {
      cost = 0;
    }

    // Apply trade-in: depreciated value offsets cost
    if (cycle.tradeInValue) {
      cost = Math.max(0, cost - state.value);
    }

    // Create expense activity
    const activityId = uuidv4();
    const activityDate = formatDate(new Date(Date.UTC(year, 0, 1))); // January 1 of replacement year

    const activity = createPayoutActivity(
      activityId,
      activityDate,
      `${asset.name} Replacement`,
      -cost, // Negative for expense
      'Assets.Replacement',
    );

    // Mark as flagged for visibility
    activity.flag = true;
    activity.flagColor = 'red';

    // Buffer as ManagerPayout
    if (asset.payFromAccount) {
      this.pendingPayouts.push({
        activity,
        targetAccountId: asset.payFromAccount,
        incomeSourceName: asset.name,
      });
    }

    // Reset asset state after replacement
    state.age = 0;
    state.value = cost; // New value is the replacement cost paid
  }
}
