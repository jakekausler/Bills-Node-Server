import { Request } from 'express';
import { getData } from '../../utils/net/request';

export function getCategoryBreakdown(request: Request) {
  const data = getData(request);
  const accounts = data.accountsAndTransfers.accounts;
  const selectedAccounts = data.selectedAccounts;

  const ret: Record<string, number> = {};
  for (const account of accounts) {
    // Don't show category breakdown for non-selected accounts
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(account.id)) {
      continue;
    }
    // Don't show category breakdown for hidden accounts if not explicitly selected
    if (selectedAccounts.length === 0 && account.hidden) {
      continue;
    }
    for (const activity of account.consolidatedActivity) {
      if (activity.category == '') {
        continue;
      }
      const section = activity.category.split('.')[0];
      if (section == 'Ignore' || section == 'Income') {
        continue;
      }
      if (!(section in ret)) {
        ret[section] = 0;
      }
      if (activity.isTransfer) {
        // If the activity is a transfer and has a category, subtract the amount
        // from the category - but it will be subtracted again when the other
        // account is processed. Because of this, we only subtract half the
        // amount on each side of the transfer.
        // If the other half of the transfer is not in the selected accounts,
        // Then subtract the full amount.
        if (activity.to && !selectedAccounts.includes(activity.to)) {
          ret[section] -= Math.round((activity.amount as number) * 100) / 100;
        } else if (activity.fro && !selectedAccounts.includes(activity.fro)) {
          ret[section] -= Math.round((activity.amount as number) * 100) / 100;
        } else {
          ret[section] -= Math.round((activity.amount as number) * 50) / 100;
        }
      } else {
        // Add the amount (negative for debits, positive for credits) to the category
        ret[section] += Math.round((activity.amount as number) * 100) / 100;
      }
    }
  }

  // Remove all positive values
  const toRemove = [];
  for (const key in ret) {
    if (ret[key] >= 0) {
      toRemove.push(key);
    } else {
      ret[key] = -ret[key];
    }
  }
  for (const key of toRemove) {
    delete ret[key];
  }

  return ret;
}
