import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Account } from '../../../data/account/account';
import { getById } from '../../../utils/array/array';
import { Interest } from '../../../data/interest/interest';
import { InterestData } from '../../../data/interest/types';
import { saveData } from '../../../utils/io/accountsAndTransfers';

export async function getAccountInterests(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.interests.map((interest) => interest.serialize());
}

export async function addInterest(request: Request) {
  const data = await getData<InterestData>(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  const interest = new Interest(data.data);
  account.interests.push(interest);
  return interest.id;
}

export async function updateInterest(request: Request) {
  const data = await getData<InterestData[]>(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  account.interests = data.data.map((interest) => new Interest(interest));
  saveData(data.accountsAndTransfers);
  return account.interests.map((interest) => interest.id);
}

export async function deleteInterest(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  account.interests = [];
  saveData(data.accountsAndTransfers);
  return null;
}
