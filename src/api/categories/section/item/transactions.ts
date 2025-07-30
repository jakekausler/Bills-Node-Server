import { Request } from 'express';
import { getData } from '../../../../utils/net/request';
import { Activity } from '../../../../data/activity/activity';

/**
 * Retrieves all transactions for a specific category section item
 * 
 * This endpoint returns a list of all consolidated activities that belong
 * to the specified category section item (e.g., "Food.Groceries"). It handles:
 * - Account filtering (selected accounts and hidden accounts)
 * - Exact category matching (section.item)
 * - Transaction deduplication by ID
 * - Serialization of activity objects for API response
 * 
 * @param request - Express request object with section and item parameters
 * @returns Array of serialized activity objects for the specific category item
 */
export async function getCategorySectionItemTransactions(request: Request) {
  const data = await getData(request);
  const section = request.params.section;
  const item = request.params.item;
  const accounts = data.accountsAndTransfers.accounts;

  const ret: Activity[] = [];
  const foundIds = new Set<string>();
  for (const account of accounts) {
    if (data.selectedAccounts.length > 0 && !data.selectedAccounts.includes(account.id)) {
      // Don't show transactions for non-selected accounts
      continue;
    }
    if (data.selectedAccounts.length === 0 && account.hidden) {
      // Don't show hidden accounts if not explicitly selected
      continue;
    }
    for (const activity of account.consolidatedActivity) {
      if (activity.category == section + '.' + item && !foundIds.has(activity.id)) {
        ret.push(activity);
        foundIds.add(activity.id);
      }
    }
  }
  return ret.map((activity) => activity.serialize());
}
