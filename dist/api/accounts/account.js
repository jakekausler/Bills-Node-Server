import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { saveData } from '../../utils/io/accountsAndTransfers';
export function getAccount(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    return account.simpleAccount();
}
export function updateAccount(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    account.name = data.data.name;
    saveData(data.accountsAndTransfers);
    return account.simpleAccount();
}
export function removeAccount(request) {
    const data = getData(request);
    data.accountsAndTransfers.accounts = data.accountsAndTransfers.accounts.filter((a) => a.id !== request.params.accountId);
    saveData(data.accountsAndTransfers);
    return request.params.accountId;
}
