import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { Account } from '../../data/account/account';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { AccountData } from '../../data/account/types';

export function getAccount(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.simpleAccount();
}

export function updateAccount(request: Request) {
  const data = getData<AccountData>(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  account.name = data.data.name;
  saveData(data.accountsAndTransfers);
  return account.simpleAccount();
}

export function removeAccount(request: Request) {
  const data = getData<AccountData>(request);
  data.accountsAndTransfers.accounts = data.accountsAndTransfers.accounts.filter(
    (a) => a.id !== request.params.accountId,
  );
  saveData(data.accountsAndTransfers);
  return request.params.accountId;
}
