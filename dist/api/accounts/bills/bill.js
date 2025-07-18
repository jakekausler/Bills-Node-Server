import { getData } from '../../../utils/net/request';
import { getById, getByIdWithIdx } from '../../../utils/array/array';
import { insertBill } from '../../../data/bill/bill';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { parseDate } from '../../../utils/date/date';
import { loadVariable } from '../../../utils/simulation/variable';
export function getSpecificBill(request) {
    const data = getData(request);
    if (data.asActivity) {
        return getBillAsActivity(request);
    }
    else {
        return getBillAsBill(request);
    }
}
function getBillAsActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    for (const a of account.consolidatedActivity) {
        if (a.billId === request.params.billId) {
            a.flag = false;
            a.flagColor = null;
            return a.serialize();
        }
    }
    return null;
}
function getBillAsBill(request) {
    const data = getData(request);
    if (data.isTransfer) {
        return getById(data.accountsAndTransfers.transfers.bills, request.params.billId).serialize();
    }
    else {
        return getById(getById(data.accountsAndTransfers.accounts, request.params.accountId).bills, request.params.billId).serialize();
    }
}
export function updateSpecificBill(request) {
    const data = getData(request);
    if (data.asActivity) {
        return updateBillAsActivity(request);
    }
    else if (data.skip) {
        return skipBill(request);
    }
    else {
        return updateBillAsBill(request);
    }
}
function updateBillAsActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    let bill;
    if (data.isTransfer) {
        bill = getById(data.accountsAndTransfers.transfers.bills, request.params.billId);
    }
    else {
        bill = getById(account.bills, request.params.billId);
    }
    insertBill(data.accountsAndTransfers, account, bill, data.data, data.isTransfer, data.simulation);
    saveData(data.accountsAndTransfers);
    return bill.id;
}
function skipBill(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    let bill;
    if (data.isTransfer) {
        bill = getById(data.accountsAndTransfers.transfers.bills, request.params.billId);
    }
    else {
        bill = getById(account.bills, request.params.billId);
    }
    bill.skip();
    saveData(data.accountsAndTransfers);
    return bill.id;
}
export function changeAccountForBill(request) {
    const data = getData(request);
    const oldAccount = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    let bill;
    if (data.isTransfer) {
        bill = getById(data.accountsAndTransfers.transfers.bills, request.params.billId);
    }
    else {
        bill = getById(oldAccount.bills, request.params.billId);
    }
    const newAccount = getById(data.accountsAndTransfers.accounts, request.params.newAccountId);
    if (data.isTransfer) {
        bill.fro = newAccount.name;
    }
    else {
        oldAccount.bills = oldAccount.bills.filter((b) => b.id !== bill.id);
        newAccount.bills.push(bill);
    }
    saveData(data.accountsAndTransfers);
    return bill.id;
}
function updateBillAsBill(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    let bill;
    let billIdx;
    let originalIsTransfer = false;
    if (data.isTransfer) {
        // Try to get the bill from the transfers, but the bill might have been originally a non-transfer bill
        try {
            ({ item: bill, idx: billIdx } = getByIdWithIdx(data.accountsAndTransfers.transfers.bills, request.params.billId));
            originalIsTransfer = true;
        }
        catch {
            ({ item: bill, idx: billIdx } = getByIdWithIdx(account.bills, request.params.billId));
            originalIsTransfer = false;
        }
    }
    else {
        // Try to get the bill from the account, but the bill might have been originally a transfer bill
        try {
            ({ item: bill, idx: billIdx } = getByIdWithIdx(account.bills, request.params.billId));
            originalIsTransfer = false;
        }
        catch {
            ({ item: bill, idx: billIdx } = getByIdWithIdx(data.accountsAndTransfers.transfers.bills, request.params.billId));
            originalIsTransfer = true;
        }
    }
    bill.startDate = parseDate(data.data.startDate);
    bill.startDateIsVariable = data.data.startDateIsVariable;
    bill.startDateVariable = data.data.startDateVariable;
    bill.endDate = data.data.endDate
        ? parseDate(data.data.endDate)
        : data.data.endDateIsVariable && data.data.endDateVariable
            ? loadVariable(data.data.endDateVariable, data.simulation)
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
    if (bill.isTransfer && !originalIsTransfer) {
        data.accountsAndTransfers.transfers.bills.push(bill);
        account.bills.splice(billIdx, 1);
    }
    else if (!bill.isTransfer && originalIsTransfer) {
        account.bills.push(bill);
        data.accountsAndTransfers.transfers.bills.splice(billIdx, 1);
    }
    saveData(data.accountsAndTransfers);
    return bill.id;
}
export function deleteSpecificBill(request) {
    const data = getData(request);
    let bill;
    let billIdx;
    if (data.isTransfer) {
        ({ item: bill, idx: billIdx } = getByIdWithIdx(data.accountsAndTransfers.transfers.bills, request.params.billId));
    }
    else {
        const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
        ({ item: bill, idx: billIdx } = getByIdWithIdx(account.bills, request.params.billId));
    }
    if (data.isTransfer) {
        data.accountsAndTransfers.transfers.bills.splice(billIdx, 1);
    }
    else {
        getById(data.accountsAndTransfers.accounts, request.params.accountId).bills.splice(billIdx, 1);
    }
    saveData(data.accountsAndTransfers);
    return bill.id;
}
