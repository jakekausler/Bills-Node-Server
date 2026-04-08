import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { saveData } from '../../utils/io/accountsAndTransfers';

export async function getAllBills(request: Request) {
  const data = await getData(request);

  const accountBills = data.accountsAndTransfers.accounts.flatMap((account) =>
    account.bills.map((bill) => ({
      ...bill.serialize(),
      accountId: account.id,
      accountName: account.name,
    }))
  );

  const transferBills = data.accountsAndTransfers.transfers.bills.map((bill) => ({
    ...bill.serialize(),
    accountId: 'transfers',
    accountName: 'Transfers',
  }));

  return [...accountBills, ...transferBills];
}

/**
 * Bulk delete bills across accounts
 * Body: Array of { accountId: string, billId: string, isTransfer?: boolean }
 */
export async function bulkDeleteBills(request: Request) {
  const data = await getData<Array<{ accountId: string; billId: string; isTransfer?: boolean }>>(request);
  const items = data.data;

  for (const item of items) {
    if (item.isTransfer) {
      const idx = data.accountsAndTransfers.transfers.bills.findIndex((b: any) => b.id === item.billId);
      if (idx >= 0) data.accountsAndTransfers.transfers.bills.splice(idx, 1);
    } else {
      const account = data.accountsAndTransfers.accounts.find((a: any) => a.id === item.accountId);
      if (account) {
        const idx = account.bills.findIndex((b: any) => b.id === item.billId);
        if (idx >= 0) account.bills.splice(idx, 1);
      }
    }
  }

  saveData(data.accountsAndTransfers);
  return { deleted: items.length };
}

/**
 * Bulk change account for bills
 * Body: { bills: Array<{ accountId: string, billId: string }>, newAccountId: string }
 */
export async function bulkChangeBillAccount(request: Request) {
  const data = await getData<{ bills: Array<{ accountId: string; billId: string }>; newAccountId: string }>(request);
  const { bills, newAccountId } = data.data;
  const newAccount = data.accountsAndTransfers.accounts.find((a: any) => a.id === newAccountId);
  if (!newAccount) throw new Error('Target account not found');

  for (const item of bills) {
    const oldAccount = data.accountsAndTransfers.accounts.find((a: any) => a.id === item.accountId);
    if (!oldAccount) continue;
    const billIdx = oldAccount.bills.findIndex((b: any) => b.id === item.billId);
    if (billIdx < 0) continue;
    const [bill] = oldAccount.bills.splice(billIdx, 1);
    newAccount.bills.push(bill);
  }

  saveData(data.accountsAndTransfers);
  return { moved: bills.length };
}
