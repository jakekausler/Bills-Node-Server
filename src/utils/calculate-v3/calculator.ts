import { Activity } from '../../data/activity/activity';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Bill } from '../../data/bill/bill';
import { formatDate, isBefore } from '../date/date';
import { BalanceTracker } from './balance-tracker';
import { AccountManager } from './account-manager';
import { RetirementManager } from './retirement-manager';
import { TaxManager } from './tax-manager';
import { HealthcareManager } from './healthcare-manager';
import { MedicareManager } from './medicare-manager';
import { MortalityManager } from './mortality-manager';
import { AcaManager } from './aca-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import { ContributionLimitManager } from './contribution-limit-manager';
import { PaycheckStateTracker } from './paycheck-state-tracker';
import { PaycheckProcessor } from './paycheck-processor';
import { JobLossManager } from './job-loss-manager';
import { LifeInsuranceManager } from './life-insurance-manager';
import { ManagerPayout } from './manager-payout';
import { WithholdingCalculator } from './withholding-calculator';
import type { TaxProfile } from './tax-profile-types';
import type { PaycheckResult } from './types';
import { RothConversionManager, ConversionResult } from './roth-conversion-manager';
import { DeductionTracker } from './deduction-tracker';
import { loadVariable } from '../simulation/variable';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { DebugLogger } from './debug-logger';
import type { FlowAggregator } from './flow-aggregator';
import {
  ActivityEvent,
  ActivityTransferEvent,
  BillEvent,
  BillTransferEvent,
  FilingStatus,
  IncomeType,
  InterestEvent,
  MCRateGetter,
  MonteCarloSampleType,
  PensionEvent,
  RMDEvent,
  SegmentResult,
  SocialSecurityEvent,
  SpendingTrackerEvent,
  TaxableOccurrence,
  TaxEvent,
  RothConversionEvent,
  MedicarePremiumEvent,
  MedicareHospitalEvent,
  AcaPremiumEvent,
  LTCCheckEvent,
} from './types';
import { computeAnnualFederalTax } from './bracket-calculator';
import { computeNetPay } from './compute-net-pay';

dayjs.extend(utc);

export class Calculator {
  private balanceTracker: BalanceTracker;
  private simulation: string;
  private taxManager: TaxManager;
  private retirementManager: RetirementManager;
  private accountManager: AccountManager;
  private healthcareManager: HealthcareManager;
  private medicareManager: MedicareManager;
  private mortalityManager: MortalityManager;
  private acaManager: AcaManager;
  private spendingTrackerManager: SpendingTrackerManager;
  private contributionLimitManager: ContributionLimitManager;
  private deductionTracker: DeductionTracker;
  private paycheckStateTracker: PaycheckStateTracker;
  private paycheckProcessor: PaycheckProcessor;
  private jobLossManager: JobLossManager;
  private rothConversionManager: RothConversionManager;
  private filingStatus: FilingStatus;
  private bracketInflationRate: number;
  protected monteCarloConfig: any; // From parent, for PRNG access
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private flowAggregator: FlowAggregator | null;
  private mcRateGetterRef: MCRateGetter | null = null;
  private lifeInsuranceManager: LifeInsuranceManager | null = null;
  private pendingPayouts: ManagerPayout[] = [];
  private taxProfile: TaxProfile;

  constructor(
    balanceTracker: BalanceTracker,
    taxManager: TaxManager,
    retirementManager: RetirementManager,
    healthcareManager: HealthcareManager,
    medicareManager: MedicareManager,
    mortalityManager: MortalityManager,
    accountManager: AccountManager,
    simulation: string,
    spendingTrackerManager: SpendingTrackerManager,
    acaManager: AcaManager,
    filingStatus: FilingStatus = 'mfj',
    bracketInflationRate: number = 0.03,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
    flowAggregator?: FlowAggregator | null,
  ) {
    this.balanceTracker = balanceTracker;
    this.taxManager = taxManager;
    this.retirementManager = retirementManager;
    this.healthcareManager = healthcareManager;
    this.medicareManager = medicareManager;
    this.mortalityManager = mortalityManager;
    this.acaManager = acaManager;
    this.simulation = simulation;
    this.accountManager = accountManager;
    this.spendingTrackerManager = spendingTrackerManager;
    this.filingStatus = filingStatus;
    this.bracketInflationRate = bracketInflationRate;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.flowAggregator = flowAggregator ?? null;
    this.contributionLimitManager = new ContributionLimitManager(debugLogger, simNumber);
    this.deductionTracker = new DeductionTracker(debugLogger, simNumber);
    this.paycheckStateTracker = new PaycheckStateTracker(debugLogger, simNumber);
    this.jobLossManager = new JobLossManager(debugLogger, simNumber);
    const withholdingCalculator = new WithholdingCalculator(debugLogger, simNumber);
    this.paycheckProcessor = new PaycheckProcessor(
      this.paycheckStateTracker,
      this.contributionLimitManager,
      withholdingCalculator,
      taxManager,
      debugLogger,
      simNumber,
      this.jobLossManager,
    );
    this.rothConversionManager = new RothConversionManager(accountManager, acaManager, debugLogger, simNumber);
    this.rothConversionManager.setBalanceTracker(balanceTracker);
    // Initialize default tax profile (can be overridden later)
    this.taxProfile = {
      filingStatus,
      state: 'NC',
      stateTaxRate: 0.0475,
      itemizationMode: 'standard' as const,
    };
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'calculator', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries and propagate to child managers */
  setCurrentDate(date: string): void {
    this.currentDate = date;
    this.taxManager.setCurrentDate(date);
    this.retirementManager.setCurrentDate(date);
    this.healthcareManager.setCurrentDate(date);
    this.medicareManager.setCurrentDate(date);
    this.mortalityManager.setCurrentDate(date);
    this.acaManager.setCurrentDate(date);
    this.contributionLimitManager.setCurrentDate(date);
    this.deductionTracker.setCurrentDate(date);
    this.paycheckStateTracker.setCurrentDate(date);
    this.jobLossManager.setCurrentDate(date);
    this.paycheckProcessor.setCurrentDate(date);
    this.spendingTrackerManager.setCurrentDate(date);
    this.balanceTracker.setCurrentDate(date);
  }

  /**
   * Get the RothConversionManager (for 5-year lot enforcement in push-pull handler)
   */
  getRothConversionManager(): RothConversionManager {
    return this.rothConversionManager;
  }

  /**
   * Get the JobLossManager (for year-boundary evaluation in engine)
   */
  getJobLossManager(): JobLossManager {
    return this.jobLossManager;
  }

  /**
   * Get the MortalityManager (for accessing mortality state and under-65 mortality checks)
   */
  getMortalityManager(): MortalityManager | null {
    return this.mortalityManager ?? null;
  }

  /**
   * Get the DeductionTracker (for tracking tax deductions across the simulation)
   */
  getDeductionTracker(): DeductionTracker {
    return this.deductionTracker;
  }

  /**
   * Set the LifeInsuranceManager (for death hook in stepMonth)
   */
  setLifeInsuranceManager(manager: LifeInsuranceManager | null): void {
    this.lifeInsuranceManager = manager;
  }

  /**
   * Set pending payouts from inheritance/life insurance managers for injection into segments.
   */
  setPendingPayouts(payouts: ManagerPayout[]): void {
    this.pendingPayouts.push(...payouts);
  }

  /**
   * Inject pending payouts into a segment result. Called by SegmentProcessor at the start
   * of each segment to flush buffered inheritance/life insurance payouts.
   */
  injectPendingPayouts(segmentResult: SegmentResult): void {
    if (this.pendingPayouts.length === 0) return;

    for (const { activity, targetAccountId, incomeSourceName } of this.pendingPayouts) {
      if (!segmentResult.activitiesAdded.has(targetAccountId)) {
        segmentResult.activitiesAdded.set(targetAccountId, []);
      }
      segmentResult.activitiesAdded.get(targetAccountId)!.push(activity);
      const currentChange = segmentResult.balanceChanges.get(targetAccountId) ?? 0;
      segmentResult.balanceChanges.set(targetAccountId, currentChange + activity.amount);
      const year = new Date(activity.date).getUTCFullYear();
      this.flowAggregator?.recordIncome(year, incomeSourceName, activity.amount);
    }

    this.pendingPayouts = [];
  }

  /**
   * Save a checkpoint of contribution limit, deduction tracker, paycheck state, job loss state, and mortality state.
   * Used for push/pull reprocessing to restore state if segment needs to be recomputed.
   */
  private pendingPayoutsCheckpoint: string = '[]';
  private lifeInsuranceManagerCheckpoint: string = '';

  checkpoint(): void {
    this.contributionLimitManager.checkpoint();
    this.deductionTracker.checkpoint();
    this.paycheckStateTracker.checkpoint();
    this.jobLossManager.checkpoint();
    this.mortalityManager.checkpoint();
    this.pendingPayoutsCheckpoint = JSON.stringify(this.pendingPayouts.map(p => ({
      activity: p.activity.serialize(),
      targetAccountId: p.targetAccountId,
      incomeSourceName: p.incomeSourceName,
    })));
    if (this.lifeInsuranceManager) {
      this.lifeInsuranceManagerCheckpoint = this.lifeInsuranceManager.checkpoint();
    }
  }

  /**
   * Restore contribution limit, deduction tracker, paycheck state, job loss state, and mortality state from the last checkpoint.
   * Used when segment is reprocessed after push/pull handling.
   */
  restore(): void {
    this.contributionLimitManager.restore();
    this.deductionTracker.restore();
    this.paycheckStateTracker.restore();
    this.jobLossManager.restore();
    this.mortalityManager.restore();
    const restored = JSON.parse(this.pendingPayoutsCheckpoint) as Array<{
      activity: Record<string, unknown>;
      targetAccountId: string;
      incomeSourceName: string;
    }>;
    this.pendingPayouts = restored.map(r => ({
      activity: new ConsolidatedActivity(r.activity),
      targetAccountId: r.targetAccountId,
      incomeSourceName: r.incomeSourceName,
    }));
    if (this.lifeInsuranceManager && this.lifeInsuranceManagerCheckpoint) {
      this.lifeInsuranceManager.restore(this.lifeInsuranceManagerCheckpoint);
    }
  }

  /**
   * Set Monte Carlo configuration (for accessing seeded PRNG)
   */
  setMonteCarloConfig(config: any): void {
    this.monteCarloConfig = config;
  }

  /**
   * Get an MC-sampled rate for a given sample type and date.
   * Returns null in deterministic mode (no MC handler).
   */
  getMCRate(type: MonteCarloSampleType, date: Date): number | null {
    if (!this.monteCarloConfig?.handler) return null;
    return this.monteCarloConfig.handler.getSample(type, date);
  }

  /**
   * Store an MCRateGetter reference (set by the engine after MC initialization).
   * Avoids recreating the lambda on every call to getMCRateGetter().
   */
  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetterRef = getter;
  }

  /**
   * Get the stored MCRateGetter function that maps (type, year) to the MC-sampled rate.
   * Returns null in deterministic mode.
   */
  getMCRateGetter(): MCRateGetter | null {
    return this.mcRateGetterRef;
  }

  /**
   * Get the MC change ratio for a contribution limit type at a given date.
   * Returns undefined if MC is not enabled (deterministic mode uses fixed inflation).
   */
  private getMCLimitChangeRatio(limitType: '401k' | 'ira' | 'hsa', date: Date): number | undefined {
    if (!this.monteCarloConfig?.handler) return undefined;
    const sampleType =
      limitType === '401k' ? MonteCarloSampleType.K401_LIMIT_CHANGE :
      limitType === 'ira' ? MonteCarloSampleType.IRA_LIMIT_CHANGE :
      MonteCarloSampleType.HSA_LIMIT_CHANGE;
    return this.monteCarloConfig.handler.getSample(sampleType, date);
  }

  /***************************************
   * EVENT PROCESSING
   ***************************************/

