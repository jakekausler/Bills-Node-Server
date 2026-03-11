import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { Account } from '../../data/account/account';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { AccountData } from '../../data/account/types';

/**
 * Retrieves a simplified account object by ID
 *
 * @param request - Express request object with accountId parameter
 * @returns Simplified account object containing basic account information
 */
export async function getAccount(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.simpleAccount();
}

/**
 * Updates an account's name and saves the data
 *
 * @param request - Express request object with accountId parameter and account data
 * @returns Updated simplified account object
 */
export async function updateAccount(request: Request) {
  const data = await getData<AccountData>(request);
  if (!data.data.name || typeof data.data.name !== 'string' || data.data.name.trim() === '') {
    throw new Error('Account name is required');
  }
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  account.name = data.data.name;
  saveData(data.accountsAndTransfers);
  return account.simpleAccount();
}

/**
 * Removes an account from the system and saves the data
 *
 * @param request - Express request object with accountId parameter
 * @returns The ID of the removed account
 */
export async function removeAccount(request: Request) {
  const data = await getData<AccountData>(request);
  const beforeLength = data.accountsAndTransfers.accounts.length;
  data.accountsAndTransfers.accounts = data.accountsAndTransfers.accounts.filter(
    (a) => a.id !== request.params.accountId,
  );
  if (data.accountsAndTransfers.accounts.length < beforeLength) {
    const removedAccountId = request.params.accountId;
    // Clean up dangling references to the removed account
    for (const account of data.accountsAndTransfers.accounts) {
      if (account.interestPayAccount === removedAccountId) {
        account.interestPayAccount = null;
      }
      if (account.rmdAccount === removedAccountId) {
        account.rmdAccount = null;
      }
      if (account.pushAccount === removedAccountId) {
        account.pushAccount = null;
      }
    }
    saveData(data.accountsAndTransfers);
  }
  return request.params.accountId;
}
