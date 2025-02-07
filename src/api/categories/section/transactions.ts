import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Activity } from '../../../data/activity/activity';

export function getCategorySectionTransactions(request: Request) {
  const data = getData(request);
  const section = request.params.section as string;
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
      if (activity.category.startsWith(section) && !foundIds.has(activity.id)) {
        ret.push(activity);
        foundIds.add(activity.id);
      }
    }
  }
  return ret.map((activity) => activity.serialize());
}
