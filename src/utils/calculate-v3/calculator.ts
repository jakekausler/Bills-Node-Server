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
import { LTCManager } from './ltc-manager';
import { AcaManager } from './aca-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import { ContributionLimitManager } from './contribution-limit-manager';
import { RothConversionManager } from './roth-conversion-manager';
import { loadVariable } from '../simulation/variable';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ActivityEvent,
  ActivityTransferEvent,
  BillEvent,
  BillTransferEvent,
  FilingStatus,
  IncomeType,
  InterestEvent,
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

dayjs.extend(utc);

export class Calculator {
  private balanceTracker: BalanceTracker;
  private simulation: string;
  private taxManager: TaxManager;
  private retirementManager: RetirementManager;
  private accountManager: AccountManager;
  private healthcareManager: HealthcareManager;
  private medicareManager: MedicareManager;
  private ltcManager: LTCManager;
  private acaManager: AcaManager;
  private spendingTrackerManager: SpendingTrackerManager;
  private contributionLimitManager: ContributionLimitManager;
  private rothConversionManager: RothConversionManager;
  private filingStatus: FilingStatus;
  private bracketInflationRate: number;
  protected monteCarloConfig: any; // From parent, for PRNG access

  constructor(
    balanceTracker: BalanceTracker,
    taxManager: TaxManager,
    retirementManager: RetirementManager,
    healthcareManager: HealthcareManager,
    medicareManager: MedicareManager,
    ltcManager: LTCManager,
    accountManager: AccountManager,
    simulation: string,
    spendingTrackerManager: SpendingTrackerManager,
    acaManager: AcaManager,
    filingStatus: FilingStatus = 'mfj',
    bracketInflationRate: number = 0.03,
  ) {
    this.balanceTracker = balanceTracker;
    this.taxManager = taxManager;
    this.retirementManager = retirementManager;
    this.healthcareManager = healthcareManager;
    this.medicareManager = medicareManager;
    this.ltcManager = ltcManager;
    this.acaManager = acaManager;
    this.simulation = simulation;
    this.accountManager = accountManager;
    this.spendingTrackerManager = spendingTrackerManager;
    this.filingStatus = filingStatus;
    this.bracketInflationRate = bracketInflationRate;
    this.contributionLimitManager = new ContributionLimitManager();
    this.rothConversionManager = new RothConversionManager(accountManager, acaManager);
    this.rothConversionManager.setBalanceTracker(balanceTracker);
  }

