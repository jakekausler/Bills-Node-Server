import { Request } from 'express';
import { getData } from '../../../utils/net/request';

/**
 * Retrieves expense breakdown by subcategory within a specific category section
 *
 * This endpoint analyzes consolidated activities to calculate spending amounts
 * for each subcategory within a given category section. It handles:
 * - Account filtering (selected accounts and hidden accounts)
 * - Transfer activity adjustments (half amount for internal transfers)
 * - Exclusion of positive amounts (credits/refunds)
 * - Rounding to 2 decimal places
 *
 * @param request - Express request object with section parameter
 * @returns Object mapping subcategory names to their total spending amounts
 */
export async function getCategorySectionBreakdown(request: Request) {
  const data = await getData(request);
  const section = request.params.section as string;
  const accounts = data.accountsAndTransfers.accounts;

  const ret: Record<string, number> = {};
  for (const account of accounts) {
    // Don't show category breakdown for non-selected accounts
    if (data.selectedAccounts.length > 0 && !data.selectedAccounts.includes(account.id)) {
      continue;
    }
    // Don't show category breakdown for hidden accounts if not explicitly selected
    if (data.selectedAccounts.length === 0 && account.hidden) {
      continue;
    }
    for (const activity of account.consolidatedActivity) {
      if (!activity.category?.startsWith(section)) {
        continue;
      }
      const item = activity.category.split('.')[1];
      if (!(item in ret)) {
        ret[item] = 0;
      }
      if (activity.isTransfer) {
        // If the activity is a transfer and has a category, subtract the amount
        // from the category - but it will be subtracted again when the other
        // account is processed. Because of this, we only subtract half the
        // amount on each side of the transfer.
        // If the other half of the transfer is not in the selected accounts,
        // Then subtract the full amount.
        if (activity.to && !data.selectedAccounts.includes(activity.to)) {
          ret[item] += Math.round((activity.amount as number) * 100) / 100;
        } else if (activity.fro && !data.selectedAccounts.includes(activity.fro)) {
          ret[item] += Math.round((activity.amount as number) * 100) / 100;
        } else {
          ret[item] += Math.round((activity.amount as number) * 0.5 * 100) / 100;
        }
      } else {
        // Add the amount (negative for debits, positive for credits) to the category
        ret[item] += Math.round((activity.amount as number) * 100) / 100;
      }
    }
  }
  const toDelete: string[] = [];
  for (const key in ret) {
    if (ret[key] >= 0) {
      toDelete.push(key);
    } else {
      ret[key] = -ret[key];
    }
  }
  for (const key of toDelete) {
    delete ret[key];
  }
  return ret;
}
