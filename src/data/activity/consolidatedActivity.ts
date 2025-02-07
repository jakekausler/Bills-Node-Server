import { Activity } from './activity';
import { ActivityData, ConsolidatedActivityData } from './types';

export class ConsolidatedActivity extends Activity {
  billId: string | null;
  firstBill: boolean;
  interestId: string | null;
  firstInterest: boolean;
  balance: number;

  constructor(
    activity: ActivityData,
    {
      billId = null,
      interestId = null,
      reverseAmount = false,
    }: {
      billId?: string | null;
      interestId?: string | null;
      reverseAmount?: boolean;
    } = {},
  ) {
    super(activity);
    this.billId = billId;
    this.firstBill = false;
    this.interestId = interestId;
    this.firstInterest = false;
    this.balance = 0;
    if (reverseAmount && typeof this.amount === 'number') {
      this.amount *= -1;
    }
  }

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
