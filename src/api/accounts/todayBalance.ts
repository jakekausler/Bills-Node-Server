import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { todayBalance } from '../../data/account/account';
import { Account } from '../../data/account/account';

/**
 * Retrieves the current balance for a specific account
 *
 * This endpoint calculates the account's balance as of today, taking into account
 * all activities, transactions, and any other balance adjustments.
 *
 * @param request - Express request object containing account ID in params
 * @returns The current balance of the specified account
 */
export async function getTodayBalance(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return todayBalance(account);
}
