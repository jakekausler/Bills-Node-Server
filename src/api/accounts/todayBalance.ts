import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { todayBalance } from '../../data/account/account';
import { Account } from '../../data/account/account';

export async function getTodayBalance(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return todayBalance(account);
}
