import { Activity } from '../../data/activity/activity';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Bill } from '../../data/bill/bill';
import { formatDate } from '../date/date';
import { BalanceTracker } from './balance-tracker';
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
  TaxEvent,
} from './types';

export class Calculator {
  private balanceTracker: BalanceTracker;
  private simulation: string;
  private taxManager: TaxManager;
  private retirementManager: RetirementManager;

  constructor(
    balanceTracker: BalanceTracker,
    taxManager: TaxManager,
    retirementManager: RetirementManager,
    simulation: string,
  ) {
    this.balanceTracker = balanceTracker;
    this.taxManager = taxManager;
    this.retirementManager = retirementManager;
    this.simulation = simulation;
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
    const amount = event.amount;

    // Create consolidated activity for the bill
    const billActivity = new ConsolidatedActivity(
      bill.toActivity(bill.id, simulation, amount, event.date).serialize(),
      { billId: bill.id, firstBill: event.firstBill },
    );

    segmentResult.activitiesAdded.get(accountId)?.push(billActivity);

    // Update balance in segment result
    const currentChange = segmentResult.balanceChanges.get(accountId) || 0;
    segmentResult.balanceChanges.set(accountId, currentChange + Number(amount));
    return new Map([[accountId, Number(amount)]]);
  }

  processInterestEvent(event: InterestEvent, segmentResult: SegmentResult): Map<string, number> {
    const interest = event.originalInterest;
    const accountId = event.accountId;

    // Get the current balance of the account
    const currentBalance = this.getCurrentAccountBalance(accountId, segmentResult);

    // Calculate the interest amount
    const interestAmount = this.calculateInterestAmount(currentBalance, event.rate, interest.compounded);

    // Only create activities for non-zero amounts (filter out zeros and floating-point noise)
    if (Math.abs(interestAmount) <= 0.001) {
      return new Map();
    }

    // Create consolidated activity for the interest
    const interestActivity = new ConsolidatedActivity(
      interest.toActivity(interest.id, this.simulation, interestAmount, event.date).serialize(),
      { interestId: interest.id, firstInterest: event.firstInterest },
    );

    // Add activity to segment result
    if (!segmentResult.activitiesAdded.has(accountId)) {
      segmentResult.activitiesAdded.set(accountId, []);
    }
    segmentResult.activitiesAdded.get(accountId)?.push(interestActivity);

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
    return this.processTransferEvent(event, event.originalBill, event.amount, event.firstBill, segmentResult);
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
        ? original
            .toActivity(
              `TRANSFER-${original.id}-${event.date.getTime()}-FROM`,
              this.simulation,
              -internalAmount,
              event.date,
            )
            .serialize()
        : {
            id: `TRANSFER-${original.id}-${event.date.getTime()}-FROM`,
            name: original.name, // Use the original transfer name
            amount: -internalAmount,
            amountIsVariable: original.amountIsVariable || false,
            amountVariable: original.amountVariable || null,
            date: formatDate(event.date),
            dateIsVariable: false,
            dateVariable: null,
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
        ? original
            .toActivity(
              `TRANSFER-${original.id}-${event.date.getTime()}-TO`,
              this.simulation,
              internalAmount,
              event.date,
            )
            .serialize()
        : {
            id: `TRANSFER-${original.id}-${event.date.getTime()}-TO`,
            name: original.name, // Use the original transfer name
            amount: internalAmount,
            amountIsVariable: original.amountIsVariable || false,
            amountVariable: original.amountVariable || null,
            date: formatDate(event.date),
            dateIsVariable: false,
            dateVariable: null,
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
    // TODO: Implement
    return new Map();
  }

  processSocialSecurityEvent(event: SocialSecurityEvent, segmentResult: SegmentResult): Map<string, number> {
    // TODO: Implement
    return new Map();
  }

  processTaxEvent(event: TaxEvent, segmentResult: SegmentResult): Map<string, number> {
    // TODO: Implement
    return new Map();
  }

  processRMDEvent(event: RMDEvent, segmentResult: SegmentResult): Map<string, number> {
    // TODO: Implement
    return new Map();
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
}
