import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { DateString } from '../../utils/date/types';

/**
 * Wrapper pairing a payout activity with its target account and income category.
 * Used by InheritanceManager and LifeInsuranceManager to return payouts
 * that the engine injects into account segments.
 */
export interface ManagerPayout {
  activity: ConsolidatedActivity;
  targetAccountId: string;
  incomeSourceName: string;
}

/**
 * Creates a ConsolidatedActivity suitable for a payout deposit.
 * Payouts are simple income deposits — all healthcare/paycheck fields default to false/null.
 * Neither inheritance nor life insurance payouts are taxable (IRC §101(a)(1) for insurance,
 * post-tax estate values for inheritance).
 */
export function createPayoutActivity(
  id: string,
  date: string,
  name: string,
  amount: number,
  category: string,
): ConsolidatedActivity {
  return new ConsolidatedActivity({
    id,
    date: date as DateString,
    dateIsVariable: false,
    dateVariable: null,
    name,
    amount,
    amountIsVariable: false,
    amountVariable: null,
    category,
    flag: false,
    flagColor: null,
    isTransfer: false,
    from: null,
    to: null,
    isHealthcare: false,
    healthcarePerson: null,
    copayAmount: null,
    coinsurancePercent: null,
    countsTowardDeductible: false,
    countsTowardOutOfPocket: false,
    spendingCategory: null,
    paycheckDetails: null,
    isPaycheckActivity: false,
  });
}