  /**
   * Processes an activity event and updates the segment result.
   * @param event - The activity event to process.
   * @param segmentResult - The segment result to update.
   * @return A map of account IDs to their balance changes.
   */
  processActivityEvent(event: ActivityEvent, segmentResult: SegmentResult): Map<string, number> {
    const activity = event.originalActivity;

    // Route healthcare activities to healthcare processor
    if (activity.isHealthcare) {
      return this.processHealthcareActivity(event, segmentResult);
    }

    const accountId = event.accountId;

    // Add the activity to the segment result
    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(new ConsolidatedActivity(activity.serialize()));

    // For paycheck activities, use netPay as the effective amount
    let balanceChange = activity.amount as number;
    if ((activity as any).isPaycheckActivity && (activity as any).paycheckDetails) {
      balanceChange = (activity as any).paycheckDetails.netPay;

      // Record withholding in TaxManager
      const year = event.date.getUTCFullYear();
      const paycheckDetails = (activity as any).paycheckDetails;
      if (paycheckDetails.federalWithholding > 0 || paycheckDetails.stateWithholding > 0) {
        this.taxManager.addWithholdingOccurrence({
          date: event.date,
          year,
          federalAmount: paycheckDetails.federalWithholding || 0,
          stateAmount: paycheckDetails.stateWithholding || 0,
          source: activity.name,
        });
      }
    }

    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + balanceChange);
    this.log('activity-processed', { name: activity.name, accountId, amount: balanceChange });

    // Record flow
    if (this.flowAggregator) {
      const year = event.date.getUTCFullYear();
      if (balanceChange > 0) {
        this.flowAggregator.recordIncome(year, activity.category || 'Income', balanceChange);
      } else if (balanceChange < 0) {
        this.flowAggregator.recordExpense(year, (activity.category || 'Uncategorized').split('.')[0], Math.abs(balanceChange));
      }
    }

