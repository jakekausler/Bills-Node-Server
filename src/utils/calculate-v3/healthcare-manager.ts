import { HealthcareConfig } from '../../data/healthcare/types';
import { Bill } from '../../data/bill/bill';
import { Activity } from '../../data/activity/activity';
import { parseDate } from '../../utils/date/date';
import { loadDateOrVariable } from '../../utils/simulation/loadVariableValue';
import type { DebugLogger } from './debug-logger';
import type { MortalityManager } from './mortality-manager';
import { MCRateGetter, MonteCarloSampleType } from './types';
import { loadVariable } from '../../utils/simulation/variable';

type YearTracker = {
  planYear: number;
  lastResetCheck: Date;
  individualDeductible: Map<string, number>;
  individualOOP: Map<string, number>;
  familyDeductible: number;
  familyOOP: number;
  checkpointPlanYear?: number;
  checkpointLastResetCheck?: Date;
  checkpointIndividualDeductible?: Map<string, number>;
  checkpointIndividualOOP?: Map<string, number>;
  checkpointFamilyDeductible?: number;
  checkpointFamilyOOP?: number;
};

export class HealthcareManager {
  private configs: HealthcareConfig[];
  private trackers: Map<string, YearTracker> = new Map();
  // Cache for idempotent processing - stores expense ID + date -> calculated patientCost
  private processedExpenses: Map<string, number> = new Map();
  private checkpointProcessedExpenses: Map<string, number> = new Map();
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private mortalityManager: MortalityManager | null;
  private mcRateGetter: MCRateGetter | null = null;
  private simulation: string = 'Default';

  constructor(healthcareConfigs: HealthcareConfig[], simulation: string = 'Default', debugLogger?: DebugLogger | null, simNumber: number = 0, mortalityManager?: MortalityManager | null) {
    this.simulation = simulation;
    // Resolve date variables for each config
    this.configs = healthcareConfigs.map(config => this.resolveConfigDates(config, simulation));
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.mortalityManager = mortalityManager ?? null;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'healthcare', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  /**
   * Wire the mortality manager to enable family→individual coverage transitions
   */
  setMortalityManager(mortalityManager: MortalityManager): void {
    this.mortalityManager = mortalityManager;
  }

  /**
   * Wire the MC rate getter to enable stochastic deductible inflation in MC mode.
   */
  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetter = getter;
  }

  /**
   * Resolve the deductible inflation rate for a given year.
   * Priority:
   *   1. MC mode + variable set → sample from MC draw
   *   2. Variable set (deterministic) → load variable value
   *   3. Fixed rate field → config.deductibleInflationRate ?? 0.05
   */
  private getDeductibleInflationRate(config: HealthcareConfig, year: number): number {
    if (this.mcRateGetter && config.deductibleInflationVariable) {
      const mcRate = this.mcRateGetter(MonteCarloSampleType.HEALTHCARE_INFLATION, year);
      if (mcRate !== null) return mcRate;
    }
    if (config.deductibleInflationVariable) {
      try {
        return loadVariable(config.deductibleInflationVariable, this.simulation) as number;
      } catch {
        // fall through to fixed rate
      }
    }
    return config.deductibleInflationRate ?? 0.05;
  }

  /**
   * Determine if we're in family or individual coverage mode.
   * Returns true if family mode (2+ people alive), false if individual mode (1 person alive).
   */
  private isInFamilyMode(): boolean {
    if (!this.mortalityManager) {
      // If no mortality manager, assume family mode (default)
      return true;
    }
    const alivePeople = this.mortalityManager.getAlivePeople();
    return alivePeople.length >= 2;
  }

  /**
   * Resolve date variables in a healthcare config
   * @private
   */
  private resolveConfigDates(config: HealthcareConfig, simulation: string): HealthcareConfig {
    const resolved = { ...config };

    // Resolve start date if it's a variable
    if (config.startDateIsVariable && config.startDateVariable) {
      try {
        const { date } = loadDateOrVariable(
          config.startDate,
          config.startDateIsVariable,
          config.startDateVariable,
          simulation,
        );
        resolved.startDate = date.toISOString().split('T')[0] as any;
      } catch (e) {
        // If variable resolution fails, keep original date
        this.log('start-date-variable-resolution-failed', { configName: config.name, error: String(e) });
      }
    }

    // Resolve end date if it's a variable
    if (config.endDateIsVariable && config.endDateVariable && config.endDate) {
      try {
        const { date } = loadDateOrVariable(
          config.endDate,
          config.endDateIsVariable,
          config.endDateVariable,
          simulation,
        );
        resolved.endDate = date.toISOString().split('T')[0] as any;
      } catch (e) {
        // If variable resolution fails, keep original date
        this.log('end-date-variable-resolution-failed', { configName: config.name, error: String(e) });
      }
    }

    this.log('config-resolved', { config_name: resolved.name, start_date: resolved.startDate, end_date: resolved.endDate ?? null });

    return resolved;
  }