  /**
   * Set Monte Carlo configuration (for accessing seeded PRNG)
   */
  setMonteCarloConfig(config: any): void {
    this.monteCarloConfig = config;
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

    // Update balance in segment result
    const balanceChange = activity.amount as number;
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + balanceChange);
    return new Map([[accountId, balanceChange]]);
  }

  /**
   * Process a healthcare activity event
   */
  private processHealthcareActivity(event: ActivityEvent, segmentResult: SegmentResult): Map<string, number> {
    const activity = event.originalActivity;
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
      console.error('[HSA Reimbursement] ERROR:', error);
      throw error; // Re-throw to propagate the error
    }
  }

  processBillEvent(event: BillEvent, segmentResult: SegmentResult, simulation: string): Map<string, number> {
    const bill = event.originalBill;

    // Route healthcare bills to healthcare processor
    if (bill.isHealthcare) {
      return this.processHealthcareBill(event, segmentResult, simulation);
    }

    const accountId = event.accountId;
    let amount = event.amount;

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

    // Calculate patient cost
    const patientCost = this.healthcareManager.calculatePatientCost(bill, config, event.date);

    // Create consolidated activity for the bill
    const billActivity = new ConsolidatedActivity(
      bill.toActivity(`${bill.id}-${event.date}`, simulation, -patientCost, event.date).serialize(),
      { billId: bill.id, firstBill: event.firstBill },
    );

    if (!segmentResult.activitiesAdded.has(event.accountId)) {
      segmentResult.activitiesAdded.set(event.accountId, []);
    }
    segmentResult.activitiesAdded.get(event.accountId)?.push(billActivity);

    // Generate HSA reimbursement if enabled
    if (config.hsaReimbursementEnabled && config.hsaAccountId) {
      this.generateHSAReimbursement(config.hsaAccountId, event.accountId, patientCost, event.date, segmentResult, bill.name);
    }

    // Update balance
    const currentChange = segmentResult.balanceChanges.get(event.accountId) || 0;
    segmentResult.balanceChanges.set(event.accountId, currentChange - patientCost);

    return new Map([[event.accountId, -patientCost]]);
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
    if (currentBalance > 0) {
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
    // Recalculate bill amount with Monte Carlo sampling or deterministic increases if configured
    let amount = event.amount;
    const bill = event.originalBill;

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
        internalAmount = Math.min(Math.abs(internalAmount), maxTransfer);
        internalAmount = internalAmount > 0 ? internalAmount : 0; // Ensure non-negative
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

    return new Map([
      [fromAccountId, -internalAmount],
      [toAccountId, internalAmount],
    ]);
  }

  processPensionEvent(event: PensionEvent, segmentResult: SegmentResult): Map<string, number> {
    const pension = event.pension;
    const accountId = event.accountId;
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
    if (!segmentResult.taxableOccurrences.has(accountId)) {
      segmentResult.taxableOccurrences.set(accountId, []);
    }
    segmentResult.taxableOccurrences.get(accountId)?.push({
      date: event.date,
      year: event.date.getUTCFullYear(),
      amount: paymentAmount,
      incomeType: 'ordinary' as IncomeType,
    });

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
    return new Map([[accountId, Number(amount)]]);
  }

  processSocialSecurityEvent(event: SocialSecurityEvent, segmentResult: SegmentResult): Map<string, number> {
    const socialSecurity = event.socialSecurity;
    const accountId = event.accountId;
    if (event.firstPayment) {
      this.retirementManager.calculateSocialSecurityMonthlyPay(socialSecurity);
      this.retirementManager.setSocialSecurityFirstPaymentYear(socialSecurity.name, event.date.getUTCFullYear());
    }
    let amount = this.retirementManager.getSocialSecurityMonthlyPay(socialSecurity.name);

    // Apply COLA if configured
    const firstPaymentYear = this.retirementManager.getSocialSecurityFirstPaymentYear(socialSecurity.name);
    if (firstPaymentYear !== null && socialSecurity.colaVariable) {
      const currentYear = event.date.getUTCFullYear();
      const yearsCollecting = currentYear - firstPaymentYear;

      if (yearsCollecting > 0) {
        const colaRate = (loadVariable(socialSecurity.colaVariable, this.simulation) as number) || 0;
        const colaMultiplier = Math.pow(1 + colaRate, yearsCollecting);
        amount = amount * colaMultiplier;
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
    if (!segmentResult.taxableOccurrences.has(accountId)) {
      segmentResult.taxableOccurrences.set(accountId, []);
    }
    segmentResult.taxableOccurrences.get(accountId)?.push({
      date: event.date,
      year: event.date.getUTCFullYear(),
      amount: paymentAmount,
      incomeType: 'socialSecurity' as IncomeType,
    });

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
    return new Map([[accountId, Number(amount)]]);
  }

  processTaxEvent(event: TaxEvent, segmentResult: SegmentResult): Map<string, number> {
    // Get the account for this event
    const account = this.balanceTracker.findAccountById(event.accountId);
    if (!account) {
      throw new Error(`Account ${event.accountId} not found`);
    }
    const accountId = account.id;

    // Calculate the tax amount using progressive brackets
    const amount = -this.taxManager.calculateTotalTaxOwed(
      event.date.getUTCFullYear() - 1,
      this.filingStatus,
      this.bracketInflationRate,
    );
    if (amount === 0) {
      return new Map();
    }

    // Create the tax activity
    const taxActivity = new ConsolidatedActivity({
      id: `TAX-${accountId}-${formatDate(event.date)}`,
      name: 'Auto Calculated Tax',
      amount: amount,
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(event.date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Taxes.Federal',
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
    if (!segmentResult.taxableOccurrences.has(rmdAccount.id)) {
      segmentResult.taxableOccurrences.set(rmdAccount.id, []);
    }
    segmentResult.taxableOccurrences.get(rmdAccount.id)?.push({
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
    // Process Roth conversions for this year
    // This delegates to the RothConversionManager which handles the bracket-filling logic
    // TODO #20: Process conversions and apply to segment result
    this.rothConversionManager.processConversions(
      event.year,
      this.taxManager,
      this.balanceTracker,
      this.filingStatus,
      this.bracketInflationRate,
      this.simulation,
    );

    // For Level 1, Roth conversions don't create activities or balance changes
    // They are tracked internally in the manager for later use in withdrawal logic
    return new Map<string, number>();
  }

  processSpendingTrackerEvent(event: SpendingTrackerEvent, segmentResult: SegmentResult): Map<string, number> {
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

    // Only cap positive contributions (deposits into the account)
    // Negative amounts are withdrawals
    if (amount <= 0) {
      return amount;
    }

    const limitType = toAccount.contributionLimitType as '401k' | 'ira' | 'hsa';
    const year = date.getUTCFullYear();
    const remaining = this.contributionLimitManager.getRemainingLimit(
      toAccount.accountOwnerDOB,
      year,
      limitType,
    );

    if (remaining === Infinity) {
      // No person DOB, can't enforce limits
      return amount;
    }

    const cappedAmount = Math.min(amount, remaining);

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
    const accountId = event.accountId;
    const year = event.year;

    // Get MAGI from 2 years prior for IRMAA calculation (IRS rule)
    // Use all taxable occurrences from that year to compute MAGI
    const magiYear = year - 2;
    const priorOccurrences = this.taxManager.getAllOccurrencesForYear(magiYear);
    const magi = priorOccurrences.reduce((sum, occ) => sum + occ.amount, 0);

    // Map FilingStatus to Medicare filing status (convert mfs/hoh to single)
    const medicareFilingStatus = (this.filingStatus === 'mfj') ? 'mfj' : 'single';

    // Get monthly Medicare cost including IRMAA surcharge
    const monthlyMedicareCost = this.medicareManager.getMonthlyMedicareCost(
      event.ownerAge,
      magi,
      medicareFilingStatus,
      year,
    );

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

    // Get monthly ACA/COBRA premium
    const monthlyPremium = this.acaManager.getMonthlyHealthcarePremium(
      event.retirementDate,
      event.date,
      age1,
      age2,
      priorMAGI,
      2, // household size = 2
      year,
    );

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

    // Get the seeded random function from MC handler (for reproducibility)
    // In deterministic mode, fall back to expected cost calculation
    const random = this.monteCarloConfig?.handler?.random ?
      () => this.monteCarloConfig.handler.random() :
      null;

    // If we have a PRNG, step the Markov chain; otherwise use expected cost
    if (random) {
      this.ltcManager.stepMonth(personName, event.ownerAge, event.gender, event.monthIndex, random);
    }

    // Get the config for this person
    const config = this.ltcManager.getConfig(personName);
    if (!config) {
      return new Map();
    }

    // Get the birth year from the birth date
    const birthYear = event.birthDate.getUTCFullYear();

    // Calculate net monthly cost (gross - insurance benefit)
    const netMonthlyCost = this.ltcManager.getNetMonthlyCost(personName, event.year, birthYear);

    // If cost is zero, no activity needed (healthy or fully covered by insurance)
    if (netMonthlyCost <= 0) {
      return new Map();
    }

    // Find the paying account
    const payingAccount = this.balanceTracker.findAccountById(accountId);
    if (!payingAccount) {
      return new Map();
    }

    // Get current LTC state to determine the type of care
    const state = this.ltcManager.getPersonState(personName);
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

    // Handle LTC insurance premium on January events (annual, once per person)
    if (event.date.getUTCMonth() === 0 && config.hasInsurance && event.ownerAge >= (config.insurancePurchaseAge ?? 60)) {
      const yearsSincePurchase = event.ownerAge - (config.insurancePurchaseAge ?? 60);
      const premiumInflationRate = config.premiumInflationRate ?? 0.05;
      const annualPremium = (config.annualPremium ?? 3500) * Math.pow(1 + premiumInflationRate, yearsSincePurchase);

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
        flagColor: 'purple',
      });

      if (!segmentResult.activitiesAdded.has(accountId)) {
        segmentResult.activitiesAdded.set(accountId, []);
      }
      segmentResult.activitiesAdded.get(accountId)?.push(premiumActivity);

      // Update balance for premium
      const premiumChange = segmentResult.balanceChanges.get(accountId) || 0;
      segmentResult.balanceChanges.set(accountId, premiumChange - annualPremium);
    }

    // Update balance for LTC cost
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange - netMonthlyCost);

    return new Map([[accountId, -netMonthlyCost]]);
  }

}
