import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Account } from '../../../data/account/account';
import { getById } from '../../../utils/array/array';
import { Bill } from '../../../data/bill/bill';
import { BillData } from '../../../data/bill/types';
import { saveData } from '../../../utils/io/accountsAndTransfers';

/**
 * Retrieves all bills for a specific account
 * @param request - Express request object containing account ID in params
 * @returns Array of serialized bill objects
 */
export function getAccountBills(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return account.bills.map((bill) => bill.serialize());
}

/**
 * Adds a new bill to an account or transfers collection
 * @param request - Express request object containing bill data and account ID
 * @returns The ID of the newly created bill
 */
export function addBill(request: Request) {
  const data = getData<BillData>(request);
  const bill = new Bill(data.data, data.simulation);
  if (data.data.isTransfer) {
    data.accountsAndTransfers.transfers.bills.push(bill);
  } else {
    const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
    account.bills.push(bill);
  }
  saveData(data.accountsAndTransfers);
  return bill.id;
}
