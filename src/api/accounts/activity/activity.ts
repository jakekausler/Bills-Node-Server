import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Account } from '../../../data/account/account';
import { getById } from '../../../utils/array/array';
import { Activity } from '../../../data/activity/activity';
import { ActivityData } from '../../../data/activity/types';
import { saveData } from '../../../utils/io/accountsAndTransfers';

export function getAccountActivity(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.activity.map((activity) => activity.serialize());
}

export function addActivity(request: Request) {
  const data = getData<ActivityData>(request);
  const activity = new Activity(data.data, data.simulation);
  if (data.data.isTransfer) {
    data.accountsAndTransfers.transfers.activity.push(activity);
  } else {
    const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
    account.activity.push(activity);
  }
  saveData(data.accountsAndTransfers);
  return activity.id;
}
