import { HealthcareConfig } from '../../data/healthcare/types';
import { Bill } from '../../data/bill/bill';
import { Activity } from '../../data/activity/activity';
import { parseDate } from '../../utils/date/date';
import { loadDateOrVariable } from '../../utils/simulation/loadVariableValue';

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

  constructor(healthcareConfigs: HealthcareConfig[], simulation: string = 'Default') {
    // Resolve date variables for each config
    this.configs = healthcareConfigs.map(config => this.resolveConfigDates(config, simulation));
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
        console.warn(`Failed to resolve startDateVariable for config "${config.name}":`, e);
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
        console.warn(`Failed to resolve endDateVariable for config "${config.name}":`, e);
      }
    }

    return resolved;
  }

  /**
   * Compute the inflated deductible value for a given date
   */
  private getInflatedDeductible(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = config.deductibleInflationRate ?? 0.05; // Default 5% healthcare inflation
    return Math.round(config.individualDeductible * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Compute the inflated family deductible value for a given date
   */
  private getInflatedFamilyDeductible(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = config.deductibleInflationRate ?? 0.05; // Default 5% healthcare inflation
    return Math.round(config.familyDeductible * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Compute the inflated individual OOP max value for a given date
   */
  private getInflatedIndividualOOP(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = config.deductibleInflationRate ?? 0.05; // Default 5% healthcare inflation
    return Math.round(config.individualOutOfPocketMax * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Compute the inflated family OOP max value for a given date
   */
  private getInflatedFamilyOOP(config: HealthcareConfig, date: Date): number {
    const baseYear = parseDate(config.startDate).getUTCFullYear();
    const currentYear = date.getUTCFullYear();
    const yearsDiff = Math.max(0, currentYear - baseYear);
    const rate = config.deductibleInflationRate ?? 0.05; // Default 5% healthcare inflation
    return Math.round(config.familyOutOfPocketMax * Math.pow(1 + rate, yearsDiff));
  }

  /**
   * Find the active healthcare config for a person at a given date
   */
  getActiveConfig(personName: string, date: Date): HealthcareConfig | null {
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
      return null;
    }

    // If multiple matches, return the most recent (latest start date)
    matchingConfigs.sort((a, b) => {
      const dateA = parseDate(a.startDate);
      const dateB = parseDate(b.startDate);
      return dateB.getTime() - dateA.getTime();
    });

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

    return {
      individualMet: individualSpent >= inflatedIndividualDeductible,
      familyMet: familySpent >= inflatedFamilyDeductible,
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
    const familyMet = familySpent >= inflatedFamilyOOP;

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
      } else {
        // Between deductible and OOP max: patient pays coinsurance %
        patientPays = billAmount * (coinsurancePercent / 100);
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
      }
    }

    // Record the expense
    this.recordHealthcareExpense(personName, date, amountTowardDeductible, amountTowardOOP, config);

    return patientPays;
  }

  /**
   * Calculate the actual patient cost for a healthcare expense
   */
  calculatePatientCost(expense: Bill | Activity, config: HealthcareConfig, date: Date, overrideAmount?: number): number {
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
