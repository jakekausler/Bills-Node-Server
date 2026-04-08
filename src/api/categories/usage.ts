import { Request } from 'express';
import { getData } from '../../utils/net/request';

/**
 * Returns which category sections and items have associated activities/bills.
 * Used for delete protection — categories with references cannot be deleted.
 */
export async function getCategoryUsage(request: Request) {
  const data = await getData(request);
  const accounts = data.accountsAndTransfers.accounts;

  const usedSections = new Set<string>();
  const usedItems = new Set<string>();

  function recordCategory(cat: string | null | undefined) {
    if (!cat) return;
    const parts = cat.split('.');
    usedSections.add(parts[0]);
    if (parts.length >= 2) {
      usedItems.add(`${parts[0]}.${parts[1]}`);
    }
  }

  for (const account of accounts) {
    for (const activity of account.activity) {
      recordCategory(activity.category);
      recordCategory(activity.spendingCategory);
    }
    for (const bill of account.bills) {
      recordCategory(bill.category);
      recordCategory(bill.spendingCategory);
    }
  }
  const transfers = data.accountsAndTransfers.transfers;
  for (const activity of transfers.activity) {
    recordCategory(activity.category);
    recordCategory(activity.spendingCategory);
  }
  for (const bill of transfers.bills) {
    recordCategory(bill.category);
    recordCategory(bill.spendingCategory);
  }

  return {
    sections: Array.from(usedSections),
    items: Array.from(usedItems),
  };
}
