import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { Account } from '../../../data/account/account';
import { insertInterest, Interest } from '../../../data/interest/interest';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { parseDate } from '../../../utils/date/date';
import { ActivityData } from '../../../data/activity/types';
import { InterestData } from '../../../data/interest/types';

export async function getSpecificInterest(request: Request) {
  const data = await getData(request);

  if (data.asActivity) {
    return getInterestAsActivity(request, data);
  } else {
    return getInterestAsInterest(request, data);
  }
}

async function getInterestAsActivity(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  for (const a of account.consolidatedActivity) {
    if (a.interestId === request.params.interestId) {
      const serialized = a.serialize();
      serialized.flag = false;
      serialized.flagColor = null;
      return serialized;
    }
  }
  return null;
}

async function getInterestAsInterest(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  const interest = getById<Interest>(account.interests, request.params.interestId);
  return interest.serialize();
}

export async function updateSpecificInterest(request: Request) {
  const data = await getData(request);
  if (data.asActivity) {
    return updateInterestAsActivity(request, data);
  } else {
    return updateInterestAsInterest(request, data);
  }
}

async function updateInterestAsActivity(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  const interest = getById<Interest>(account.interests, request.params.interestId);
  insertInterest(account, interest, data.data, data.simulation);
  saveData(data.accountsAndTransfers);
  return interest.id;
}

async function updateInterestAsInterest(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  const interest = getById<Interest>(account.interests, request.params.interestId);
  interest.apr = data.data.apr;
  interest.compounded = data.data.compounded;
  interest.applicableDate = parseDate(data.data.applicableDate);
  account.interests.sort((a, b) => a.applicableDate.getTime() - b.applicableDate.getTime());
  saveData(data.accountsAndTransfers);
  return interest.id;
}

export async function deleteSpecificInterest(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  const interest = getById<Interest>(account.interests, request.params.interestId);
  account.interests = account.interests.filter((i) => i.id !== interest.id);
  saveData(data.accountsAndTransfers);
  return interest.id;
}
