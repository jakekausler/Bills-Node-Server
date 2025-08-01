import { Activity } from './activity';
import { ActivityData, ConsolidatedActivityData } from './types';

/**
 * Represents a consolidated activity that combines regular activities with bill and interest tracking.
 * Extends the base Activity class with additional metadata for financial calculations.
 */
export class ConsolidatedActivity extends Activity {
  /** ID of the associated bill, if this activity was generated from a bill */
  billId: string | null;
  /** Flag indicating if this is the first occurrence of this bill */
  firstBill: boolean;
  /** ID of the associated interest calculation, if this activity was generated from interest */
  interestId: string | null;
  /** Flag indicating if this is the first occurrence of this interest calculation */
  firstInterest: boolean;
  /** Running balance after this activity is applied */
  balance: number;

  /**
   * Creates a new consolidated activity
   * @param activity - Base activity data
   * @param options - Additional options for consolidated activity
   * @param options.billId - ID of associated bill
   * @param options.interestId - ID of associated interest calculation
   * @param options.reverseAmount - Whether to reverse the sign of the amount
   */
  constructor(
    activity: ActivityData,
    {
      billId = null,
      interestId = null,
      reverseAmount = false,
      firstBill = false,
      firstInterest = false,
    }: {
      billId?: string | null;
      interestId?: string | null;
      reverseAmount?: boolean;
      firstBill?: boolean;
      firstInterest?: boolean;
    } = {},
  ) {
    super(activity);
    this.billId = billId;
    this.firstBill = firstBill;
    this.interestId = interestId;
    this.firstInterest = firstInterest;
    this.balance = 0;
    if (reverseAmount && typeof this.amount === 'number') {
      this.amount *= -1;
      // Convert -0 to 0 for cleaner semantics
      if (this.amount === 0) {
        this.amount = 0;
      }
    }
  }

  /**
   * Serializes the consolidated activity to a plain object
   * @returns Serialized consolidated activity data including all base activity properties plus consolidated-specific fields
   */
  serialize(): ConsolidatedActivityData {
    return {
      ...super.serialize(),
      balance: this.balance,
      billId: this.billId,
      firstBill: this.firstBill,
      interestId: this.interestId,
      firstInterest: this.firstInterest,
    };
  }
}
