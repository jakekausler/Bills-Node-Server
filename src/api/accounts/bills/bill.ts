import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById, getByIdWithIdx, getByIdWithIdxOrNull } from '../../../utils/array/array';
import { Account } from '../../../data/account/account';
import { Bill, insertBill } from '../../../data/bill/bill';
import { BillData } from '../../../data/bill/types';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { ActivityData } from '../../../data/activity/types';
import { parseDate } from '../../../utils/date/date';
import { loadVariable } from '../../../utils/simulation/variable';

export async function getSpecificBill(request: Request) {
  const data = await getData(request);
  if (data.asActivity) {
    return getBillAsActivity(request, data);
  } else {
    return getBillAsBill(request, data);
  }
}

async function getBillAsActivity(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  for (const a of account.consolidatedActivity) {
    if (a.billId === request.params.billId) {
      a.flag = false;
      a.flagColor = null;
      return a.serialize();
    }
  }
  return null;
}

async function getBillAsBill(request: Request, data: any) {
  if (data.isTransfer) {
    return getById<Bill>(data.accountsAndTransfers.transfers.bills, request.params.billId).serialize();
  } else {
    return getById<Bill>(
      getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).bills,
      request.params.billId,
    ).serialize();
  }
}

export async function updateSpecificBill(request: Request) {
  const data = await getData(request);
  if (data.asActivity) {
    return updateBillAsActivity(request, data);
  } else if (data.skip) {
    return skipBill(request, data);
  } else {
    return updateBillAsBill(request, data);
  }
}

async function updateBillAsActivity(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  let bill: Bill;
  if (data.isTransfer) {
    bill = getById<Bill>(data.accountsAndTransfers.transfers.bills, request.params.billId);
  } else {
    bill = getById<Bill>(account.bills, request.params.billId);
  }

  insertBill(data.accountsAndTransfers, account, bill, data.data, data.isTransfer, data.simulation);
  saveData(data.accountsAndTransfers);

  return bill.id;
}

async function skipBill(request: Request, data: any) {
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  let bill: Bill;
  if (data.isTransfer) {
    bill = getById<Bill>(data.accountsAndTransfers.transfers.bills, request.params.billId);
  } else {
    bill = getById<Bill>(account.bills, request.params.billId);
  }

  bill.skip();
  saveData(data.accountsAndTransfers);

  return bill.id;
}

export async function changeAccountForBill(request: Request) {
  const data = await getData(request);
  const oldAccount = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  let bill: Bill;
  if (data.isTransfer) {
    bill = getById<Bill>(data.accountsAndTransfers.transfers.bills, request.params.billId);
  } else {
    bill = getById<Bill>(oldAccount.bills, request.params.billId);
  }

  const newAccount = getById<Account>(data.accountsAndTransfers.accounts, request.params.newAccountId);
  if (data.isTransfer) {
    bill.fro = newAccount.name;
  } else {
    oldAccount.bills = oldAccount.bills.filter((b) => b.id !== bill.id);
    newAccount.bills.push(bill);
  }
  saveData(data.accountsAndTransfers);
  return bill.id;
}

async function updateBillAsBill(request: Request, data: any) {

  // Validate healthcare bills have non-zero amounts
  if (data.data.isHealthcare && !data.data.amountIsVariable && data.data.amount === 0) {
    throw new Error('Healthcare bills must have a non-zero amount');
  }

  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  let bill: Bill;
  let billIdx: number;
  let originalIsTransfer = false;
  if (data.isTransfer) {
    // Try to get the bill from the transfers, but the bill might have been originally a non-transfer bill
    let result = getByIdWithIdxOrNull<Bill>(data.accountsAndTransfers.transfers.bills, request.params.billId);
    if (result) {
      ({ item: bill, idx: billIdx } = result);
      originalIsTransfer = true;
    } else {
      ({ item: bill, idx: billIdx } = getByIdWithIdx<Bill>(account.bills, request.params.billId));
      originalIsTransfer = false;
    }
  } else {
    // Try to get the bill from the account, but the bill might have been originally a transfer bill
    let result = getByIdWithIdxOrNull<Bill>(account.bills, request.params.billId);
    if (result) {
      ({ item: bill, idx: billIdx } = result);
      originalIsTransfer = false;
    } else {
      ({ item: bill, idx: billIdx } = getByIdWithIdx<Bill>(
        data.accountsAndTransfers.transfers.bills,
        request.params.billId,
      ));
      originalIsTransfer = true;
    }
  }

  bill.startDate = parseDate(data.data.startDate);
  bill.startDateIsVariable = data.data.startDateIsVariable;
  bill.startDateVariable = data.data.startDateVariable;
  bill.endDate = data.data.endDate
    ? parseDate(data.data.endDate)
    : data.data.endDateIsVariable && data.data.endDateVariable
      ? (loadVariable(data.data.endDateVariable, data.simulation) as Date)
      : null;
  bill.endDateIsVariable = data.data.endDateIsVariable;
  bill.endDateVariable = data.data.endDateVariable;
  bill.category = data.data.category;
  bill.amount = data.data.amount;
  bill.amountIsVariable = data.data.amountIsVariable;
  bill.amountVariable = data.data.amountVariable;
  bill.name = data.data.name;
  bill.everyN = data.data.everyN;
  bill.periods = data.data.periods;
  bill.isTransfer = data.data.isTransfer;
  bill.fro = data.data.from;
  bill.to = data.data.to;
  bill.isAutomatic = data.data.isAutomatic;
  bill.increaseBy = data.data.increaseBy;
  bill.increaseByIsVariable = data.data.increaseByIsVariable;
  bill.increaseByVariable = data.data.increaseByVariable;
  bill.increaseByDate = bill.setIncreaseByDate(data.data.increaseByDate);
  bill.flag = data.data.flag;
  bill.flagColor = data.data.flagColor;
  bill.isHealthcare = data.data.isHealthcare || false;
  bill.healthcarePerson = data.data.healthcarePerson || null;
  bill.copayAmount = data.data.copayAmount ?? null;
  bill.coinsurancePercent = data.data.coinsurancePercent ?? null;
  bill.countsTowardDeductible = data.data.countsTowardDeductible ?? true;
  bill.countsTowardOutOfPocket = data.data.countsTowardOutOfPocket ?? true;
  bill.spendingCategory = data.data.spendingCategory ?? null;
  bill.paycheckProfile = data.data.paycheckProfile ?? null;

  if (bill.isTransfer && !originalIsTransfer) {
    data.accountsAndTransfers.transfers.bills.push(bill);
    account.bills.splice(billIdx, 1);
  } else if (!bill.isTransfer && originalIsTransfer) {
    account.bills.push(bill);
    data.accountsAndTransfers.transfers.bills.splice(billIdx, 1);
  }

  saveData(data.accountsAndTransfers);

  return bill.id;
}

export async function deleteSpecificBill(request: Request) {
  const data = await getData(request);
  let bill: Bill;
  let billIdx: number;
  let account: Account | undefined;
  if (data.isTransfer) {
    ({ item: bill, idx: billIdx } = getByIdWithIdx<Bill>(
      data.accountsAndTransfers.transfers.bills,
      request.params.billId,
    ));
  } else {
    account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
    ({ item: bill, idx: billIdx } = getByIdWithIdx<Bill>(account.bills, request.params.billId));
  }

  if (data.isTransfer) {
    data.accountsAndTransfers.transfers.bills.splice(billIdx, 1);
  } else {
    account!.bills.splice(billIdx, 1);
  }

  saveData(data.accountsAndTransfers);

  return bill.id;
}
