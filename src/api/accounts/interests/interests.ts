import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Account } from '../../../data/account/account';
import { getById } from '../../../utils/array/array';
import { Interest } from '../../../data/interest/interest';
import { InterestData } from '../../../data/interest/types';
import { saveData } from '../../../utils/io/accountsAndTransfers';

/**
 * Retrieves all interests for a specific account
 * @param request - Express request object containing account ID in params
 * @returns Array of serialized interest objects
 */
export function getAccountInterests(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.interests.map((interest) => interest.serialize());
}

/**
 * Adds a new interest configuration to an account
 * @param request - Express request object containing interest data and account ID
 * @returns The ID of the newly created interest
 */
export function addInterest(request: Request) {
  const data = getData<InterestData>(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  const interest = new Interest(data.data);
  account.interests.push(interest);
  return interest.id;
}

/**
 * Updates all interest configurations for an account by replacing them
 * @param request - Express request object containing array of interest data and account ID
 * @returns Array of IDs for the updated interests
 * @todo Skip functionality is not implemented
 */
export function updateInterest(request: Request) {
  // TODO: Skip is not implemented
  const data = getData<InterestData[]>(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  account.interests = data.data.map((interest) => new Interest(interest));
  saveData(data.accountsAndTransfers);
  return account.interests.map((interest) => interest.id);
}

/**
 * Deletes all interest configurations from an account
 * @param request - Express request object containing account ID in params
 * @returns null
 */
export function deleteInterest(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  account.interests = [];
  saveData(data.accountsAndTransfers);
  return null;
}