    return new Map([[accountId, balanceChange]]);
  }

  /**
   * Process a healthcare activity event
   */
  private processHealthcareActivity(event: ActivityEvent, segmentResult: SegmentResult): Map<string, number> {
    const activity = event.originalActivity;
    this.log('healthcare-bill-routed', { name: activity.name, person: activity.healthcarePerson || '' });
    const config = this.healthcareManager.getActiveConfig(activity.healthcarePerson || '', event.date);

    if (!config) {
      // No config = process directly as regular activity to avoid infinite recursion
      const accountId = event.accountId;

      // Add the activity to the segment result
      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId)?.push(new ConsolidatedActivity(activity.serialize()));

      // Update balance in segment result
      const balanceChange = activity.amount as number;
      const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, currentChange + balanceChange);
      return new Map([[accountId, balanceChange]]);
    }

    // Calculate patient cost
    const patientCost = this.healthcareManager.calculatePatientCost(activity, config, event.date);
    this.log('healthcare-patient-cost', { name: activity.name, billAmount: activity.amount, patientCost, configName: config.name });

    // Create the healthcare expense activity with actual patient cost
    const healthcareActivity = new ConsolidatedActivity({
      ...activity.serialize(),
      amount: -patientCost, // Negative = expense
    });

    // Add to segment result
    if (!segmentResult.activitiesAdded.has(event.accountId)) {
      segmentResult.activitiesAdded.set(event.accountId, []);
    }
    segmentResult.activitiesAdded.get(event.accountId)?.push(healthcareActivity);

    // Record healthcare out-of-pocket flow
    if (this.flowAggregator && patientCost > 0) {
      this.flowAggregator.recordHealthcare(event.date.getUTCFullYear(), 'outOfPocket', patientCost);
    }

    // Generate HSA reimbursement if enabled
    if (config.hsaReimbursementEnabled && config.hsaAccountId) {
      this.generateHSAReimbursement(config.hsaAccountId, event.accountId, patientCost, event.date, segmentResult, activity.name);
    }

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(event.accountId) || 0;
    segmentResult.balanceChanges.set(event.accountId, currentChange - patientCost);

    return new Map([[event.accountId, -patientCost]]);
  }

  /**
   * Generate automatic HSA reimbursement transfer
   */
  private generateHSAReimbursement(
    hsaAccountId: string,
    paymentAccountId: string,
    patientCost: number,
    date: Date,
    segmentResult: SegmentResult,
    activityName: string,
  ): void {
    try {
      // Get HSA account balance
      const hsaBalance = this.getCurrentAccountBalance(hsaAccountId, segmentResult);

      // Calculate reimbursement amount (partial if insufficient funds)
      const reimbursementAmount = Math.min(patientCost, Math.max(0, hsaBalance));

      if (reimbursementAmount <= 0.01) {
        return; // No reimbursement possible
      }

      this.log('hsa-reimbursement', { hsaAccountId, reimbursementAmount, patientCost });

      // Record HSA reimbursement flow (pass positive amount; aggregator negates)
      if (this.flowAggregator) {
        this.flowAggregator.recordHealthcare(date.getUTCFullYear(), 'hsaReimbursements', reimbursementAmount);
      }

      // Find accounts for activity names
      const hsaAccount = this.balanceTracker.findAccountById(hsaAccountId);
      const paymentAccount = this.balanceTracker.findAccountById(paymentAccountId);

      // Create HSA withdrawal activity (negative to HSA)
      const hsaWithdrawal = new ConsolidatedActivity({
        id: `HSA-REIMBURSE-${activityName}-${date.getTime()}`,
        name: 'HSA Reimbursement',
        amount: -reimbursementAmount,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(date),
        dateIsVariable: false,
        dateVariable: null,
        from: hsaAccount?.name || 'HSA',
        to: paymentAccount?.name || '',
        isTransfer: true,
        category: 'Healthcare.HSA Reimbursement',
        flag: true,
        flagColor: 'cyan',
      });

      // Create deposit to payment account (positive)
      const accountDeposit = new ConsolidatedActivity({
        ...hsaWithdrawal.serialize(),
        amount: reimbursementAmount,
      });

      // Add activities to segment result
      if (!segmentResult.activitiesAdded.has(hsaAccountId)) {
        segmentResult.activitiesAdded.set(hsaAccountId, []);
      }
      if (!segmentResult.activitiesAdded.has(paymentAccountId)) {
        segmentResult.activitiesAdded.set(paymentAccountId, []);
      }

      segmentResult.activitiesAdded.get(hsaAccountId)?.push(hsaWithdrawal);
      segmentResult.activitiesAdded.get(paymentAccountId)?.push(accountDeposit);

      // Update balances
      const hsaChange = segmentResult.balanceChanges.get(hsaAccountId) || 0;
      const accountChange = segmentResult.balanceChanges.get(paymentAccountId) || 0;

      segmentResult.balanceChanges.set(hsaAccountId, hsaChange - reimbursementAmount);
      segmentResult.balanceChanges.set(paymentAccountId, accountChange + reimbursementAmount);
    } catch (error) {
      this.log('hsa-reimbursement-error', { error: String(error) });
      throw error; // Re-throw to propagate the error
    }
  }

  processBillEvent(event: BillEvent, segmentResult: SegmentResult, simulation: string): Map<string, number> {
    const bill = event.originalBill;

    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager) {
      if (bill.person && this.mortalityManager.isDeceased(bill.person)) {
        this.log('bill-skipped-deceased', { name: bill.name, person: bill.person });
        return new Map();
      }
      if (!bill.person && this.mortalityManager.allDeceased()) {
        this.log('bill-skipped-all-deceased', { name: bill.name });
        return new Map();
      }
    }

    // Route paycheck bills to paycheck processor
    if (bill.paycheckProfile) {
      this.log('paycheck-bill-routed', { name: bill.name });
      return this.processPaycheckBill(event, segmentResult, simulation);
    }

    // Route healthcare bills to healthcare processor
    if (bill.isHealthcare) {
      this.log('healthcare-bill-routed', { name: bill.name, person: bill.healthcarePerson || '' });
      return this.processHealthcareBill(event, segmentResult, simulation);
    }

    const accountId = event.accountId;
    let amount = event.amount;

    // Apply contribution limits for bills on retirement/HSA accounts
    // TODO: When paycheck feature is implemented (#36), employer contributions will be
    // tracked separately with proper employer match formulas. For now, we detect
    // employer contributions by name containing "Employer" and skip the 402(g) limit.
    // Employer contributions should be checked against the 415(c) total addition limit
    // ($70,000 in 2025) which includes both employee and employer contributions.
    if (typeof amount === 'number' && amount > 0) {
      const account = this.balanceTracker.findAccountById(accountId);
      if (account?.contributionLimitType) {
        const isEmployerContribution = bill.name.toLowerCase().includes('employer');

        if (!isEmployerContribution) {
          // TODO: Use historical catchUpLimits from historicRates.json instead of hardcoded
          // CATCHUP_LIMITS_2024. Also add 415(c) totalAdditionLimit checking for combined
          // employee + employer contributions. Historical data has been added to historicRates.json.
          const limitType = account.contributionLimitType as '401k' | 'ira' | 'hsa';
          const year = event.date.getUTCFullYear();
          const mcRatio = this.getMCLimitChangeRatio(limitType, event.date);
          const remaining = this.contributionLimitManager.getRemainingLimit(
            account.accountOwnerDOB,
            year,
            limitType,
            mcRatio,
          );

          if (remaining !== Infinity) {
            const cappedAmount = Math.min(amount, remaining);
            if (cappedAmount < amount) {
              this.log('contribution-capped', { accountId, requestedAmount: amount, cappedAmount, limitType });
            }
            if (cappedAmount > 0) {
              this.contributionLimitManager.recordContribution(
                account.accountOwnerDOB,
                year,
                limitType,
                cappedAmount,
              );
            }
            amount = cappedAmount;
          }
        } else {
          this.log('employer-contribution-skip-402g', { accountId, amount, billName: bill.name });
        }
      }
    }

    // Track tax deductible amounts
    const year = event.date.getUTCFullYear();
    const numAmount = Number(amount);

    // Handle tax-deductible bills: categorize and add to deduction tracker
    if (bill.taxDeductible && numAmount < 0) {
      // Only negative amounts (expenses) can be deductible
      const deductibleAmount = Math.abs(numAmount);

      // Determine deduction category from bill context
      const account = this.balanceTracker.findAccountById(accountId);
      let deductionCategory: 'mortgageInterest' | 'propertyTax' | 'charitable' | 'stateTax' | 'studentLoanInterest' | 'hsaContribution' | 'traditionalIRA' | null = null;

      // Check bill category and account type for categorization
      const billCat = bill.category?.toLowerCase() || '';
      const accountName = account?.name.toLowerCase() || '';

      // HEURISTIC: This categorization is based on string matching of account/bill names.
      // For robust tax deduction tracking, bills should have an explicit taxDeductionCategory field.
      // TODO: Add explicit taxDeductionCategory field to bill model in future update.
      if (accountName.includes('mortgage')) {
        deductionCategory = 'mortgageInterest';
      } else if (billCat.includes('property') || billCat.includes('tax')) {
        deductionCategory = 'propertyTax';
      } else if (billCat.includes('charit') || billCat.includes('donat')) {
        deductionCategory = 'charitable';
      }

      if (deductionCategory) {
        this.deductionTracker.addDeduction(year, deductionCategory, deductibleAmount);
        this.log('deduction-tracked', { billName: bill.name, category: deductionCategory, amount: deductibleAmount });
      }
    }

    // Handle student loan interest deduction
    if (bill.studentLoanInterest && numAmount < 0) {
      const deductibleAmount = Math.abs(numAmount);
      this.deductionTracker.addDeduction(year, 'studentLoanInterest', deductibleAmount);
      this.log('deduction-tracked', { billName: bill.name, category: 'studentLoanInterest', amount: deductibleAmount });
    }

    // Create consolidated activity for the bill
    const billActivity = new ConsolidatedActivity(
      bill.toActivity(`${bill.id}-${event.date}`, simulation, amount, event.date).serialize(),
      { billId: bill.id, firstBill: event.firstBill },
    );

    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(billActivity);

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
    this.log('bill-processed', { name: bill.name, accountId, amount: Number(amount), isHealthcare: false });

    // Record flow
    if (this.flowAggregator) {
      if (numAmount > 0) {
        this.flowAggregator.recordIncome(year, bill.category || 'Income', numAmount);
      } else if (numAmount < 0) {
        this.flowAggregator.recordExpense(year, (bill.category || 'Uncategorized').split('.')[0], Math.abs(numAmount));
      }
    }

    return new Map([[accountId, Number(amount)]]);
  }

  /**
   * Process a healthcare bill event
   */
  private processHealthcareBill(
    event: BillEvent,
    segmentResult: SegmentResult,
    simulation: string,
  ): Map<string, number> {
    const bill = event.originalBill;
    const config = this.healthcareManager.getActiveConfig(bill.healthcarePerson || '', event.date);

    if (!config) {
      // No config = treat as regular bill (process directly to avoid infinite recursion)
      const accountId = event.accountId;
      const amount = event.amount;

      const billActivity = new ConsolidatedActivity(
        bill.toActivity(`${bill.id}-${event.date}`, simulation, amount, event.date).serialize(),
        { billId: bill.id, firstBill: event.firstBill },
      );

      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId)?.push(billActivity);

      const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
      return new Map([[accountId, Number(amount)]]);
    }

    // Calculate patient cost using the inflated event amount
    const patientCost = this.healthcareManager.calculatePatientCost(bill, config, event.date, event.amount as number);
    this.log('healthcare-patient-cost', { name: bill.name, billAmount: event.amount, patientCost, configName: config.name });

    // Create consolidated activity for the bill
    const billActivity = new ConsolidatedActivity(
      bill.toActivity(`${bill.id}-${event.date}`, simulation, -patientCost, event.date).serialize(),
      { billId: bill.id, firstBill: event.firstBill },
    );

    if (!segmentResult.activitiesAdded.has(event.accountId)) {
      segmentResult.activitiesAdded.set(event.accountId, []);
    }
    segmentResult.activitiesAdded.get(event.accountId)?.push(billActivity);

    // Record healthcare out-of-pocket flow
    if (this.flowAggregator && patientCost > 0) {
      this.flowAggregator.recordHealthcare(event.date.getUTCFullYear(), 'outOfPocket', patientCost);
    }

    // Generate HSA reimbursement if enabled
    if (config.hsaReimbursementEnabled && config.hsaAccountId) {
      this.generateHSAReimbursement(config.hsaAccountId, event.accountId, patientCost, event.date, segmentResult, bill.name);
    }

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(event.accountId) || 0;
    segmentResult.balanceChanges.set(event.accountId, currentChange - patientCost);

    return new Map([[event.accountId, -patientCost]]);
  }

  /**
   * Process a paycheck bill event using the PaycheckProcessor
   */
  private processPaycheckBill(
    event: BillEvent,
    segmentResult: SegmentResult,
    simulation: string,
  ): Map<string, number> {
    const bill = event.originalBill;
    const profile = bill.paycheckProfile;
    if (!profile) {
      throw new Error(`Bill ${bill.name} marked as paycheck but has no profile`);
    }

    // Get the account and owner DOB
    const account = this.balanceTracker.findAccountById(event.accountId);
    if (!account) {
      throw new Error(`Account ${event.accountId} not found for paycheck bill ${bill.name}`);
    }

    const year = event.date.getUTCFullYear();
    const ssWageBaseCap = this.retirementManager.getWageBaseCapForYear(year);

    // Determine additional Medicare threshold based on filing status
    const filingStatus = this.mortalityManager?.getFilingStatus(event.date) ?? this.filingStatus;
    const additionalMedicareThreshold = filingStatus === 'mfj' ? 250000 : 200000;

    // Compute paychecks per year from bill frequency
    const paychecksPerYear = this.computePaychecksPerYear(bill.everyN, bill.periods);

    // Compute gross pay from paycheck profile (not from bill amount)
    let grossPay = profile.grossPay;

    // Apply raise correction for missed raises during unemployment years
    if (this.jobLossManager) {
      const skippedYears = this.jobLossManager.getRaisesSkippedYears(bill.name);
      if (skippedYears.size > 0) {
        let correctionFactor = 1;
        for (const skippedYear of skippedYears) {
          if (skippedYear < year) {
            // Get raise rate - use bill's increaseBy field
            const raiseRate = bill.increaseBy ?? 0.03;
            correctionFactor *= (1 + raiseRate);
          }
        }
        if (correctionFactor > 1) {
          grossPay = grossPay / correctionFactor;
          this.log('raise-correction-applied', {
            billName: bill.name,
            year,
            correctionFactor,
            adjustedGross: grossPay,
            skippedYears: Array.from(skippedYears).sort(),
          });
        }
      }
    }

    // Process the paycheck using shared utility
    const dynamicFilingStatus = this.mortalityManager?.getFilingStatus(event.date) ?? this.filingStatus;
    const paycheckResult = computeNetPay({
      grossPay,
      profile,
      billName: bill.name,
      date: event.date,
      accountOwnerDOB: account.accountOwnerDOB,
      paychecksPerYear,
      filingStatus: dynamicFilingStatus,
      bracketInflationRate: this.bracketInflationRate,
      ssWageBaseCap,
      mcRateGetter: this.getMCRateGetter(),
      processor: this.paycheckProcessor,
    });

    // Skip downstream processing if paycheck is empty (suppressed during unemployment)
    if (paycheckResult.grossPay === 0) {
      this.log('paycheck-empty-skip-downstream', { billName: bill.name, date: event.date.toISOString() });

      // Record zero income to FlowAggregator for accurate unemployment tracking
      if (this.flowAggregator) {
        this.flowAggregator.recordIncome(year, bill.category || 'Income', 0);
      }

      // Generate COBRA if person had healthcare deductions
      if (this.jobLossManager) {
        const hasHealthcare = profile.deductions?.some(d =>
          d.label.toLowerCase().includes('medical') ||
          d.label.toLowerCase().includes('dental') ||
          d.label.toLowerCase().includes('vision') ||
          d.label.toLowerCase().includes('health') ||
          d.label.toLowerCase().includes('insurance')
        );

        if (hasHealthcare) {
          const cobraMonthsElapsed = this.jobLossManager.getCobraMonthsElapsed(bill.name);
          if (cobraMonthsElapsed < 18) {
            // Only generate COBRA once per month - check if this is a different month than last time
            const lastCobraMonth = this.paycheckStateTracker.getLastCobraMonth(bill.name);
            const currentMonth = event.date.getUTCMonth();

            if (lastCobraMonth === null || lastCobraMonth !== currentMonth) {
              this.jobLossManager.incrementCobraMonth(bill.name);
              this.paycheckStateTracker.setLastCobraMonth(bill.name, currentMonth);

              // Determine COBRA premium based on profile (for now, use fixed family estimate)
              const cobraPremium = 1700; // Family COBRA estimate, ~$1,700/month

              // Create COBRA expense activity on the main checking account
              const cobraActivity = new ConsolidatedActivity({
                id: `${bill.id}-cobra-${event.date}`,
                date: formatDate(event.date),
                dateIsVariable: false,
                dateVariable: null,
                name: `COBRA Insurance from ${bill.name}`,
                category: 'Healthcare',
                amount: -cobraPremium, // Negative for expense
                amountIsVariable: false,
                amountVariable: null,
                flag: false,
                flagColor: null,
                isTransfer: false,
                from: null,
                to: null,
              });

              if (!segmentResult.activitiesAdded.has(event.accountId)) {
                segmentResult.activitiesAdded.set(event.accountId, []);
              }
              segmentResult.activitiesAdded.get(event.accountId)?.push(cobraActivity);

              // Update main account balance
              const currentMainChange = segmentResult.balanceChanges.get(event.accountId) || 0;
              segmentResult.balanceChanges.set(event.accountId, currentMainChange - cobraPremium);

              // Record flow
              if (this.flowAggregator) {
                this.flowAggregator.recordExpense(year, 'Healthcare', cobraPremium);
              }

              this.log('cobra-generated', {
                billName: bill.name,
                date: event.date.toISOString(),
                cobraMonthsElapsed: cobraMonthsElapsed + 1,
                premium: cobraPremium,
              });
            }
          }
        }
      }

      // Generate death-triggered COBRA for surviving spouse if policyholder is deceased
      if (this.mortalityManager && this.healthcareManager) {
        const healthcareConfigs = this.healthcareManager.getAllConfigs();
        for (const config of healthcareConfigs) {
          if (config.policyholder && this.mortalityManager.isDeceased(config.policyholder)) {
            const deathCobraMonthsElapsed = this.mortalityManager.getDeathCobraMonthsElapsed(config.policyholder);
            if (deathCobraMonthsElapsed < 36) {
              // Only generate COBRA once per month
              const lastDeathCobraMonth = this.mortalityManager.getLastDeathCobraMonth(config.policyholder);
              const currentMonth = event.date.getUTCMonth();

              if (lastDeathCobraMonth === null || lastDeathCobraMonth !== currentMonth) {
                this.mortalityManager.incrementDeathCobraMonth(config.policyholder);
                this.mortalityManager.setLastDeathCobraMonth(config.policyholder, currentMonth);

                // Use ACA manager's COBRA premium calculation which correctly handles MC inflation
                const cobraPremium = this.acaManager.getCobraMonthlyPremium(year, config.monthlyPremium);

                // Create death COBRA expense activity
                const deathCobraActivity = new ConsolidatedActivity({
                  id: `${config.id}-death-cobra-${event.date}`,
                  date: formatDate(event.date),
                  dateIsVariable: false,
                  dateVariable: null,
                  name: `COBRA Insurance (Policyholder Death)`,
                  category: 'Healthcare.COBRA',
                  amount: -cobraPremium,
                  amountIsVariable: false,
                  amountVariable: null,
                  flag: true,
                  flagColor: 'orange',
                  isTransfer: false,
                  from: null,
                  to: null,
                });

                if (!segmentResult.activitiesAdded.has(event.accountId)) {
                  segmentResult.activitiesAdded.set(event.accountId, []);
                }
                segmentResult.activitiesAdded.get(event.accountId)?.push(deathCobraActivity);

                // Update account balance
                const currentChange = segmentResult.balanceChanges.get(event.accountId) || 0;
                segmentResult.balanceChanges.set(event.accountId, currentChange - cobraPremium);

                // Record flow
                if (this.flowAggregator) {
                  this.flowAggregator.recordHealthcare(year, 'cobra', cobraPremium);
                }

                this.log('death-cobra-generated', {
                  policyholder: config.policyholder,
                  date: event.date.toISOString(),
                  deathCobraMonthsElapsed: deathCobraMonthsElapsed + 1,
                  premium: cobraPremium,
                });
              }
            }
          }
        }
      }

      return new Map();
    }

    // Create main net pay activity for the primary account
    const mainActivityData = bill
      .toActivity(`${bill.id}-${event.date}`, simulation, paycheckResult.netPay, event.date)
      .serialize();

    // Populate paycheckDetails with the full breakdown
    mainActivityData.paycheckDetails = {
      grossPay: paycheckResult.grossPay,
      netPay: paycheckResult.netPay,
      traditional401k: paycheckResult.traditional401k,
      roth401k: paycheckResult.roth401k,
      employerMatch: paycheckResult.employerMatch,
      hsa: paycheckResult.hsa,
      hsaEmployer: paycheckResult.hsaEmployer,
      ssTax: paycheckResult.ssTax,
      medicareTax: paycheckResult.medicareTax,
      federalWithholding: paycheckResult.federalWithholding,
      stateWithholding: paycheckResult.stateWithholding,
      preTaxDeductions: paycheckResult.preTaxDeductions,
      postTaxDeductions: paycheckResult.postTaxDeductions,
    };

    const mainActivity = new ConsolidatedActivity(
      mainActivityData,
      { billId: bill.id, firstBill: event.firstBill },
    );
    // Mark as paycheck activity to prevent AIME double-counting in segment-processor
    (mainActivity as any).isPaycheckActivity = true;

    if (!segmentResult.activitiesAdded.has(event.accountId)) {
      segmentResult.activitiesAdded.set(event.accountId, []);
    }
    segmentResult.activitiesAdded.get(event.accountId)?.push(mainActivity);

    // AIME: feed gross wages, not net (Option A from spec — fixes #8)
    this.retirementManager.tryAddToAnnualIncomes(bill.name, event.date, paycheckResult.grossPay);

    // Update main account balance
    const currentMainChange = segmentResult.balanceChanges.get(event.accountId) || 0;
    segmentResult.balanceChanges.set(event.accountId, currentMainChange + paycheckResult.netPay);

    // Create deposit activities for each destination (401k, HSA, employer match, etc.)
    for (const deposit of paycheckResult.depositActivities) {
      // Create activity for the deposit
      const depositActivity = new ConsolidatedActivity({
        id: `${bill.id}-${event.date}-${deposit.label}`,
        date: formatDate(event.date),
        dateIsVariable: false,
        dateVariable: null,
        name: `${deposit.label} from ${bill.name}`,
        category: 'Paycheck',
        amount: deposit.amount,
        amountIsVariable: false,
        amountVariable: null,
        flag: false,
        flagColor: null,
        isTransfer: false,
        from: null,
        to: null,
      });

      if (!segmentResult.activitiesAdded.has(deposit.accountId)) {
        segmentResult.activitiesAdded.set(deposit.accountId, []);
      }
      segmentResult.activitiesAdded.get(deposit.accountId)?.push(depositActivity);

      // Update deposit account balance
      const currentDepositChange = segmentResult.balanceChanges.get(deposit.accountId) || 0;
      segmentResult.balanceChanges.set(deposit.accountId, currentDepositChange + deposit.amount);
    }

    // Record flow for income and taxes
    if (this.flowAggregator) {
      // Record gross income
      this.flowAggregator.recordIncome(year, bill.category || 'Income', paycheckResult.grossPay);
      // Record taxes as expenses
      const totalTaxes =
        paycheckResult.ssTax +
        paycheckResult.medicareTax +
        paycheckResult.federalWithholding +
        paycheckResult.stateWithholding;
      if (totalTaxes > 0) {
        this.flowAggregator.recordExpense(year, 'Taxes', totalTaxes);
      }
    }

    // Record paycheck gross income minus pre-tax deductions as ordinary taxable income
    // This keeps the existing tax machinery working during Cycle A
    let taxableWages = paycheckResult.grossPay - paycheckResult.traditional401k - paycheckResult.hsa - paycheckResult.hsaEmployer;
    // Subtract other pre-tax deductions
    for (const ded of paycheckResult.preTaxDeductions) {
      // traditional401k and HSA already subtracted above
      if (ded.label !== 'Traditional 401k' && ded.label !== 'HSA Employee') {
        taxableWages -= ded.amount;
      }
    }

    const accountName = account.name;
    if (!segmentResult.taxableOccurrences.has(accountName)) {
      segmentResult.taxableOccurrences.set(accountName, []);
    }
    segmentResult.taxableOccurrences.get(accountName)?.push({
      date: event.date,
      year: event.date.getUTCFullYear(),
      amount: taxableWages,
      incomeType: 'ordinary' as IncomeType,
    });

    this.log('paycheck-processed', {
      name: bill.name,
      grossPay: paycheckResult.grossPay,
      netPay: paycheckResult.netPay,
      traditional401k: paycheckResult.traditional401k,
      roth401k: paycheckResult.roth401k,
      hsa: paycheckResult.hsa,
      employerMatch: paycheckResult.employerMatch,
      ssTax: paycheckResult.ssTax,
      medicareTax: paycheckResult.medicareTax,
    });

    // Bonus: fires once per year on the first paycheck of the bonus month
    let bonusResult: PaycheckResult | null = null;
    if (profile.bonus &&
        event.date.getUTCMonth() + 1 === profile.bonus.month &&
        !this.paycheckStateTracker.hasBonusFired(bill.name, year)) {
      this.paycheckStateTracker.markBonusFired(bill.name, year);

      bonusResult = this.paycheckProcessor.processBonusPaycheck(
        grossPay,
        paychecksPerYear,
        profile,
        bill.name,
        event.date,
        account.accountOwnerDOB ?? null,
        ssWageBaseCap,
        additionalMedicareThreshold,
        this.taxProfile,
      );

      // Create bonus net pay activity on main account
      const bonusActivity = new ConsolidatedActivity(
        bill
          .toActivity(`${bill.id}-bonus-${year}`, simulation, bonusResult.netPay, event.date)
          .serialize(),
        { billId: bill.id, firstBill: false },
      );
      // Mark as paycheck activity to prevent AIME double-counting in segment-processor
      (bonusActivity as any).isPaycheckActivity = true;

      if (!segmentResult.activitiesAdded.has(event.accountId)) {
        segmentResult.activitiesAdded.set(event.accountId, []);
      }
      segmentResult.activitiesAdded.get(event.accountId)?.push(bonusActivity);

      // Update main account balance for bonus net pay
      const currentMainChange = segmentResult.balanceChanges.get(event.accountId) || 0;
      segmentResult.balanceChanges.set(event.accountId, currentMainChange + bonusResult.netPay);

      // Create bonus deposit activities (401k, employer match, etc.)
      for (const deposit of bonusResult.depositActivities) {
        const depositActivity = new ConsolidatedActivity({
          id: `${bill.id}-bonus-${year}-${deposit.label}`,
          date: formatDate(event.date),
          dateIsVariable: false,
          dateVariable: null,
          name: `${deposit.label} from ${bill.name} (Bonus)`,
          category: 'Paycheck',
          amount: deposit.amount,
          amountIsVariable: false,
          amountVariable: null,
          flag: false,
          flagColor: null,
          isTransfer: false,
          from: null,
          to: null,
        });

        if (!segmentResult.activitiesAdded.has(deposit.accountId)) {
          segmentResult.activitiesAdded.set(deposit.accountId, []);
        }
        segmentResult.activitiesAdded.get(deposit.accountId)?.push(depositActivity);

        // Update deposit account balance
        const currentDepositChange = segmentResult.balanceChanges.get(deposit.accountId) || 0;
        segmentResult.balanceChanges.set(deposit.accountId, currentDepositChange + deposit.amount);
      }

      // AIME: feed gross bonus wages
      this.retirementManager.tryAddToAnnualIncomes(bill.name, event.date, bonusResult.grossPay);

      // Record flow for income and taxes
      if (this.flowAggregator) {
        this.flowAggregator.recordIncome(year, bill.category || 'Income', bonusResult.grossPay);
        const bonusTotalTaxes =
          bonusResult.ssTax +
          bonusResult.medicareTax +
          bonusResult.federalWithholding +
          bonusResult.stateWithholding;
        if (bonusTotalTaxes > 0) {
          this.flowAggregator.recordExpense(year, 'Taxes', bonusTotalTaxes);
        }
      }

      // Record bonus taxable wages as ordinary income
      let bonusTaxableWages = bonusResult.grossPay - bonusResult.traditional401k - bonusResult.hsa;
      for (const ded of bonusResult.preTaxDeductions) {
        if (ded.label !== 'Traditional 401k (Bonus)' && ded.label !== 'HSA Employee') {
          bonusTaxableWages -= ded.amount;
        }
      }

      if (!segmentResult.taxableOccurrences.has(accountName)) {
        segmentResult.taxableOccurrences.set(accountName, []);
      }
      segmentResult.taxableOccurrences.get(accountName)?.push({
        date: event.date,
        year: event.date.getUTCFullYear(),
        amount: bonusTaxableWages,
        incomeType: 'ordinary' as IncomeType,
      });

      this.log('bonus-paycheck-processed', {
        name: bill.name,
        bonusGross: bonusResult.grossPay,
        bonusNetPay: bonusResult.netPay,
        traditional401k: bonusResult.traditional401k,
        roth401k: bonusResult.roth401k,
        employerMatch: bonusResult.employerMatch,
        ssTax: bonusResult.ssTax,
        medicareTax: bonusResult.medicareTax,
      });
    }

    // Return balance changes for all affected accounts
    const allChanges = new Map<string, number>();
    allChanges.set(event.accountId, paycheckResult.netPay);
    for (const deposit of paycheckResult.depositActivities) {
      const existing = allChanges.get(deposit.accountId) || 0;
      allChanges.set(deposit.accountId, existing + deposit.amount);
    }

    // Merge bonus balance changes
    if (bonusResult) {
      const existingMainBonus = allChanges.get(event.accountId) || 0;
      allChanges.set(event.accountId, existingMainBonus + bonusResult.netPay);
      for (const deposit of bonusResult.depositActivities) {
        const existing = allChanges.get(deposit.accountId) || 0;
        allChanges.set(deposit.accountId, existing + deposit.amount);
      }
    }

    return allChanges;
  }

  /**
   * Compute paychecks per year from bill frequency
   */
  private computePaychecksPerYear(everyN: number, periods: 'day' | 'week' | 'month' | 'year'): number {
    switch (periods) {
      case 'day':
        return 365 / everyN;
      case 'week':
        return 52 / everyN;
      case 'month':
        return 12 / everyN;
      case 'year':
        return 1 / everyN;
      default:
        return 26; // Default to biweekly
    }
  }

  processInterestEvent(event: InterestEvent, segmentResult: SegmentResult): Map<string, number> {
    const interest = event.originalInterest;
    const accountId = event.accountId;
    const account = this.balanceTracker.findAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get the current balance of the account
    const currentBalance = this.getCurrentAccountBalance(accountId, segmentResult);

    // Skip interest on positive balances if account opts out
    if (account.interestAppliesToPositiveBalance === false && currentBalance > 0) {
      return new Map();
    }

    // Determine the APR to use (Monte Carlo sample or regular rate)
    let apr = event.rate;

    // Apply expense ratio (fund fees reduce the effective return)
    // Only apply to positive balances (investment gains), not to debt
    if (currentBalance > 0 && (account.expenseRatio ?? 0) > 0) {
      const baseApr = apr;
      apr = apr - (account.expenseRatio ?? 0);
      this.log('expense-ratio-applied', { accountId, baseApr, expenseRatio: account.expenseRatio, adjustedApr: apr });
    } else if (currentBalance > 0) {
      apr = apr - (account.expenseRatio ?? 0);
    }

    // Calculate the interest amount
    const interestAmount = this.calculateInterestAmount(currentBalance, apr, interest.compounded);

    // Only create activities for non-zero amounts (filter out zeros and floating-point noise)
    if (Math.abs(interestAmount) <= 0.001) {
      return new Map();
    }

    // Create consolidated activity for the interest
    const interestActivity = new ConsolidatedActivity(
      interest.toActivity(`${interest.id}-${event.date}`, this.simulation, interestAmount, event.date).serialize(),
      { interestId: interest.id, firstInterest: event.firstInterest },
    );
    interestActivity.flagColor = 'orange';
    interestActivity.flag = true;

    // Add activity to segment result
    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(interestActivity);

    // Add taxable occurrence to segment result
    if (account.interestPayAccount) {
      const taxableOccurrence: TaxableOccurrence = {
        date: event.date,
        year: event.date.getUTCFullYear(),
        amount: interestAmount,
        incomeType: 'interest' as IncomeType,
      };
      if (!segmentResult.taxableOccurrences.has(account.interestPayAccount)) {
        segmentResult.taxableOccurrences.set(account.interestPayAccount, []);
      }
      segmentResult.taxableOccurrences.get(account.interestPayAccount)?.push(taxableOccurrence);
    }

    this.log('interest-calculated', { accountId, balance: currentBalance, apr, amount: interestAmount });

    // Record interest flow — split positive (earned) vs negative (loan accrual)
    if (this.flowAggregator) {
      const year = event.date.getUTCFullYear();
      if (interestAmount > 0) {
        this.flowAggregator.recordInterest(year, interestAmount);
      } else if (interestAmount < 0) {
        // Loan interest is already covered by the transfer payment — skip to avoid double-counting
        if (account.type !== 'Loan') {
          this.flowAggregator.recordExpense(year, 'Interest Charges', Math.abs(interestAmount));
        }
      }
    }

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(interestAmount));
    return new Map([[accountId, Number(interestAmount)]]);
  }

  processActivityTransferEvent(event: ActivityTransferEvent, segmentResult: SegmentResult): Map<string, number> {
    return this.processTransferEvent(
      event,
      event.originalActivity,
      event.originalActivity.amount,
      false,
      segmentResult,
    );
  }

  processBillTransferEvent(event: BillTransferEvent, segmentResult: SegmentResult): Map<string, number> {
    // Mortality cessation check — skip if person is deceased
    const bill = event.originalBill;
    if (this.mortalityManager) {
      if (bill.person && this.mortalityManager.isDeceased(bill.person)) {
        this.log('bill-transfer-skipped-deceased', { name: bill.name, person: bill.person });
        return new Map();
      }
      if (!bill.person && this.mortalityManager.allDeceased()) {
        this.log('bill-transfer-skipped-all-deceased', { name: bill.name });
        return new Map();
      }
    }

    // Recalculate bill amount with Monte Carlo sampling or deterministic increases if configured
    let amount = event.amount;

    // Apply contribution limits for transfers to retirement accounts
    amount = this.applyCappedContribution(event, amount, event.date);

    return this.processTransferEvent(event, bill, amount, event.firstBill, segmentResult);
  }

  processTransferEvent(
    event: ActivityTransferEvent | BillTransferEvent,
    original: Activity | Bill,
    amount: number | '{FULL}' | '{HALF}' | '-{FULL}' | '-{HALF}',
    firstBill: boolean,
    segmentResult: SegmentResult,
  ): Map<string, number> {
    const fromAccountId = event.fromAccountId;
    const toAccountId = event.toAccountId;

    const toAccountBalance = this.getCurrentAccountBalance(toAccountId, segmentResult);
    const fromAccountBalance = this.getCurrentAccountBalance(fromAccountId, segmentResult);

    let internalAmount = typeof amount === 'number' ? amount : 0;

    // Check if this is a {FULL} or {HALF} transfer that needs balance resolution
    if ((original.amountIsVariable && original.amountVariable) || typeof original.amount === 'string') {
      // Handle variable amounts
      if (typeof original.amount === 'string') {
        switch (original.amount) {
          case '{FULL}':
            // Transfer enough to zero out the destination account
            internalAmount = -toAccountBalance;
            break;
          case '{HALF}':
            // Transfer half of what's needed to zero out the destination account
            internalAmount = -toAccountBalance * 0.5;
            break;
          case '-{FULL}':
            // Reverse: transfer the full balance of destination account
            internalAmount = toAccountBalance;
            break;
          case '-{HALF}':
            // Reverse: transfer half the balance of destination account
            internalAmount = toAccountBalance * 0.5;
            break;
          default:
            throw new Error(`Invalid amount: ${original.amount}`);
        }
        this.log('variable-amount-resolved', { resolution: original.amount, amount: internalAmount });
      }
    }

    // Apply transfer limitations based on account types
    const fromAccount = this.balanceTracker.findAccountById(fromAccountId);
    const toAccount = this.balanceTracker.findAccountById(toAccountId);

    if (fromAccount && toAccount) {
      // Handle "to" account limits for Loan/Credit accounts
      // The max transfer is the absolute value of the to account balance
      // (i.e. the amount that can be paid off)
      // This limit only applies to bills, not activities
      if (original instanceof Bill && (toAccount.type === 'Loan' || toAccount.type === 'Credit')) {
        const maxTransfer = Math.abs(toAccountBalance);
        const requestedAmount = Math.abs(internalAmount);
        internalAmount = Math.min(requestedAmount, maxTransfer);
        internalAmount = internalAmount > 0 ? internalAmount : 0; // Ensure non-negative
        if (requestedAmount > maxTransfer) {
          this.log('loan-limit-applied', { accountId: toAccountId, requestedAmount, limitedAmount: internalAmount });
        }
      }

      // Handle "from" account limits for non-Loan/Credit accounts transferring to Savings/Investment
      // The max transfer is the absolute value of the from account balance
      // (i.e. the amount that can be transferred without going negative)
      // This limit only applies to bills, not activities
      if (
        original instanceof Bill &&
        fromAccount.type !== 'Loan' &&
        fromAccount.type !== 'Credit' &&
        (toAccount.type === 'Savings' || toAccount.type === 'Investment')
      ) {
        if (Math.abs(internalAmount) > fromAccountBalance) {
          internalAmount = -Math.min(Math.abs(internalAmount), Math.max(0, fromAccountBalance));
        }
      }
    }

    // Only create activities for non-zero amounts (filter out zeros and floating-point noise)
    if (Math.abs(internalAmount) <= 0.00001) {
      return new Map();
    }

    const isBill = original instanceof Bill;
    const fromActivity = new ConsolidatedActivity(
      isBill
        ? original.toActivity(`${original.id}-${event.date}`, this.simulation, -internalAmount, event.date).serialize()
        : {
            id: original.id,
            name: original.name, // Use the original transfer name
            amount: -internalAmount,
            amountIsVariable: original.amountIsVariable || false,
            amountVariable: original.amountVariable || null,
            date: formatDate(event.date),
            dateIsVariable: original.dateIsVariable || false,
            dateVariable: original.dateVariable || null,
            from: original.fro,
            to: original.to,
            isTransfer: true,
            category: original.category || 'Ignore.Transfer',
            flag: original.flag || false,
            flagColor: original.flagColor || 'blue',
            spendingCategory: null,
          },
      {
        billId: isBill ? original.id : undefined,
        firstBill,
      },
    );

    const toActivity = new ConsolidatedActivity(
      isBill
        ? original.toActivity(`${original.id}-${event.date}`, this.simulation, internalAmount, event.date).serialize()
        : {
            id: original.id,
            name: original.name, // Use the original transfer name
            amount: internalAmount,
            amountIsVariable: original.amountIsVariable || false,
            amountVariable: original.amountVariable || null,
            date: formatDate(event.date),
            dateIsVariable: original.dateIsVariable || false,
            dateVariable: original.dateVariable || null,
            from: original.fro,
            to: original.to,
            isTransfer: true,
            category: original.category || 'Ignore.Transfer',
            flag: original.flag || false,
            flagColor: original.flagColor || 'blue',
            spendingCategory: null,
          },
      {
        billId: isBill ? original.id : undefined,
        firstBill,
      },
    );

    // Add activities to segment result
    if (!segmentResult.activitiesAdded.has(fromAccountId)) {
      segmentResult.activitiesAdded.set(fromAccountId, []);
    }
    if (!segmentResult.activitiesAdded.has(toAccountId)) {
      segmentResult.activitiesAdded.set(toAccountId, []);
    }

    segmentResult.activitiesAdded.get(fromAccountId)?.push(fromActivity);
    segmentResult.activitiesAdded.get(toAccountId)?.push(toActivity);

    // Apply withdrawal tax on transfers FROM pre-tax retirement accounts TO non-retirement accounts
    // Pre-tax account: usesRMD=true (Traditional 401k, Traditional IRA, etc)
    // Retirement account: usesRMD=true (includes both pre-tax and Roth, excludes taxable)
    // Tax applies when: source is pre-tax AND destination is NOT retirement
    const isFromPreTax = fromAccount && fromAccount.usesRMD;
    const isToRetirement = toAccount && toAccount.usesRMD;
    const shouldApplyWithdrawalTax = isFromPreTax && !isToRetirement;

    if (shouldApplyWithdrawalTax) {
      // Handle Withdrawal Tax
      const taxableOccurrence: TaxableOccurrence = {
        date: fromActivity.date,
        year: fromActivity.date.getUTCFullYear(),
        amount: internalAmount,
        incomeType: 'retirement' as IncomeType,
      };
      const taxPayAccount = toAccount?.name;
      if (!taxPayAccount) {
        throw new Error(`Account ${toAccountId} has no name`);
      }
      if (!segmentResult.taxableOccurrences.has(taxPayAccount)) {
        segmentResult.taxableOccurrences.set(taxPayAccount, []);
      }
      segmentResult.taxableOccurrences.get(taxPayAccount)?.push(taxableOccurrence);

      // Handle Early Withdrawal Penalty
      const earlyWithdrawalPenalty = fromAccount?.earlyWithdrawalPenalty ?? 0;
      const earlyWithdrawalDate = fromAccount?.earlyWithdrawalDate;
      if (earlyWithdrawalPenalty !== 0 && earlyWithdrawalDate && isBefore(fromActivity.date, earlyWithdrawalDate)) {
        const penaltyAmount = internalAmount * earlyWithdrawalPenalty;
        const taxableOccurrence: TaxableOccurrence = {
          date: fromActivity.date,
          year: fromActivity.date.getUTCFullYear(),
          amount: penaltyAmount,
          incomeType: 'penalty' as IncomeType,
        };
        const taxPayAccount = toAccount?.name;
        if (!taxPayAccount) {
          throw new Error(`Account ${toAccountId} has no name`);
        }
        if (!segmentResult.taxableOccurrences.has(taxPayAccount)) {
          segmentResult.taxableOccurrences.set(taxPayAccount, []);
        }
        segmentResult.taxableOccurrences.get(taxPayAccount)?.push(taxableOccurrence);
      }
    }

    // Update balances
    const fromCurrentChange = segmentResult.balanceChanges.get(fromAccountId) || 0;
    const toCurrentChange = segmentResult.balanceChanges.get(toAccountId) || 0;

    segmentResult.balanceChanges.set(fromAccountId, fromCurrentChange - internalAmount);
    segmentResult.balanceChanges.set(toAccountId, toCurrentChange + internalAmount);

    this.log('transfer-processed', { from: fromAccountId, to: toAccountId, amount: internalAmount, name: original.name });

    // Record transfer flow: classify by destination type
    if (this.flowAggregator && toAccount) {
      const year = event.date.getUTCFullYear();
      if (toAccount.type === 'Loan') {
        // Loan payments are debt servicing with no separate bill event — record as expense
        this.flowAggregator.recordExpense(year, (original.category || 'Debt Payment').split('.')[0], Math.abs(internalAmount));
      }
      // Credit card payments are NOT recorded — the underlying bills were already recorded as expenses
      // Transfers to savings/investment/checking are neutral (internal movement) — skip
    }

    return new Map([
      [fromAccountId, -internalAmount],
      [toAccountId, internalAmount],
    ]);
  }

  processPensionEvent(event: PensionEvent, segmentResult: SegmentResult): Map<string, number> {
    const pension = event.pension;
    const accountId = event.accountId;

    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager) {
      const personName = this.mortalityManager.extractPersonNameFromEntity(pension.name);
      if (this.mortalityManager.isDeceased(personName)) {
        this.log('pension-skipped-deceased', { name: pension.name, personName });
        return new Map();
      }
    }

    if (event.firstPayment) {
      const firstPaymentYear = event.date.getUTCFullYear();
      this.retirementManager.calculatePensionMonthlyPay(pension, firstPaymentYear);
    }
    let amount = this.retirementManager.getPensionMonthlyPay(pension.name);

    // Apply COLA if configured
    const firstPaymentYear = this.retirementManager.getPensionFirstPaymentYear(pension.name);
    if (firstPaymentYear !== null && pension.cola.type !== 'none') {
      const currentYear = event.date.getUTCFullYear();
      const yearsCollecting = currentYear - firstPaymentYear;

      if (pension.cola.type === 'fixed' && pension.cola.fixedRate !== undefined) {
        const colaMultiplier = Math.pow(1 + pension.cola.fixedRate, yearsCollecting);
        amount = amount * colaMultiplier;
      } else if (pension.cola.type === 'cpiLinked') {
        // TODO (#11): Implement CPI-linked COLA with Monte Carlo integration
        // This requires access to the sampled inflation rate in MC mode or the inflation variable
        // For now, skip COLA application for cpiLinked type
      }
    }

    // Create consolidated activity for the bill
    const pensionActivity = new ConsolidatedActivity({
      id: `PENSION-${pension.name}-${formatDate(event.date)}`,
      name: pension.name,
      amount: amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Income.Retirement',
      flag: true,
      flagColor: 'green',
    });

    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(pensionActivity);

    // Track pension income for tax purposes
    const paymentAmount = Math.abs(amount);
    const pensionAccountName = this.balanceTracker.findAccountById(accountId)?.name ?? accountId;
    if (!segmentResult.taxableOccurrences.has(pensionAccountName)) {
      segmentResult.taxableOccurrences.set(pensionAccountName, []);
    }
    segmentResult.taxableOccurrences.get(pensionAccountName)?.push({
      date: event.date,
      year: event.date.getUTCFullYear(),
      amount: paymentAmount,
      incomeType: 'ordinary' as IncomeType,
    });

    this.log('pension-processed', { name: pension.name, accountId, amount });

    // Record pension income flow
    if (this.flowAggregator && amount > 0) {
      this.flowAggregator.recordIncome(event.date.getUTCFullYear(), 'Income.Pension', amount);
    }

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
    return new Map([[accountId, Number(amount)]]);
  }

  processSocialSecurityEvent(event: SocialSecurityEvent, segmentResult: SegmentResult): Map<string, number> {
    const socialSecurity = event.socialSecurity;
    const accountId = event.accountId;

    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager) {
      const personName = this.mortalityManager.extractPersonNameFromEntity(socialSecurity.name);
      if (this.mortalityManager.isDeceased(personName)) {
        this.log('ss-skipped-deceased', { name: socialSecurity.name, personName });
        return new Map();
      }
    }

    if (event.firstPayment) {
      this.retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity);
      this.retirementManager.setSocialSecurityFirstPaymentYear(socialSecurity.name, event.date.getUTCFullYear());

      // Lock the survivor benefit when first payment is made (for spouse's benefit if this person dies)
      if (this.mortalityManager) {
        const personName = this.mortalityManager.extractPersonNameFromEntity(socialSecurity.name);
        const monthlyPay = this.retirementManager.getSocialSecurityMonthlyPay(socialSecurity.name);
        this.mortalityManager.lockSurvivorBenefit(personName, monthlyPay);
        this.log('survivor-benefit-locked-first-payment', { person: personName, monthly_pay: monthlyPay });
      }
    }
    let amount = this.retirementManager.getSocialSecurityMonthlyPay(socialSecurity.name);

    // Apply COLA if configured
    const firstPaymentYear = this.retirementManager.getSocialSecurityFirstPaymentYear(socialSecurity.name);
    if (firstPaymentYear !== null && socialSecurity.colaVariable) {
      const currentYear = event.date.getUTCFullYear();
      const yearsCollecting = currentYear - firstPaymentYear;

      if (yearsCollecting > 0) {
        const mcRateGetter = this.getMCRateGetter();
        if (mcRateGetter) {
          // MC mode: compound per-year COLA from CPI draws, floored at 0
          let colaMultiplier = 1;
          for (let y = firstPaymentYear + 1; y <= currentYear; y++) {
            const cpiRate = mcRateGetter(MonteCarloSampleType.INFLATION, y);
            const yearCola = cpiRate !== null ? Math.max(0, cpiRate) : 0;
            colaMultiplier *= (1 + yearCola);
          }
          amount = amount * colaMultiplier;
        } else {
          // Deterministic mode: use fixed COLA rate
          const colaRate = (loadVariable(socialSecurity.colaVariable, this.simulation) as number) || 0;
          const colaMultiplier = Math.pow(1 + colaRate, yearsCollecting);
          amount = amount * colaMultiplier;
        }
      }
    }

    // Create consolidated activity for the bill
    const socialSecurityActivity = new ConsolidatedActivity({
      id: `SOCIAL-SECURITY-${socialSecurity.name}-${formatDate(event.date)}`,
      name: socialSecurity.name,
      amount: amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Income.Retirement',
      flag: true,
      flagColor: 'green',
    });

    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(socialSecurityActivity);

    // Track SS income for tax purposes
    const paymentAmount = Math.abs(amount);
    const ssAccountName = this.balanceTracker.findAccountById(accountId)?.name ?? accountId;
    if (!segmentResult.taxableOccurrences.has(ssAccountName)) {
      segmentResult.taxableOccurrences.set(ssAccountName, []);
    }
    segmentResult.taxableOccurrences.get(ssAccountName)?.push({
      date: event.date,
      year: event.date.getUTCFullYear(),
      amount: paymentAmount,
      incomeType: 'socialSecurity' as IncomeType,
    });

    this.log('ss-processed', { name: socialSecurity.name, accountId, amount });

    // Record SS income flow
    if (this.flowAggregator && amount > 0) {
      this.flowAggregator.recordIncome(event.date.getUTCFullYear(), 'Income.Social Security', amount);
    }

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
    return new Map([[accountId, Number(amount)]]);
  }

  processTaxEvent(event: TaxEvent, segmentResult: SegmentResult): Map<string, number> {
    // Mortality cessation check — skip if all persons deceased
    if (this.mortalityManager && this.mortalityManager.allDeceased()) {
      this.log('tax-skipped-all-deceased', {});
      return new Map();
    }

    // Get the account for this event
    const account = this.balanceTracker.findAccountById(event.accountId);
    if (!account) {
      throw new Error(`Account ${event.accountId} not found`);
    }
    const accountId = account.id;

    // Get prior year for reconciliation
    const taxYear = event.date.getUTCFullYear() - 1;

    // Use dynamic filing status for tax year
    const taxEventFilingStatus = this.mortalityManager?.getFilingStatus(event.date) ?? this.filingStatus;
    const taxEventProfile: TaxProfile = {
      filingStatus: taxEventFilingStatus,
      state: this.taxProfile.state,
      stateTaxRate: this.taxProfile.stateTaxRate,
      itemizationMode: this.taxProfile.itemizationMode,
    };

    // Compute unified tax reconciliation for prior year
    const reconciliation = this.taxManager.computeReconciliation(
      taxYear,
      taxEventProfile,
      this.deductionTracker,
      this.bracketInflationRate,
      this.getMCRateGetter(),
    );

    // Settlement amount: positive = payment due, negative = refund
    // For activity, we negate it so positive payment = negative balance change (money out)
    const amount = -reconciliation.settlement;

    if (amount === 0) {
      return new Map();
    }

    this.log('tax-event-processed', {
      year: taxYear,
      reconciliation: {
        total_income: reconciliation.totalIncome,
        agi: reconciliation.agi,
        taxable_income: reconciliation.taxableIncome,
        total_tax_owed: reconciliation.totalTaxOwed,
        total_witheld: reconciliation.totalWithheld,
        settlement: reconciliation.settlement,
      },
    });

    // Record tax flow with federal/state breakdown
    if (this.flowAggregator) {
      // If settlement is positive, the taxpayer owes (payment)
      // If settlement is negative, taxpayer gets refund
      if (reconciliation.settlement > 0) {
        this.flowAggregator.recordTax(taxYear, reconciliation.federalTax, reconciliation.ssTax);
      } else {
        // Refund: record as negative (credit back)
        this.flowAggregator.recordTax(taxYear, -reconciliation.settlement, 0);
      }
    }

    // Create the tax activity
    const activityName = reconciliation.settlement > 0 ? 'Tax Payment' : 'Tax Refund';
    const taxActivity = new ConsolidatedActivity({
      id: `TAX-${accountId}-${formatDate(event.date)}`,
      name: activityName,
      amount: amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: reconciliation.settlement > 0 ? 'Taxes.Federal' : 'Taxes.Refund',
      flag: true,
      flagColor: 'orange',
    });

    // Add the tax activity to the segment result
    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(taxActivity);

    // Update the balance in the segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + amount);
    return new Map([[accountId, amount]]);
  }

  processRMDEvent(event: RMDEvent, segmentResult: SegmentResult): Map<string, number> {
    // Get the event (from) account
    const account = this.balanceTracker.findAccountById(event.accountId);
    if (!account) {
      throw new Error(`Account ${event.accountId} not found`);
    }
    if (!account.usesRMD) {
      return new Map();
    }

    // Mortality cessation check — skip if account owner is deceased
    if (this.mortalityManager) {
      if (this.mortalityManager.isAccountOwnerDeceased(account.name, account.person)) {
        this.log('rmd-skipped-account-owner-deceased', { accountId: account.id, accountName: account.name, person: account.person });
        return new Map();
      }
      // Also skip if all persons are deceased (edge case)
      if (this.mortalityManager.allDeceased()) {
        this.log('rmd-skipped-all-deceased', { accountId: account.id });
        return new Map();
      }
    }

    // Get the RMD (to) account
    if (!account.rmdAccount) {
      throw new Error(`Account ${account.id} has no RMD account`);
    }
    const rmdAccount = this.accountManager.getAccountByName(account.rmdAccount);
    if (!rmdAccount) {
      throw new Error(`Account ${account.rmdAccount} not found`);
    }

    // Calculate the RMD amount
    const balance = this.balanceTracker.getAccountBalance(account.id);
    const rmdAmount = this.retirementManager.rmd(balance, event.ownerAge);
    if (rmdAmount <= 0) {
      return new Map();
    }

    this.log('rmd-processed', { accountId: account.id, rmdAmount, priorYearBalance: balance });

    // Record RMD transfer flow
    this.flowAggregator?.recordTransfer(event.date.getUTCFullYear(), 'rmdDistributions', rmdAmount);

    // Create the RMD From Activity
    const rmdFromActivity = new ConsolidatedActivity({
      id: `RMD-${account.id}-${formatDate(event.date)}`,
      name: 'RMD',
      amount: -rmdAmount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: account.name,
      to: account.rmdAccount,
      isTransfer: true,
      category: 'Ignore.Transfer',
      flag: true,
      flagColor: 'grape',
    });

    // Create the RMD To Activity
    const rmdToActivity = new ConsolidatedActivity({
      ...rmdFromActivity.serialize(),
      amount: rmdAmount,
    });

    // Add activities to segment result
    if (!segmentResult.activitiesAdded.has(account.id)) {
      segmentResult.activitiesAdded.set(account.id, []);
    }
    if (!segmentResult.activitiesAdded.has(rmdAccount.id)) {
      segmentResult.activitiesAdded.set(rmdAccount.id, []);
    }
    segmentResult.activitiesAdded.get(account.id)?.push(rmdFromActivity);
    segmentResult.activitiesAdded.get(rmdAccount.id)?.push(rmdToActivity);

    // Track RMD income for tax purposes
    if (!segmentResult.taxableOccurrences.has(rmdAccount.name)) {
      segmentResult.taxableOccurrences.set(rmdAccount.name, []);
    }
    segmentResult.taxableOccurrences.get(rmdAccount.name)?.push({
      date: event.date,
      year: event.date.getUTCFullYear(),
      amount: rmdAmount,
      incomeType: 'retirement' as IncomeType,
    });

    // Update balance in segment result
    const fromCurrentChange = segmentResult.balanceChanges.get(account.id) || 0;
    const toCurrentChange = segmentResult.balanceChanges.get(rmdAccount.id) || 0;
    segmentResult.balanceChanges.set(account.id, fromCurrentChange - rmdAmount);
    segmentResult.balanceChanges.set(rmdAccount.id, toCurrentChange + rmdAmount);
    return new Map([
      [account.id, -rmdAmount],
      [rmdAccount.id, rmdAmount],
    ]);
  }

  processRothConversionEvent(event: RothConversionEvent, segmentResult: SegmentResult): Map<string, number> {
    // Mortality cessation check — skip if all persons are deceased
    if (this.mortalityManager && this.mortalityManager.allDeceased()) {
      this.log('roth-conversion-skipped-all-deceased', { year: event.year });
      return new Map();
    }

    // Process Roth conversions for this year
    // This delegates to the RothConversionManager which handles the bracket-filling logic
    const rothFilingStatus = this.mortalityManager?.getFilingStatus(event.date) ?? this.filingStatus;
    const conversions = this.rothConversionManager.processConversions(
      event.year,
      this.taxManager,
      this.balanceTracker,
      rothFilingStatus,
      this.bracketInflationRate,
      this.simulation,
      segmentResult,
      this.getMCRateGetter(),
    );

    const totalConversionAmount = conversions.reduce((sum: number, c: ConversionResult) => sum + c.amount, 0);

    this.log('roth-conversion-processed', {
      conversionsCount: conversions.length,
      totalAmount: totalConversionAmount,
    });

    // Record Roth conversion transfer flow
    if (this.flowAggregator && totalConversionAmount > 0) {
      this.flowAggregator.recordTransfer(event.year, 'rothConversions', totalConversionAmount);
    }

    // Create transfer activities for each conversion that happened
    for (const conversion of conversions) {
      const sourceAccount = this.balanceTracker.findAccountById(conversion.sourceAccountId);
      const destAccount = this.balanceTracker.findAccountById(conversion.destinationAccountId);

      if (!sourceAccount || !destAccount) {
        continue;
      }

      // Create transfer activity (negative amount — money leaving source account)
      const transferActivity = new ConsolidatedActivity({
        id: `ROTH-CONVERSION-${conversion.sourceAccountId}-${conversion.destinationAccountId}-${event.year}`,
        name: `Roth Conversion: ${sourceAccount.name} → ${destAccount.name}`,
        amount: -conversion.amount,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(new Date(event.year, 11, 31)), // Dec 31
        dateIsVariable: false,
        dateVariable: null,
        from: sourceAccount.name,
        to: destAccount.name,
        isTransfer: true,
        category: 'Roth Conversion',
        flag: false,
        flagColor: null,
      });

      if (!segmentResult.activitiesAdded.has(conversion.sourceAccountId)) {
        segmentResult.activitiesAdded.set(conversion.sourceAccountId, []);
      }
      segmentResult.activitiesAdded.get(conversion.sourceAccountId)?.push(transferActivity);

      // Also add the activity to the destination account so it shows up there
      if (!segmentResult.activitiesAdded.has(conversion.destinationAccountId)) {
        segmentResult.activitiesAdded.set(conversion.destinationAccountId, []);
      }
      segmentResult.activitiesAdded.get(conversion.destinationAccountId)?.push(
        new ConsolidatedActivity({
          id: `ROTH-CONVERSION-${conversion.destinationAccountId}-${conversion.sourceAccountId}-${event.year}`,
          name: `Roth Conversion: ${sourceAccount.name} → ${destAccount.name}`,
          amount: conversion.amount,
          amountIsVariable: false,
          amountVariable: null,
          date: formatDate(new Date(event.year, 11, 31)),
          dateIsVariable: false,
          dateVariable: null,
          from: sourceAccount.name,
          to: destAccount.name,
          isTransfer: true,
          category: 'Roth Conversion',
          flag: false,
          flagColor: null,
        }),
      );

      // Track balance changes for the segment processor to apply
      const srcChange = segmentResult.balanceChanges.get(conversion.sourceAccountId) || 0;
      segmentResult.balanceChanges.set(conversion.sourceAccountId, srcChange - conversion.amount);

      const destChange = segmentResult.balanceChanges.get(conversion.destinationAccountId) || 0;
      segmentResult.balanceChanges.set(conversion.destinationAccountId, destChange + conversion.amount);
    }

    // Return the combined balance changes from all conversions
    const balanceChanges = new Map<string, number>();
    for (const conversion of conversions) {
      const srcCurrent = balanceChanges.get(conversion.sourceAccountId) || 0;
      balanceChanges.set(conversion.sourceAccountId, srcCurrent - conversion.amount);

      const destCurrent = balanceChanges.get(conversion.destinationAccountId) || 0;
      balanceChanges.set(conversion.destinationAccountId, destCurrent + conversion.amount);
    }
    return balanceChanges;
  }

  processSpendingTrackerEvent(event: SpendingTrackerEvent, segmentResult: SegmentResult): Map<string, number> {
    this.log('spending-tracker-processed', { categoryId: event.categoryId, amount: 0 });
    // 1. Get accumulated spending from manager
    let totalSpent = this.spendingTrackerManager.getPeriodSpending(event.categoryId);

    // 2. Scan current segment's activitiesAdded for matching spending category activities
    //    that fall within the period [periodStart, periodEnd]. These haven't been recorded
    //    by recordSegmentActivities yet.
    const periodStartDayjs = dayjs.utc(event.periodStart);
    const periodEndDayjs = dayjs.utc(event.periodEnd);

    for (const [, activities] of segmentResult.activitiesAdded) {
      for (const activity of activities) {
        if (activity.spendingCategory !== event.categoryId) continue;
        const amount = typeof activity.amount === 'number' ? activity.amount : 0;
        if (amount === 0) continue;

        const activityDateDayjs = dayjs.utc(activity.date);

        const afterStart =
          activityDateDayjs.isAfter(periodStartDayjs, 'day') || activityDateDayjs.isSame(periodStartDayjs, 'day');
        const beforeEnd = activityDateDayjs.isBefore(periodEndDayjs, 'day') ||
          activityDateDayjs.isSame(periodEndDayjs, 'day');

        if (afterStart && beforeEnd) {
          // Negative amounts (expenses) add to spending; positive amounts (refunds) reduce it.
          // totalSpent CAN go negative when refunds exceed expenses. Negative totalSpent
          // means the effective budget increases (refunds add to remaining budget).
          totalSpent -= amount;
        }
      }
    }

    // 2b. Skip carry tracking and remainder generation for periods before initializeDate.
    //     These periods are completely invisible to the spending tracker.
    if (this.spendingTrackerManager.isBeforeInitializeDate(event.categoryId, event.periodEnd)) {
      this.spendingTrackerManager.resetPeriodSpending(event.categoryId);
      this.spendingTrackerManager.markPeriodProcessed(event.categoryId, event.periodEnd);
      return new Map();
    }

    // 3. Check if this is a future period with no spending.
    //    Future periods with $0 spending should not accumulate carry — the budget
    //    effectively resets to the base threshold each period. Without this guard,
    //    every future period would generate carry of +baseThreshold (baseThreshold - 0),
    //    causing the remainder to grow infinitely ($150→$300→$450...).
    const isFuturePeriod = dayjs.utc(event.periodStart).isAfter(dayjs.utc(), 'day');
    const isFutureWithNoSpending = isFuturePeriod && totalSpent === 0;

    // 3b. Compute remainder
    let remainder: number;
    if (isFutureWithNoSpending) {
      // Future periods: use effectiveThreshold if carrying debt, baseThreshold otherwise
      const { baseThreshold, effectiveThreshold } = this.spendingTrackerManager.getEffectiveThreshold(event.categoryId, event.date);
      const currentCarry = this.spendingTrackerManager.getCarryBalance(event.categoryId);
      remainder = currentCarry < 0 ? effectiveThreshold : baseThreshold;
    } else {
      remainder = this.spendingTrackerManager.computeRemainder(event.categoryId, totalSpent, event.date);
    }

    // 4. Update carry, reset period spending, and mark period as processed
    //    (these must happen regardless of remainder amount or virtual status)
    //    For future periods with no spending, skip carry update to prevent infinite accumulation.
    if (isFutureWithNoSpending) {
      const currentCarry = this.spendingTrackerManager.getCarryBalance(event.categoryId);
      if (currentCarry < 0) {
        // Pay off debt: this period's base threshold absorbs some/all of the negative carry
        const { baseThreshold: bt } = this.spendingTrackerManager.getEffectiveThreshold(event.categoryId, event.date);
        const newCarry = currentCarry + bt;
        // If fully paid off (now positive), reset to 0 — surplus doesn't accumulate in future
        this.spendingTrackerManager.setCarryBalance(event.categoryId, newCarry >= 0 ? 0 : newCarry);
      } else {
        // Positive carry (surplus) resets each future period
        this.spendingTrackerManager.setCarryBalance(event.categoryId, 0);
      }
    } else {
      this.spendingTrackerManager.updateCarry(event.categoryId, totalSpent, event.date);
    }
    this.spendingTrackerManager.resetPeriodSpending(event.categoryId);
    this.spendingTrackerManager.markPeriodProcessed(event.categoryId, event.periodEnd);

    // 4b. Record spending tracker update for cache replay
    //     For future periods with no spending, record totalSpent = baseThreshold so
    //     carry delta is zero during replay (baseThreshold - baseThreshold = 0).
    const replayTotalSpent = isFutureWithNoSpending
      ? this.spendingTrackerManager.getEffectiveThreshold(event.categoryId, event.date).baseThreshold
      : totalSpent;
    segmentResult.spendingTrackerUpdates.push({
      categoryId: event.categoryId,
      totalSpent: replayTotalSpent,
      date: event.date,
      periodEnd: event.periodEnd,
      carryAfter: this.spendingTrackerManager.getCarryBalance(event.categoryId),
    });

    // 5. Virtual events process carry but don't create remainder activities.
    //    Carry accumulates normally (including positive carry from real spending),
    //    but no Budget Remainder bill is created until after startDate.
    //    The hasHadActivity guard in updateCarry() prevents phantom surplus from
    //    virtual periods with zero spending.
    if (event.virtual) {
      return new Map();
    }

    // 6. Skip activity creation for zero remainder (consistent with other event processors)
    if (remainder <= 0) {
      return new Map();
    }

    // 7. Create remainder activity
    const remainderActivity = new ConsolidatedActivity(
      {
        id: `SPENDING-TRACKER-${event.categoryId}-${formatDate(event.periodEnd)}`,
        date: formatDate(event.date),
        dateIsVariable: false,
        dateVariable: null,
        name: `${event.categoryName} Budget Remainder`,
        category: `Spending Tracker.${event.categoryName}`,
        amount: -remainder,
        amountIsVariable: false,
        amountVariable: null,
        flag: true,
        flagColor: 'teal',
        isTransfer: false,
        from: null,
        to: null,
        spendingCategory: null, // Prevents circular counting
      },
      { spendingTrackerId: event.categoryId, firstSpendingTracker: event.firstSpendingTracker },
    );

    // 8. Add to segmentResult
    if (!segmentResult.activitiesAdded.has(event.accountId)) {
      segmentResult.activitiesAdded.set(event.accountId, []);
    }
    segmentResult.activitiesAdded.get(event.accountId)?.push(remainderActivity);

    // 9. Update balance
    const currentChange = segmentResult.balanceChanges.get(event.accountId) || 0;
    segmentResult.balanceChanges.set(event.accountId, currentChange + (-remainder));

    // Record spending tracker expense flow
    if (this.flowAggregator && remainder > 0) {
      this.flowAggregator.recordExpense(event.date.getUTCFullYear(), event.categoryName, remainder);
    }

    return new Map([[event.accountId, -remainder]]);
  }

  /***************************************
   * HELPER FUNCTIONS
   ***************************************/

  private getCurrentAccountBalance(accountId: string, segmentResult: SegmentResult): number {
    // Get the account's starting balance from the balance tracker
    const startingBalance = this.balanceTracker.getAccountBalance(accountId) || 0;

    // Add any balance changes accumulated during this segment
    const balanceChanges = segmentResult.balanceChanges.get(accountId) || 0;

    return startingBalance + balanceChanges;
  }

  private calculateInterestAmount(balance: number, annualRate: number, frequency: string): number {
    if (balance === 0 || annualRate === 0) return 0;

    // Convert annual rate to period rate based on frequency
    let periodsPerYear = 1;

    // Add defensive check for undefined frequency
    if (!frequency || typeof frequency !== 'string') {
      frequency = 'month'; // Default to monthly
    }

    switch (frequency.toLowerCase()) {
      case 'day':
      case 'daily':
        periodsPerYear = 365;
        break;
      case 'week':
      case 'weekly':
        periodsPerYear = 52;
        break;
      case 'month':
      case 'monthly':
        periodsPerYear = 12;
        break;
      case 'quarter':
      case 'quarterly':
        periodsPerYear = 4;
        break;
      case 'year':
      case 'yearly':
        periodsPerYear = 1;
        break;
      default:
        // Try to parse as number (e.g., "6 months" -> 2 periods per year)
        const match = frequency.match(/(\d+)\s*(month|day|week|year|quarter)/) as RegExpMatchArray | null;
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];

          switch (unit) {
            case 'day':
              periodsPerYear = 365 / amount;
              break;
            case 'week':
              periodsPerYear = 52 / amount;
              break;
            case 'quarter':
              periodsPerYear = 4 / amount;
              break;
            case 'month':
              periodsPerYear = 12 / amount;
              break;
            case 'year':
              periodsPerYear = 1 / amount;
              break;
          }
        }
    }

    const periodRate = periodsPerYear === 1
      ? annualRate
      : Math.pow(1 + annualRate, 1 / periodsPerYear) - 1;
    const interest = balance * periodRate;

    // Return raw calculation without rounding to match original behavior exactly
    return interest;
  }

  /**
   * Apply contribution limits to a bill transfer amount.
   * Caps the contribution at the remaining limit for the account owner's limit type.
   */
  private applyCappedContribution(
    event: BillTransferEvent,
    amount: number | string,
    date: Date,
  ): number | string {
    // Only apply limits to numeric amounts (not variable like {FULL})
    if (typeof amount !== 'number' || amount <= 0) {
      return amount;
    }

    const toAccount = this.balanceTracker.findAccountById(event.toAccountId);
    if (!toAccount || !toAccount.contributionLimitType) {
      return amount;
    }

    // TODO: When paycheck feature is implemented (#36), employer contributions will be
    // tracked separately with proper employer match formulas. For now, we detect
    // employer contributions by name containing "Employer" and skip the 402(g) limit.
    // Employer contributions should be checked against the 415(c) total addition limit
    // ($70,000 in 2025) which includes both employee and employer contributions.
    const isEmployerContribution = event.originalBill.name.toLowerCase().includes('employer');
    if (isEmployerContribution) {
      this.log('employer-contribution-skip-402g', { to: event.toAccountId, amount, billName: event.originalBill.name });
      return amount;
    }

    // Only cap positive contributions (deposits into the account)
    // Negative amounts are withdrawals
    if (amount <= 0) {
      return amount;
    }

    const limitType = toAccount.contributionLimitType as '401k' | 'ira' | 'hsa';
    const year = date.getUTCFullYear();
    const mcRatio = this.getMCLimitChangeRatio(limitType, date);
    const remaining = this.contributionLimitManager.getRemainingLimit(
      toAccount.accountOwnerDOB,
      year,
      limitType,
      mcRatio,
    );

    if (remaining === Infinity) {
      // No person DOB, can't enforce limits
      return amount;
    }

    const cappedAmount = Math.min(amount, remaining);

    if (cappedAmount < amount) {
      this.log('contribution-capped', { from: event.fromAccountId, to: event.toAccountId, requestedAmount: amount, cappedAmount });
    }

    // Record the contribution
    if (cappedAmount > 0) {
      this.contributionLimitManager.recordContribution(
        toAccount.accountOwnerDOB,
        year,
        limitType,
        cappedAmount,
      );
    }

    return cappedAmount;
  }

  /**
   * Process a Medicare premium event (monthly Part B, Part D, Medigap premiums + IRMAA)
   */
  processMedicarePremiumEvent(event: MedicarePremiumEvent, segmentResult: SegmentResult): Map<string, number> {
    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager && this.mortalityManager.isDeceased(event.personName)) {
      this.log('medicare-premium-skipped-deceased', { person: event.personName });
      return new Map();
    }

    const accountId = event.accountId;
    const year = event.year;

    // Get MAGI from 2 years prior for IRMAA calculation (IRS rule)
    // Use all taxable occurrences from that year to compute MAGI
    const magiYear = year - 2;
    const priorOccurrences = this.taxManager.getAllOccurrencesForYear(magiYear);
    const magi = priorOccurrences.reduce((sum, occ) => sum + occ.amount, 0);

    // Map FilingStatus to Medicare filing status (convert mfs/hoh to single)
    const dynamicMedicareFilingStatus = this.mortalityManager?.getFilingStatus(event.date) ?? this.filingStatus;
    const medicareFilingStatus = (dynamicMedicareFilingStatus === 'mfj') ? 'mfj' : 'single';

    // Get monthly Medicare cost including IRMAA surcharge
    const monthlyMedicareCost = this.medicareManager.getMonthlyMedicareCost(
      event.ownerAge,
      magi,
      medicareFilingStatus,
      year,
    );

    this.log('medicare-premium-processed', { person: event.personName, totalCost: monthlyMedicareCost, accountId });

    // Record Medicare healthcare flow
    if (this.flowAggregator && monthlyMedicareCost > 0) {
      this.flowAggregator.recordHealthcare(year, 'medicare', monthlyMedicareCost);
    }

    // Find the paying account
    const payingAccount = this.balanceTracker.findAccountById(accountId);
    if (!payingAccount) {
      return new Map();
    }

    // Create activity for Medicare premium
    const medicareActivity = new ConsolidatedActivity({
      id: `MEDICARE-${event.personName}-${formatDate(event.date)}`,
      name: `Medicare Premium (${event.personName})`,
      amount: -monthlyMedicareCost,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Healthcare.Medicare',
      flag: true,
      flagColor: 'orange',
    });

    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(medicareActivity);

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange - monthlyMedicareCost);

    return new Map([[accountId, -monthlyMedicareCost]]);
  }

  /**
   * Process a Medicare hospital admission event (annual check for Poisson-distributed admissions)
   */
  processMedicareHospitalEvent(event: MedicareHospitalEvent, segmentResult: SegmentResult): Map<string, number> {
    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager && this.mortalityManager.isDeceased(event.personName)) {
      this.log('medicare-hospital-skipped-deceased', { person: event.personName });
      return new Map();
    }

    const accountId = event.accountId;
    const year = event.year;

    // For now, use expected value (no random function in deterministic mode)
    // In future, can integrate MC random via segment processor
    const numAdmissions = this.medicareManager.generateHospitalAdmissions(event.ownerAge, year);

    if (numAdmissions === 0) {
      return new Map();
    }

    // Find the paying account
    const payingAccount = this.balanceTracker.findAccountById(accountId);
    if (!payingAccount) {
      return new Map();
    }

    let totalHospitalCost = 0;

    // For each admission, calculate cost (Part A deductible + copays)
    for (let i = 0; i < numAdmissions; i++) {
      const partADeductible = this.medicareManager.getPartADeductible(year);
      totalHospitalCost += partADeductible;
      // Assume average 3-day hospital stay with copay
      totalHospitalCost += 400; // Average copay per day
    }

    // Record hospital healthcare flow
    if (this.flowAggregator && totalHospitalCost > 0) {
      this.flowAggregator.recordHealthcare(year, 'hospital', totalHospitalCost);
    }

    // Create activity for hospital expenses
    const hospitalActivity = new ConsolidatedActivity({
      id: `HOSPITAL-${event.personName}-${formatDate(event.date)}`,
      name: `Hospital Admissions (${event.personName}) x${numAdmissions}`,
      amount: -totalHospitalCost,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Healthcare.Hospital',
      flag: true,
      flagColor: 'red',
    });

    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(hospitalActivity);

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange - totalHospitalCost);

    return new Map([[accountId, -totalHospitalCost]]);
  }

  /**
   * Process an ACA/COBRA premium event
   */
  processAcaPremiumEvent(event: AcaPremiumEvent, segmentResult: SegmentResult): Map<string, number> {
    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager && this.mortalityManager.isDeceased(event.personName)) {
      this.log('aca-premium-skipped-deceased', { person: event.personName });
      return new Map();
    }

    const accountId = event.accountId;
    const year = event.year;

    // Get MAGI from prior year (ACA uses prior-year income for subsidy calculation)
    const priorYearOccurrences = this.taxManager.getAllOccurrencesForYear(year - 1);
    let priorMAGI = 0;
    for (const occ of priorYearOccurrences) {
      if (occ.incomeType !== 'penalty') {
        priorMAGI += occ.amount;
      }
    }

    // Calculate both persons' ages from their birth dates
    const age1 = dayjs.utc(event.date).diff(event.birthDate1, 'year');
    const age2 = dayjs.utc(event.date).diff(event.birthDate2, 'year');

    // Get monthly ACA/COBRA premium (household size = number of alive people)
    const householdSize = this.mortalityManager?.getAlivePeople().length ?? 2;

    // Try to get plan-level monthlyPremium from healthcare config for COBRA calculation
    let basePremiumOverride: number | undefined;
    let policyholderDeathDate: Date | null | undefined;
    if (event.isCobraPeriod) {
      const config = this.healthcareManager.getActiveConfig(event.personName, event.date);
      if (config?.monthlyPremium) {
        basePremiumOverride = config.monthlyPremium;
      }
      // Check if policyholder is deceased (death-triggered COBRA)
      if (config?.policyholder && this.mortalityManager?.isDeceased(config.policyholder)) {
        policyholderDeathDate = this.mortalityManager.getDeathDate(config.policyholder);
      }
    }

    const monthlyPremium = this.acaManager.getMonthlyHealthcarePremium(
      event.retirementDate,
      event.date,
      age1,
      age2,
      priorMAGI,
      householdSize,
      year,
      basePremiumOverride,
      policyholderDeathDate,
    );

    this.log('aca-premium-processed', { person: event.personName, monthlyPremium, priorMAGI, isCobraPeriod: event.isCobraPeriod });

    // Record ACA/COBRA healthcare flow
    if (this.flowAggregator && monthlyPremium > 0) {
      this.flowAggregator.recordHealthcare(year, event.isCobraPeriod ? 'cobra' : 'aca', monthlyPremium);
    }

    // Find the paying account
    const payingAccount = this.balanceTracker.findAccountById(accountId);
    if (!payingAccount) {
      return new Map();
    }

    // Create activity for ACA/COBRA premium
    const premiumName = event.isCobraPeriod ? 'COBRA Premium' : 'ACA Silver Premium';
    const categoryName = event.isCobraPeriod ? 'Healthcare.COBRA' : 'Healthcare.ACA';
    const flagColor = event.isCobraPeriod ? 'orange' : 'cyan';

    const acaActivity = new ConsolidatedActivity({
      id: `ACA-${event.personName}-${formatDate(event.date)}`,
      name: premiumName,
      amount: -monthlyPremium,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: categoryName,
      flag: true,
      flagColor: flagColor,
    });

    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(acaActivity);

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange - monthlyPremium);

    return new Map([[accountId, -monthlyPremium]]);
  }

  /**
   * Process an LTC check event (monthly Markov chain transition and cost)
   */
  processLTCCheckEvent(event: LTCCheckEvent, segmentResult: SegmentResult): Map<string, number> {
    const accountId = event.accountId;
    const personName = event.personName;

    // Mortality cessation check — skip if person is deceased
    if (this.mortalityManager && this.mortalityManager.isDeceased(personName)) {
      this.log('ltc-check-skipped-deceased', { person: personName });
      return new Map();
    }

    // Get the config for this person
    const config = this.mortalityManager.getConfig(personName);
    if (!config) {
      return new Map();
    }

    // Get the seeded random function from MC handler (for reproducibility)
    // In deterministic mode, fall back to expected cost calculation
    const random = this.monteCarloConfig?.handler?.random ?
      () => this.monteCarloConfig.handler.random() :
      null;

    // Markov chain only steps when age >= 65
    // Before that, only premiums are charged (if applicable)
    if (event.ownerAge >= 65 && random) {
      const wasDeceased = this.mortalityManager.isDeceased(personName);
      this.mortalityManager.stepMonth(personName, event.ownerAge, event.gender, event.monthIndex, random);
      if (!wasDeceased && this.mortalityManager.isDeceased(personName)) {
        const deathDate = this.mortalityManager.getDeathDate(personName);
        if (deathDate && this.lifeInsuranceManager) {
          this.lifeInsuranceManager.evaluateDeath(personName, deathDate);
        }
      }
    }

    // Get the birth year from the birth date
    const birthYear = event.birthDate.getUTCFullYear();

    // Calculate net monthly cost (gross - insurance benefit)
    // Only charge LTC costs if age >= 65
    let netMonthlyCost = 0;
    if (event.ownerAge >= 65) {
      if (random) {
        // MC mode: use actual state cost from Markov chain
        netMonthlyCost = this.mortalityManager.getNetMonthlyCost(personName, event.year, birthYear);
      } else {
        // Deterministic mode: use actuarially expected cost (no state transitions)
        netMonthlyCost = this.mortalityManager.getExpectedMonthlyCost(event.ownerAge, event.gender, event.year);
      }
    }

    this.log('ltc-check-processed', { person: personName, netCost: netMonthlyCost, accountId });

    // Record LTC care cost flow
    if (this.flowAggregator && netMonthlyCost > 0) {
      this.flowAggregator.recordHealthcare(event.year, 'ltcCare', netMonthlyCost);
    }

    // Find the paying account
    const payingAccount = this.balanceTracker.findAccountById(accountId);
    if (!payingAccount) {
      return new Map();
    }

    // Create activity for LTC expense only if age >= 65 and cost > 0
    if (event.ownerAge >= 65 && netMonthlyCost > 0) {
      // Get current LTC state to determine the type of care
      const state = this.mortalityManager.getPersonState(personName);
      if (!state) {
        return new Map();
      }

      // Map state to description
      const stateDescription = state.currentState === 'homeCare' ? 'Home Care'
        : state.currentState === 'assistedLiving' ? 'Assisted Living'
        : state.currentState === 'nursingHome' ? 'Nursing Home'
        : 'Long-Term Care';

      // Create activity for LTC expense
      const ltcActivity = new ConsolidatedActivity({
        id: `LTC-${personName}-${formatDate(event.date)}-${state.currentState}`,
        name: `LTC: ${stateDescription} (${personName})`,
        amount: -netMonthlyCost,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(event.date),
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        isTransfer: false,
        category: `Healthcare.LTC.${state.currentState}`,
        flag: true,
        flagColor: 'red',
      });

      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId)?.push(ltcActivity);

      // Update balance for LTC cost
      const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, currentChange - netMonthlyCost);
    }

    // Handle LTC insurance premium on January events (annual, once per person)
    if (event.date.getUTCMonth() === 0 && config.hasInsurance && event.ownerAge >= (config.insurancePurchaseAge ?? 60)) {
      const yearsSincePurchase = event.ownerAge - (config.insurancePurchaseAge ?? 60);
      const premiumInflationRate = config.premiumInflationRate ?? 0.05;
      // LTC insurance premium inflation is contractually fixed by the insurer — not MC-sampled.
      const annualPremium = (config.annualPremium ?? 3500) * Math.pow(1 + premiumInflationRate, yearsSincePurchase);

      // Record LTC insurance premium flow
      if (this.flowAggregator && annualPremium > 0) {
        this.flowAggregator.recordHealthcare(event.year, 'ltcInsurance', annualPremium);
      }

      const premiumActivity = new ConsolidatedActivity({
        id: `LTC-PREMIUM-${personName}-${event.year}`,
        name: `LTC Insurance Premium (${personName})`,
        amount: -annualPremium,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(event.date),
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        isTransfer: false,
        category: 'Insurance.LTC',
        flag: true,
        flagColor: 'violet',
      });

      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId)?.push(premiumActivity);

      // Update balance for premium
      const premiumChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, premiumChange - annualPremium);
    }

    return new Map([[accountId, -netMonthlyCost]]);
  }

}
