import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById, getByIdWithIdx } from '../../../utils/array/array';
import { Account } from '../../../data/account/account';
import { Activity } from '../../../data/activity/activity';
import { ActivityData } from '../../../data/activity/types';
import { parseDate } from '../../../utils/date/date';
import { saveData } from '../../../utils/io/accountsAndTransfers';

export function getSpecificActivity(request: Request) {
  const data = getData(request);
  if (data.isTransfer) {
    return getById<Activity>(data.accountsAndTransfers.transfers.activity, request.params.activityId);
  } else {
    const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
    return getById<Activity>(account.activity, request.params.activityId);
  }
}

export function updateSpecificActivity(request: Request) {
  const data = getData<ActivityData>(request);
  let activity: Activity;
  let activityIdx: number;
  let originalIsTransfer = false;
  if (data.isTransfer) {
    // Try to get the activity from the transfers, but the activity might have been originally a non-transfer activity
    try {
      ({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
        data.accountsAndTransfers.transfers.activity,
        request.params.activityId,
      ));
      originalIsTransfer = true;
    } catch {
      const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
      ({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(account.activity, request.params.activityId));
      originalIsTransfer = false;
    }
  } else {
    // Try to get the activity from the account, but the activity might have been originally a transfer activity
    try {
      ({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
        getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity,
        request.params.activityId,
      ));
      originalIsTransfer = false;
    } catch {
      ({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
        data.accountsAndTransfers.transfers.activity,
        request.params.activityId,
      ));
      originalIsTransfer = true;
    }
  }

  activity.name = data.data.name;
  activity.date = parseDate(data.data.date);
  activity.dateIsVariable = data.data.dateIsVariable;
  activity.dateVariable = data.data.dateVariable;
  activity.category = data.data.category;
  activity.amountIsVariable = data.data.amountIsVariable;
  activity.amount = data.data.amount;
  activity.amountVariable = data.data.amountVariable;
  activity.flag = data.data.flag;
  activity.flagColor = data.data.flagColor;
  activity.isTransfer = data.data.isTransfer;
  if (activity.isTransfer) {
    activity.fro = data.data.from;
    activity.to = data.data.to;
  }

  if (!activity.isTransfer && originalIsTransfer) {
    // If the new activity is not a transfer but the old activity was, remove the old activity from the transfers and add it to the account
    getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity.push(activity);
    data.accountsAndTransfers.transfers.activity.splice(activityIdx, 1);
  } else if (activity.isTransfer && !originalIsTransfer) {
    // If the new activity is a transfer but the old activity was not, remove the old activity from the account and add it to the transfers
    getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity.splice(activityIdx, 1);
    data.accountsAndTransfers.transfers.activity.push(activity);
  }

  saveData(data.accountsAndTransfers);

  return activity.id;
}

export function deleteSpecificActivity(request: Request) {
  const data = getData(request);
  let activity: Activity;
  let activityIdx: number;
  if (data.isTransfer) {
    ({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
      data.accountsAndTransfers.transfers.activity,
      request.params.activityId,
    ));
  } else {
    const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
    ({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(account.activity, request.params.activityId));
  }

  if (data.isTransfer) {
    data.accountsAndTransfers.transfers.activity.splice(activityIdx, 1);
  } else {
    getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity.splice(activityIdx, 1);
  }

  saveData(data.accountsAndTransfers);

  return activity.id;
}

export function changeAccountForActivity(request: Request) {
  const data = getData(request);
  const oldAccount = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  let activity: Activity;

  if (data.isTransfer) {
    activity = getById<Activity>(data.accountsAndTransfers.transfers.activity, request.params.activityId);
  } else {
    activity = getById<Activity>(oldAccount.activity, request.params.activityId);
  }

  const newAccount = getById<Account>(data.accountsAndTransfers.accounts, request.params.newAccountId);
  if (data.isTransfer) {
    activity.fro = newAccount.name;
  } else {
    oldAccount.activity = oldAccount.activity.filter((a) => a.id !== activity.id);
    newAccount.activity.push(activity);
    console.log(oldAccount.name, newAccount.name, activity.name);
  }
  saveData(data.accountsAndTransfers);
  return activity.id;
}
