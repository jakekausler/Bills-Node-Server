import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Account } from '../../../data/account/account';
import { getById } from '../../../utils/array/array';

export function getConsolidatedActivity(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.consolidatedActivity.map((a) => a.serialize());
}
