import { HealthcareConfig } from '../../data/healthcare/types';
import { Bill } from '../../data/bill/bill';
import { Activity } from '../../data/activity/activity';

type YearTracker = {
  planYear: number;
  lastResetCheck: Date;
  individualDeductible: Map<string, number>;
  individualOOP: Map<string, number>;
  familyDeductible: number;
  familyOOP: number;
};

export class HealthcareManager {
  private configs: HealthcareConfig[];
  private trackers: Map<string, YearTracker> = new Map();

  constructor(healthcareConfigs: HealthcareConfig[]) {
    this.configs = healthcareConfigs;
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

      const startDate = new Date(config.startDate);
      if (date < startDate) {
        return false;
      }

      if (config.endDate) {
        const endDate = new Date(config.endDate);
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
      const dateA = new Date(a.startDate);
      const dateB = new Date(b.startDate);
      return dateB.getTime() - dateA.getTime();
    });

    return matchingConfigs[0];
  }

  /**
   * Determine which plan year a date falls in based on reset date
   */
  private getPlanYear(config: HealthcareConfig, date: Date): number {
    const currentYear = date.getFullYear();
    const resetMonth = config.resetMonth;
    const resetDay = config.resetDay;

    const dateMonth = date.getMonth();
    const dateDay = date.getDate();

    console.log('[RESET DEBUG getPlanYear] Determining plan year:', {
      date: date.toISOString(),
      dateLocal: date.toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      currentYear,
      resetMonth,
      resetDay,
      dateMonth,
      dateDay,
      configId: config.id,
      configName: config.name,
    });

    // Check if current date is before the reset date in the current year
    if (dateMonth < resetMonth || (dateMonth === resetMonth && dateDay < resetDay)) {
      console.log('[RESET DEBUG getPlanYear] Date is BEFORE reset date in current year - returning:', currentYear - 1);
      return currentYear - 1;
    }
    console.log('[RESET DEBUG getPlanYear] Date is ON/AFTER reset date - returning:', currentYear);
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
   * Reset tracking if we've moved to a new plan year
   */
  private resetIfNeeded(config: HealthcareConfig, date: Date): void {
    console.log('[RESET DEBUG resetIfNeeded] ===== START =====');
    console.log('[RESET DEBUG resetIfNeeded] Checking if reset needed for date:', {
      date: date.toISOString(),
      dateLocal: date.toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      configId: config.id,
      configName: config.name,
      resetMonth: config.resetMonth,
      resetDay: config.resetDay,
    });

    const tracker = this.getOrCreateTracker(config, date);
    console.log('[RESET DEBUG resetIfNeeded] Current tracker state:', {
      planYear: tracker.planYear,
      lastResetCheck: tracker.lastResetCheck.toISOString(),
      individualDeductibleCount: tracker.individualDeductible.size,
      individualOOPCount: tracker.individualOOP.size,
      familyDeductible: tracker.familyDeductible,
      familyOOP: tracker.familyOOP,
    });

    const currentPlanYear = this.getPlanYear(config, date);
    console.log('[RESET DEBUG resetIfNeeded] Plan year comparison:', {
      currentPlanYear,
      trackerPlanYear: tracker.planYear,
      needsReset: currentPlanYear !== tracker.planYear,
    });

    // If we've moved to a new plan year, reset all tracking
    if (currentPlanYear !== tracker.planYear) {
      console.log('[RESET DEBUG resetIfNeeded] ⚠️ RESETTING TRACKER - Plan year changed!');
      console.log('[RESET DEBUG resetIfNeeded] Before reset - Individual deductibles:',
        Array.from(tracker.individualDeductible.entries()));
      console.log('[RESET DEBUG resetIfNeeded] Before reset - Individual OOP:',
        Array.from(tracker.individualOOP.entries()));

      tracker.planYear = currentPlanYear;
      tracker.individualDeductible.clear();
      tracker.individualOOP.clear();
      tracker.familyDeductible = 0;
      tracker.familyOOP = 0;

      console.log('[RESET DEBUG resetIfNeeded] After reset - tracker cleared, new plan year:', currentPlanYear);
    } else {
      console.log('[RESET DEBUG resetIfNeeded] No reset needed - same plan year');
    }

    tracker.lastResetCheck = date;
    console.log('[RESET DEBUG resetIfNeeded] ===== END =====');
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
    console.log('[OOP Tracking] ===== recordHealthcareExpense START =====');
    console.log('[OOP Tracking] Recording expense:', {
      personName,
      date: date.toISOString(),
      amountTowardDeductible,
      amountTowardOOP,
      configId: config.id,
    });

    const tracker = this.getOrCreateTracker(config, date);

    // Update individual deductible (only if amount > 0)
    if (amountTowardDeductible > 0) {
      const currentDeductible = tracker.individualDeductible.get(personName) || 0;
      const newDeductible = currentDeductible + amountTowardDeductible;

      console.log('[OOP Tracking] Updating DEDUCTIBLE:', {
        person: personName,
        currentIndividual: currentDeductible,
        adding: amountTowardDeductible,
        newIndividual: newDeductible,
      });

      tracker.individualDeductible.set(personName, newDeductible);
    }

    // Update individual OOP (only if amount > 0)
    if (amountTowardOOP > 0) {
      const currentOOP = tracker.individualOOP.get(personName) || 0;
      const newOOP = currentOOP + amountTowardOOP;

      console.log('[OOP Tracking] Updating OOP:', {
        person: personName,
        currentIndividual: currentOOP,
        adding: amountTowardOOP,
        newIndividual: newOOP,
      });

      tracker.individualOOP.set(personName, newOOP);
    }

    console.log('[OOP Tracking] Final tracker state:', {
      individualDeductibles: Array.from(tracker.individualDeductible.entries()),
      individualOOPs: Array.from(tracker.individualOOP.entries()),
    });
    console.log('[OOP Tracking] ===== recordHealthcareExpense END =====');
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

    const individualRemaining = Math.max(0, config.individualDeductible - individualSpent);
    const familyRemaining = Math.max(0, config.familyDeductible - familySpent);

    return {
      individualMet: individualSpent >= config.individualDeductible,
      familyMet: familySpent >= config.familyDeductible,
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
    console.log('[OOP Tracking] ===== getOOPProgress START =====');
    console.log('[OOP Tracking] Input:', {
      personName,
      date: date.toISOString(),
      configId: config.id,
      coveredPersons: config.coveredPersons,
    });

    this.resetIfNeeded(config, date);
    const tracker = this.getOrCreateTracker(config, date);

    const individualSpent = tracker.individualOOP.get(personName) || 0;

    // Calculate family total by aggregating across all covered persons
    const familySpent = (config.coveredPersons || []).reduce((sum, person) => {
      return sum + (tracker.individualOOP.get(person) || 0);
    }, 0);

    console.log('[OOP Tracking] Tracker state:', {
      individualOOP: individualSpent,
      familyOOP: familySpent,
      allIndividualOOP: Array.from(tracker.individualOOP.entries()),
    });

    console.log('[OOP Tracking] Config limits:', {
      individualOutOfPocketMax: config.individualOutOfPocketMax,
      familyOutOfPocketMax: config.familyOutOfPocketMax,
    });

    const individualRemaining = Math.max(0, config.individualOutOfPocketMax - individualSpent);
    const familyRemaining = Math.max(0, config.familyOutOfPocketMax - familySpent);

    console.log('[OOP Tracking] Remaining amounts:', {
      individualRemaining,
      familyRemaining,
    });

    const individualMet = individualSpent >= config.individualOutOfPocketMax;
    const familyMet = familySpent >= config.familyOutOfPocketMax;

    console.log('[OOP Tracking] CRITICAL - Met flag calculations:', {
      individualMet,
      individualMetCalculation: `${individualSpent} >= ${config.individualOutOfPocketMax} = ${individualMet}`,
      familyMet,
      familyMetCalculation: `${familySpent} >= ${config.familyOutOfPocketMax} = ${familyMet}`,
    });

    const result = {
      individualMet,
      familyMet,
      individualRemaining,
      familyRemaining,
    };

    console.log('[OOP Tracking] Final progress object:', result);
    console.log('[OOP Tracking] ===== getOOPProgress END =====');

    return result;
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
    console.log('[calculateDeductibleBasedCost] ===== START =====');
    const progress = this.getDeductibleProgress(config, date, personName);
    const coinsurancePercent = expense.coinsurancePercent || 0;

    console.log('[DEBUG calculateDeductibleBasedCost] Progress:', {
      personName,
      individualSpent: progress.individualRemaining !== undefined ?
        (config.individualDeductible - progress.individualRemaining) : 'unknown',
      individualMet: progress.individualMet,
      familyMet: progress.familyMet,
      deductibleMet: progress.individualMet || progress.familyMet,
    });

    console.log('[calculateDeductibleBasedCost] Inputs:', {
      billAmount,
      personName,
      coinsurancePercent,
      deductibleProgress: progress,
    });

    let patientPays = 0;
    let amountTowardDeductible = 0;
    let amountTowardOOP = 0;

    // Check if deductible is met (either individual or family)
    const deductibleMet = progress.individualMet || progress.familyMet;
    console.log('[calculateDeductibleBasedCost] Deductible met?', deductibleMet);

    if (!deductibleMet) {
      console.log('[calculateDeductibleBasedCost] Path: Deductible NOT met');
      // Deductible not yet met - need to handle split between deductible and coinsurance
      const individualRemaining = progress.individualRemaining;
      const familyRemaining = progress.familyRemaining;

      // Amount that goes toward deductible is the lesser of bill amount and remaining deductible
      const remainingDeductible = Math.min(individualRemaining, familyRemaining);
      const amountToDeductible = Math.min(billAmount, remainingDeductible);

      console.log('[calculateDeductibleBasedCost] Deductible calculations:', {
        individualRemaining,
        familyRemaining,
        remainingDeductible,
        amountToDeductible,
      });

      if (billAmount <= remainingDeductible) {
        console.log('[calculateDeductibleBasedCost] Bill within deductible - patient pays 100%');
        // Entire bill is within deductible - patient pays 100% of bill
        patientPays = billAmount;
        amountTowardDeductible = expense.countsTowardDeductible ? amountToDeductible : 0;
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
        console.log('[calculateDeductibleBasedCost] Result:', { patientPays, amountTowardDeductible, amountTowardOOP });
      } else {
        console.log('[calculateDeductibleBasedCost] Bill exceeds deductible - split calculation');
        // Bill exceeds remaining deductible - split calculation
        // Patient pays 100% of remaining deductible, then coinsurance on the rest
        const amountAfterDeductible = billAmount - remainingDeductible;
        const coinsuranceOnRemainder = amountAfterDeductible * (coinsurancePercent / 100);

        patientPays = remainingDeductible + coinsuranceOnRemainder;
        amountTowardDeductible = expense.countsTowardDeductible ? remainingDeductible : 0;
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
        console.log('[calculateDeductibleBasedCost] Split calculation:', {
          amountAfterDeductible,
          coinsuranceOnRemainder,
          patientPays,
          amountTowardDeductible,
          amountTowardOOP,
        });
      }
    } else {
      console.log('[calculateDeductibleBasedCost] Path: Deductible MET');
      // After deductible: patient pays coinsurance %
      const oopProgress = this.getOOPProgress(config, date, personName);
      const oopMet = oopProgress.individualMet || oopProgress.familyMet;
      console.log('[calculateDeductibleBasedCost] OOP progress:', oopProgress);
      console.log('[calculateDeductibleBasedCost] OOP met determination:', {
        individualMet: oopProgress.individualMet,
        familyMet: oopProgress.familyMet,
        oopMet,
        calculation: `${oopProgress.individualMet} || ${oopProgress.familyMet} = ${oopMet}`,
        individualRemaining: oopProgress.individualRemaining,
        familyRemaining: oopProgress.familyRemaining,
      });

      if (oopMet) {
        console.log('[calculateDeductibleBasedCost] OOP max met - patient pays 0%');
        // After OOP max: patient pays 0%
        patientPays = 0;
      } else {
        console.log('[calculateDeductibleBasedCost] Between deductible and OOP - patient pays coinsurance%');
        // Between deductible and OOP max: patient pays coinsurance %
        patientPays = billAmount * (coinsurancePercent / 100);
        amountTowardOOP = expense.countsTowardOutOfPocket ? patientPays : 0;
        console.log('[calculateDeductibleBasedCost] Coinsurance calculation:', {
          billAmount,
          coinsurancePercent,
          patientPays,
          amountTowardOOP,
        });
      }
    }

    // Record the expense
    this.recordHealthcareExpense(personName, date, amountTowardDeductible, amountTowardOOP, config);

    console.log('[DEBUG calculateDeductibleBasedCost] Result:', {
      billAmount,
      patientPays,
      amountTowardDeductible,
      amountTowardOOP,
    });

    console.log('[calculateDeductibleBasedCost] FINAL patientPays:', patientPays);
    console.log('[calculateDeductibleBasedCost] ===== END =====');
    return patientPays;
  }

  /**
   * Calculate the actual patient cost for a healthcare expense
   */
  calculatePatientCost(expense: Bill | Activity, config: HealthcareConfig, date: Date): number {
    console.log('[DEBUG calculatePatientCost] Called with:', {
      expenseName: expense.name,
      healthcarePerson: expense.healthcarePerson,
      amount: expense.amount,
      date: date.toISOString().split('T')[0],
    });

    console.log('[HealthcareManager] ===== calculatePatientCost START =====');
    console.log('[HealthcareManager] Expense details:', {
      name: expense.name,
      amount: expense.amount,
      copayAmount: expense.copayAmount,
      coinsurancePercent: expense.coinsurancePercent,
      healthcarePerson: expense.healthcarePerson,
      countsTowardDeductible: expense.countsTowardDeductible,
      countsTowardOutOfPocket: expense.countsTowardOutOfPocket,
    });

    console.log('[DEBUG calculatePatientCost] Config found:', config ? {
      configName: config.name,
      coveredPersons: config.coveredPersons,
    } : 'NO CONFIG FOUND');

    // Reset tracking if we've crossed into a new plan year
    this.resetIfNeeded(config, date);

    const billAmount = typeof expense.amount === 'number' ? Math.abs(expense.amount) : 0;
    const personName = expense.healthcarePerson || '';

    console.log('[HealthcareManager] Calculated values:', {
      billAmount,
      personName,
    });

    // If expense has a copay > 0, use copay logic
    // Note: $0 copay is treated as "no copay" and falls through to deductible logic
    const hasCopay = expense.copayAmount !== null && expense.copayAmount !== undefined && expense.copayAmount > 0;
    console.log('[HealthcareManager] Copay check:', {
      copayAmount: expense.copayAmount,
      copayAmountNotNull: expense.copayAmount !== null,
      copayAmountNotUndefined: expense.copayAmount !== undefined,
      copayAmountGreaterThanZero: expense.copayAmount > 0,
      hasCopay,
    });

    if (hasCopay) {
      console.log('[HealthcareManager] Using COPAY logic');
      const result = this.calculateCopayBasedCost(expense, config, billAmount, personName, date);
      console.log('[HealthcareManager] Patient cost (copay):', result);
      console.log('[HealthcareManager] ===== calculatePatientCost END =====');
      return result;
    }

    // Otherwise use deductible/coinsurance logic
    console.log('[HealthcareManager] Using DEDUCTIBLE/COINSURANCE logic');
    const result = this.calculateDeductibleBasedCost(expense, config, billAmount, personName, date);
    console.log('[HealthcareManager] Patient cost (deductible):', result);
    console.log('[HealthcareManager] ===== calculatePatientCost END =====');
    return result;
  }
}
