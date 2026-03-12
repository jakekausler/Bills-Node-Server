import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';

/**
 * Factory function to create ConsolidatedActivity instances.
 * This factory exists to break the circular dependency between cache.ts and consolidatedActivity.ts
 * that would otherwise occur if cache.ts directly requires consolidatedActivity at module load time.
 *
 * @param data - Plain object data to construct the ConsolidatedActivity from
 * @returns A new ConsolidatedActivity instance
 */
export function createConsolidatedActivity(data: any): ConsolidatedActivity {
  return new ConsolidatedActivity(data, {
    billId: data.billId,
    firstBill: data.firstBill,
    interestId: data.interestId,
    firstInterest: data.firstInterest,
    spendingTrackerId: data.spendingTrackerId,
    firstSpendingTracker: data.firstSpendingTracker,
  });
}