  /**
   * Compute the inflated deductible value for a given date
   */
  private getInflatedDeductible(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = this.getDeductibleInflationRate(config, currentYear);
    const inflated = Math.round(config.individualDeductible * Math.pow(1 + rate, yearsDiff));
    this.log('deductible-inflated', { config_name: config.name, base_year: baseYear, current_year: currentYear, base_deductible: config.individualDeductible, inflated_deductible: inflated });
    return inflated;
  }

  /**
   * Compute the inflated family deductible value for a given date
   */
  private getInflatedFamilyDeductible(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = this.getDeductibleInflationRate(config, currentYear);
    return Math.round(config.familyDeductible * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Compute the inflated individual OOP max value for a given date
   */
  private getInflatedIndividualOOP(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = this.getDeductibleInflationRate(config, currentYear);
    return Math.round(config.individualOutOfPocketMax * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Compute the inflated family OOP max value for a given date
   */
  private getInflatedFamilyOOP(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = this.getDeductibleInflationRate(config, currentYear);
    return Math.round(config.familyOutOfPocketMax * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Get all healthcare configs
   */
  getAllConfigs(): HealthcareConfig[] {
    return this.configs;
  }

  /**
   * Find the active healthcare config for a person at a given date
   */
  getActiveConfig(personName: string, date: Date): HealthcareConfig | null {
    this.currentDate = date.toISOString().split('T')[0];
    // Filter configs that match the person and date range
    const matchingConfigs = this.configs.filter((config) => {
      // Check if this person is covered by this config
      if (!config.coveredPersons || !config.coveredPersons.includes(personName)) {
        return false;
      }

      const startDate = parseDate(config.startDate);
      if (date < startDate) {
        return false;
      }

      if (config.endDate) {
        const endDate = parseDate(config.endDate);
        if (date > endDate) {
          return false;
        }
      }

      return true;
    });

    // If no matches, return null
    if (matchingConfigs.length === 0) {
      this.log('no-plan-found', { person: personName, date: date.toISOString().split('T')[0] });
      return null;
    }

    // If multiple matches, return the most recent (latest start date)
    matchingConfigs.sort((a, b) => {
      const dateA = parseDate(a.startDate);
      const dateB = parseDate(b.startDate);
      return dateB.getTime() - dateA.getTime();
    });

    this.log('active-plan-selected', { person: personName, date: date.toISOString().split('T')[0], config_name: matchingConfigs[0].name });
    return matchingConfigs[0];
  }

  /**
   * Determine which plan year a date falls in based on reset date
   */
  private getPlanYear(config: HealthcareConfig, date: Date): number {
    const currentYear = date.getUTCFullYear();
    const resetMonth = config.resetMonth;
    const resetDay = config.resetDay;

    const dateMonth = date.getUTCMonth();
    const dateDay = date.getUTCDate();

    // Check if current date is before the reset date in the current year
    if (dateMonth < resetMonth || (dateMonth === resetMonth && dateDay < resetDay)) {
      return currentYear - 1;
    }
    return currentYear;
  }

  /**
   * Generate tracker key for a config
   */
  private getTrackerKey(config: HealthcareConfig): string {
    return config.id;
  }

  /**
   * Get or create a year tracker for a config
   */
  private getOrCreateTracker(config: HealthcareConfig, date: Date): YearTracker {
    const key = this.getTrackerKey(config);

    if (!this.trackers.has(key)) {
      this.trackers.set(key, {
        planYear: this.getPlanYear(config, date),
        lastResetCheck: date,
        individualDeductible: new Map(),
        individualOOP: new Map(),
        familyDeductible: 0,
        familyOOP: 0,
      });
    }

    return this.trackers.get(key)!;
  }

  /**
   * Generate a unique key for expense caching (ID + date)
   */
  private getExpenseKey(activity: { id: string }, date: Date): string {
    return `${activity.id}-${date.toISOString().split('T')[0]}`;
  }

  /**
   * Clear processed expenses cache (for yearly reset)
   */
  public clearProcessedExpensesCache(): void {
    this.processedExpenses.clear();
  }

  /**
   * Reset tracking if we've moved to a new plan year
   */
  private resetIfNeeded(config: HealthcareConfig, date: Date): void {
    const tracker = this.getOrCreateTracker(config, date);
    const currentPlanYear = this.getPlanYear(config, date);

    // If we've moved to a new plan year, reset all tracking
    if (currentPlanYear !== tracker.planYear) {
      this.log('plan-year-reset', { config_name: config.name, plan_year: currentPlanYear });
      tracker.planYear = currentPlanYear;
      tracker.individualDeductible.clear();
      tracker.individualOOP.clear();
      tracker.familyDeductible = 0;
      tracker.familyOOP = 0;
      // Also clear processed expenses cache when year resets
      this.processedExpenses.clear();
    }

    tracker.lastResetCheck = date;
  }

  /**
   * Record a healthcare expense toward deductible and OOP tracking
   */
  recordHealthcareExpense(
    personName: string,
    date: Date,
    amountTowardDeductible: number,
    amountTowardOOP: number,
    config: HealthcareConfig,
  ): void {
    const tracker = this.getOrCreateTracker(config, date);

    this.log('expense-recorded', { person: personName, amount: amountTowardDeductible + amountTowardOOP, toward_deductible: amountTowardDeductible, toward_oop: amountTowardOOP });

    // Update individual deductible (only if amount > 0)
    if (amountTowardDeductible > 0) {
      const currentDeductible = tracker.individualDeductible.get(personName) || 0;
      const newDeductible = currentDeductible + amountTowardDeductible;
      tracker.individualDeductible.set(personName, newDeductible);
    }

    // Update individual OOP (only if amount > 0)
    if (amountTowardOOP > 0) {
      const currentOOP = tracker.individualOOP.get(personName) || 0;
      const newOOP = currentOOP + amountTowardOOP;
      tracker.individualOOP.set(personName, newOOP);
    }
  }

  /**
   * Get deductible progress for a person
   */
  getDeductibleProgress(
    config: HealthcareConfig,
    date: Date,
    personName: string,
  ): {
    individualMet: boolean;
    familyMet: boolean;
    individualRemaining: number;
    familyRemaining: number;
  } {
    this.resetIfNeeded(config, date);
    const tracker = this.getOrCreateTracker(config, date);

    const individualSpent = tracker.individualDeductible.get(personName) || 0;

    // Calculate family total by aggregating across all covered persons
    const familySpent = (config.coveredPersons || []).reduce((sum, person) => {
      return sum + (tracker.individualDeductible.get(person) || 0);
    }, 0);

    const inflatedIndividualDeductible = this.getInflatedDeductible(config, date);
    const inflatedFamilyDeductible = this.getInflatedFamilyDeductible(config, date);

    const individualRemaining = Math.max(0, inflatedIndividualDeductible - individualSpent);
    const familyRemaining = Math.max(0, inflatedFamilyDeductible - familySpent);

    const individualMet = individualSpent >= inflatedIndividualDeductible;

    // When in individual coverage mode (1 person alive), ignore family limit and treat family as met
    const inFamilyMode = this.isInFamilyMode();
    const familyMet = inFamilyMode ? (familySpent >= inflatedFamilyDeductible) : true;

    this.log('deductible-progress', { person: personName, spent: individualSpent, inflated_limit: inflatedIndividualDeductible, remaining: individualRemaining, met: individualMet, family_mode: inFamilyMode });

    return {
      individualMet,
      familyMet,
      individualRemaining,
      familyRemaining,
    };
  }

  /**
   * Get out-of-pocket progress for a person
   */
  getOOPProgress(
    config: HealthcareConfig,
    date: Date,
    personName: string,
  ): {
    individualMet: boolean;
    familyMet: boolean;
    individualRemaining: number;
    familyRemaining: number;
  } {
    this.resetIfNeeded(config, date);
    const tracker = this.getOrCreateTracker(config, date);

    const individualSpent = tracker.individualOOP.get(personName) || 0;

    // Calculate family total by aggregating across all covered persons
    const familySpent = (config.coveredPersons || []).reduce((sum, person) => {
      return sum + (tracker.individualOOP.get(person) || 0);
    }, 0);

    const inflatedIndividualOOP = this.getInflatedIndividualOOP(config, date);
    const inflatedFamilyOOP = this.getInflatedFamilyOOP(config, date);

    const individualRemaining = Math.max(0, inflatedIndividualOOP - individualSpent);
    const familyRemaining = Math.max(0, inflatedFamilyOOP - familySpent);

    const individualMet = individualSpent >= inflatedIndividualOOP;

    // When in individual coverage mode (1 person alive), ignore family limit and treat family as met
    const inFamilyMode = this.isInFamilyMode();
    const familyMet = inFamilyMode ? (familySpent >= inflatedFamilyOOP) : true;

    this.log('oop-progress', { person: personName, spent: individualSpent, inflated_limit: inflatedIndividualOOP, remaining: individualRemaining, met: individualMet, family_mode: inFamilyMode });

    return {
      individualMet,
      familyMet,
      individualRemaining,
      familyRemaining,
    };
  }

  /**
   * Calculate patient cost for copay-based expense
   */
  private calculateCopayBasedCost(
    expense: Bill | Activity,
    config: HealthcareConfig,
    billAmount: number,
    personName: string,
    date: Date,
  ): number {
    const copay = expense.copayAmount || 0;

    // Track toward deductible/OOP if configured
    const towardDeductible = expense.countsTowardDeductible ? billAmount : 0;
    const towardOOP = expense.countsTowardOutOfPocket ? copay : 0;

    this.recordHealthcareExpense(personName, date, towardDeductible, towardOOP, config);

    this.log('copay-calculated', { copay_amount: copay, bill_amount: billAmount, patient_cost: copay });
    return copay;
  }

  /**
   * Calculate patient cost for deductible-based expense
   */
  private calculateDeductibleBasedCost(
    expense: Bill | Activity,
    config: HealthcareConfig,
    billAmount: number,
    personName: string,
    date: Date,
  ): number {
    const progress = this.getDeductibleProgress(config, date, personName);
    const coinsurancePercent = expense.coinsurancePercent || 0;

    let patientPays = 0;
    let amountTowardDeductible = 0;
    let amountTowardOOP = 0;

    // Check if deductible is met (individual only - each person must meet their own deductible)
    const deductibleMet = progress.individualMet;

    if (!deductibleMet) {
      // Deductible not yet met - need to handle split between deductible and coinsurance
      const individualRemaining = progress.individualRemaining;
      const familyRemaining = progress.familyRemaining;

      // Amount that goes toward deductible is the lesser of bill amount and remaining deductible
      const remainingDeductible = Math.min(individualRemaining, familyRemaining);
      const amountToDeductible = Math.min(billAmount, remainingDeductible);

      if (billAmount <= remainingDeductible) {
        // Entire bill is within deductible - patient pays 100% of bill
        patientPays = billAmount;
        amountTowardDeductible = expense.countsTowardDeductible ? amountToDeductible : 0;
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
      } else {
        // Bill exceeds remaining deductible - split calculation
        // Patient pays 100% of remaining deductible, then coinsurance on the rest
        const amountAfterDeductible = billAmount - remainingDeductible;
        const coinsuranceOnRemainder = amountAfterDeductible * (coinsurancePercent / 100);

        patientPays = remainingDeductible + coinsuranceOnRemainder;
        amountTowardDeductible = expense.countsTowardDeductible ? remainingDeductible : 0;
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
      }
    } else {
      // After deductible: patient pays coinsurance %
      const oopProgress = this.getOOPProgress(config, date, personName);
      const oopMet = oopProgress.individualMet || oopProgress.familyMet;

      if (oopMet) {
        // After OOP max: patient pays 0%
        patientPays = 0;
        this.log('oop-max-reached', { config_name: config.name, oop_spent: oopProgress.individualRemaining === 0 ? this.getInflatedIndividualOOP(config, date) : (this.getInflatedIndividualOOP(config, date) - oopProgress.individualRemaining), oop_max: this.getInflatedIndividualOOP(config, date) });
      } else {
        // Between deductible and OOP max: patient pays coinsurance %
        patientPays = billAmount * (coinsurancePercent / 100);
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
      }
    }

    this.log('deductible-calculated', { deductible_remaining: progress.individualRemaining, bill_amount: billAmount, coinsurance_pct: coinsurancePercent, patient_cost: patientPays });

    // Record the expense
    this.recordHealthcareExpense(personName, date, amountTowardDeductible, amountTowardOOP, config);

    return patientPays;
  }

  /**
   * Calculate the actual patient cost for a healthcare expense
   */
  calculatePatientCost(expense: Bill | Activity, config: HealthcareConfig, date: Date, overrideAmount?: number): number {
    this.currentDate = date.toISOString().split('T')[0];
    // Check if already processed (idempotent protection against segment reprocessing)
    const expenseKey = this.getExpenseKey(expense, date);
    if (this.processedExpenses.has(expenseKey)) {
      return this.processedExpenses.get(expenseKey)!;
    }

    // Reset tracking if we've crossed into a new plan year
    this.resetIfNeeded(config, date);

    const billAmount = overrideAmount !== undefined ? Math.abs(overrideAmount) : (typeof expense.amount === 'number' ? Math.abs(expense.amount) : 0);
    const personName = expense.healthcarePerson || '';

    // If expense has a copay > 0, use copay logic
    // Note: $0 copay is treated as "no copay" and falls through to deductible logic
    const hasCopay = expense.copayAmount !== null && expense.copayAmount !== undefined && expense.copayAmount > 0;

    let patientCost: number;

    if (hasCopay) {
      patientCost = this.calculateCopayBasedCost(expense, config, billAmount, personName, date);
    } else {
      // Otherwise use deductible/coinsurance logic
      patientCost = this.calculateDeductibleBasedCost(expense, config, billAmount, personName, date);
    }

    // Cache result for idempotent processing
    this.processedExpenses.set(expenseKey, patientCost);
    this.log('patient-cost-cached', { expense_key: expenseKey, patient_cost: patientCost });

    return patientCost;
  }

  /**
   * Save a checkpoint of all tracker state and processed expenses cache.
   * Used for push/pull reprocessing to restore state if segment needs to be recomputed.
   */
  checkpoint(): void {
    // Checkpoint each tracker's state
    for (const [trackerId, tracker] of this.trackers) {
      tracker.checkpointPlanYear = tracker.planYear;
      tracker.checkpointLastResetCheck = new Date(tracker.lastResetCheck.getTime());
      tracker.checkpointIndividualDeductible = new Map(tracker.individualDeductible);
      tracker.checkpointIndividualOOP = new Map(tracker.individualOOP);
      tracker.checkpointFamilyDeductible = tracker.familyDeductible;
      tracker.checkpointFamilyOOP = tracker.familyOOP;
    }
    // Checkpoint the processed expenses cache
    this.checkpointProcessedExpenses = new Map(this.processedExpenses);
  }

  /**
   * Restore all tracker state and processed expenses cache from the last checkpoint.
   * Used when segment is reprocessed after push/pull handling.
   */
  restore(): void {
    // Restore each tracker's state
    for (const [trackerId, tracker] of this.trackers) {
      if (tracker.checkpointPlanYear !== undefined) {
        tracker.planYear = tracker.checkpointPlanYear;
      }
      if (tracker.checkpointLastResetCheck !== undefined) {
        tracker.lastResetCheck = new Date(tracker.checkpointLastResetCheck.getTime());
      }
      if (tracker.checkpointIndividualDeductible !== undefined) {
        tracker.individualDeductible = new Map(tracker.checkpointIndividualDeductible);
      }
      if (tracker.checkpointIndividualOOP !== undefined) {
        tracker.individualOOP = new Map(tracker.checkpointIndividualOOP);
      }
      if (tracker.checkpointFamilyDeductible !== undefined) {
        tracker.familyDeductible = tracker.checkpointFamilyDeductible;
      }
      if (tracker.checkpointFamilyOOP !== undefined) {
        tracker.familyOOP = tracker.checkpointFamilyOOP;
      }
    }
    // Restore the processed expenses cache
    this.processedExpenses = new Map(this.checkpointProcessedExpenses);
  }
}
