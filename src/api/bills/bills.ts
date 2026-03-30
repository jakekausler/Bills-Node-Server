import { Request } from 'express';
import { getData } from '../../utils/net/request';

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
