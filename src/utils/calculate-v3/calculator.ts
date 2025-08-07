import { Activity } from '../../data/activity/activity';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Bill } from '../../data/bill/bill';
import { formatDate, isBefore } from '../date/date';
import { BalanceTracker } from './balance-tracker';
import { AccountManager } from './account-manager';
import { RetirementManager } from './retirement-manager';
import { TaxManager } from './tax-manager';
import {
  ActivityEvent,
  ActivityTransferEvent,
  BillEvent,
  BillTransferEvent,
  InterestEvent,
  PensionEvent,
  RMDEvent,
  SegmentResult,
  SocialSecurityEvent,
  TaxableOccurence,
  TaxEvent,
} from './types';

export class Calculator {
  private balanceTracker: BalanceTracker;
  private simulation: string;
  private taxManager: TaxManager;
  private retirementManager: RetirementManager;
  private accountManager: AccountManager;
  constructor(
    balanceTracker: BalanceTracker,
    taxManager: TaxManager,
    retirementManager: RetirementManager,
    accountManager: AccountManager,
    simulation: string,
  ) {
    this.balanceTracker = balanceTracker;
    this.taxManager = taxManager;
    this.retirementManager = retirementManager;
    this.simulation = simulation;
    this.accountManager = accountManager;
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

  processBillEvent(event: BillEvent, segmentResult: SegmentResult, simulation: string): Map<string, number> {
    const bill = event.originalBill;
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

  processInterestEvent(event: InterestEvent, segmentResult: SegmentResult): Map<string, number> {
    const interest = event.originalInterest;
    const accountId = event.accountId;
    const account = this.balanceTracker.findAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get the current balance of the account
    const currentBalance = this.getCurrentAccountBalance(accountId, segmentResult);

    // Determine the APR to use (Monte Carlo sample or regular rate)
    let apr = event.rate;

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

    // Add taxable occurence to segment result
    if (account.interestPayAccount && account.interestTaxRate !== 0) {
      const taxableOccurence: TaxableOccurence = {
        date: event.date,
        year: event.date.getFullYear(),
        amount: interestAmount,
        taxRate: account.interestTaxRate,
      };
      if (!segmentResult.taxableOccurences.has(account.interestPayAccount)) {
        segmentResult.taxableOccurences.set(account.interestPayAccount, []);
      }
      segmentResult.taxableOccurences.get(account.interestPayAccount)?.push(taxableOccurence);
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
          internalAmount = Math.min(Math.abs(internalAmount), fromAccountBalance > 0 ? -fromAccountBalance : 0);
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

    // If the activity is an AUTO-PULL or RMD, add a taxable occurence to the segment result
    if (original.id.startsWith('AUTO-PULL') || original.id.startsWith('RMD')) {
      // Handle Withdrawal Tax
      const taxRate = fromAccount?.withdrawalTaxRate ?? 0;
      if (taxRate !== 0) {
        const taxableOccurence: TaxableOccurence = {
          date: fromActivity.date,
          year: fromActivity.date.getFullYear(),
          amount: internalAmount,
          taxRate,
        };
        const taxPayAccount = toAccount?.name;
        if (!taxPayAccount) {
          throw new Error(`Account ${toAccountId} has no name`);
        }
        if (!segmentResult.taxableOccurences.has(taxPayAccount)) {
          segmentResult.taxableOccurences.set(taxPayAccount, []);
        }
        segmentResult.taxableOccurences.get(taxPayAccount)?.push(taxableOccurence);
      }

      // Handle Early Withdrawl Penalty
      const earlyWithdrawlPenalty = fromAccount?.earlyWithdrawlPenalty ?? 0;
      const earlyWithdrawlDate = fromAccount?.earlyWithdrawlDate;
      if (earlyWithdrawlPenalty !== 0 && earlyWithdrawlDate && isBefore(fromActivity.date, earlyWithdrawlDate)) {
        const taxableOccurence: TaxableOccurence = {
          date: fromActivity.date,
          year: fromActivity.date.getFullYear(),
          amount: internalAmount,
          taxRate: earlyWithdrawlPenalty,
        };
        const taxPayAccount = toAccount?.name;
        if (!taxPayAccount) {
          throw new Error(`Account ${toAccountId} has no name`);
        }
        if (!segmentResult.taxableOccurences.has(taxPayAccount)) {
          segmentResult.taxableOccurences.set(taxPayAccount, []);
        }
        segmentResult.taxableOccurences.get(taxPayAccount)?.push(taxableOccurence);
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
      this.retirementManager.calculatePensionMonthlyPay(pension);
    }
    const amount = this.retirementManager.getPensionMonthlyPay(pension.name);

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
    }
    const amount = this.retirementManager.getSocialSecurityMonthlyPay(socialSecurity.name);

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

    // Calculate the tax amount
    const amount = -this.taxManager.calculateTotalTaxOwed(accountId, event.date.getFullYear() - 1);
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

    const periodRate = annualRate / periodsPerYear;
    const interest = balance * periodRate;

    // Return raw calculation without rounding to match original behavior exactly
    return interest;
  }

  // /**
  //  * Calculate bill amount with Monte Carlo sampling for inflation/raise
  //  */
  // private calculateMonteCarloAdjustedBillAmount(
  //   bill: Bill,
  //   currentDate: Date,
  //   segmentKey: string,
  // ): {
  //   amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  //   samples?: Array<{ date: Date; sample: number; previousAmount: number; newAmount: number; yearOffset: number }>;
  // } {
  //   // If the amount is a special value, return it as-is
  //   if (
  //     bill.amount === '{HALF}' ||
  //     bill.amount === '-{HALF}' ||
  //     bill.amount === '{FULL}' ||
  //     bill.amount === '-{FULL}'
  //   ) {
  //     return { amount: bill.amount };
  //   }

  //   const sampleType = bill.monteCarloSampleType as MonteCarloSampleType;
  //   if (!this.monteCarloConfig?.handler) {
  //     throw new Error('Monte Carlo handler not available');
  //   }

  //   // Get the base amount
  //   let amount = bill.amount;

  //   // Apply ceilingMultiple if configured
  //   if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
  //     amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
  //   }

  //   // Calculate years of increases
  //   const yearsDiff = this.yearIncreases(bill.startDate, currentDate, bill.increaseByDate);
  //   const samples: Array<{
  //     date: Date;
  //     sample: number;
  //     previousAmount: number;
  //     newAmount: number;
  //     yearOffset: number;
  //   }> = [];

  //   // Apply Monte Carlo sampled inflation/raise for each year
  //   for (let i = 0; i < yearsDiff; i++) {
  //     const yearDate = new Date(bill.startDate);
  //     yearDate.setFullYear(yearDate.getFullYear() + i);

  //     const previousAmount = amount;

  //     // Get the sample for this specific year
  //     const sample = this.monteCarloConfig.handler.getSample(
  //       sampleType,
  //       yearDate,
  //       segmentKey,
  //       this.monteCarloConfig.simulationNumber,
  //     );
  //     amount *= 1 + sample;

  //     // Apply ceilingMultiple after each increase if configured
  //     if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
  //       amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
  //     }

  //     // Store sample information for logging
  //     samples.push({
  //       date: yearDate,
  //       sample,
  //       previousAmount,
  //       newAmount: amount,
  //       yearOffset: i,
  //     });
  //   }

  //   return { amount, samples };
  // }

  // /**
  //  * Calculate bill amount with deterministic increases and track details for logging
  //  */
  // private calculateDeterministicBillAmount(
  //   bill: Bill,
  //   currentDate: Date,
  // ): {
  //   amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  //   increases?: Array<{
  //     date: Date;
  //     increaseRate: number;
  //     previousAmount: number;
  //     newAmount: number;
  //     yearOffset: number;
  //   }>;
  // } {
  //   // If the amount is a special value, return it as-is
  //   if (
  //     bill.amount === '{HALF}' ||
  //     bill.amount === '-{HALF}' ||
  //     bill.amount === '{FULL}' ||
  //     bill.amount === '-{FULL}'
  //   ) {
  //     return { amount: bill.amount };
  //   }

  //   // Get the base amount
  //   let amount = bill.amount;

  //   // Apply ceilingMultiple if configured
  //   if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
  //     amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
  //   }

  //   // Calculate years of increases
  //   const yearsDiff = this.yearIncreases(bill.startDate, currentDate, bill.increaseByDate);
  //   const increases: Array<{
  //     date: Date;
  //     increaseRate: number;
  //     previousAmount: number;
  //     newAmount: number;
  //     yearOffset: number;
  //   }> = [];

  //   // Apply deterministic inflation/raise for each year
  //   for (let i = 0; i < yearsDiff; i++) {
  //     const yearDate = new Date(bill.startDate);
  //     yearDate.setFullYear(yearDate.getFullYear() + i);

  //     const previousAmount = amount;
  //     const increaseRate = bill.increaseBy / 100; // Convert percentage to decimal

  //     amount *= 1 + increaseRate;

  //     // Apply ceilingMultiple after each increase if configured
  //     if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
  //       amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
  //     }

  //     // Store increase information for logging
  //     increases.push({
  //       date: yearDate,
  //       increaseRate,
  //       previousAmount,
  //       newAmount: amount,
  //       yearOffset: i,
  //     });
  //   }

  //   return { amount, increases };
  // }

  // /**
  //  * Calculate the number of year increases between two dates
  //  * This is a helper method to match the logic from timeline.ts
  //  */
  // private yearIncreases(startDate: Date, currentDate: Date, increaseByDate: { day: number; month: number }): number {
  //   let count = 0;

  //   // Start from the first possible increase date after startDate
  //   const startYear = startDate.getFullYear();

  //   // End at the last possible increase date before currentDate
  //   const endYear = currentDate.getFullYear();

  //   // Count the number of years between startDate and currentDate that have the increase date
  //   for (let year = startYear; year <= endYear; year++) {
  //     const milestone = new Date(year, increaseByDate.month, increaseByDate.day);
  //     if (milestone >= startDate && milestone <= currentDate) {
  //       count++;
  //     }
  //   }

  //   return count;
  // }
}
