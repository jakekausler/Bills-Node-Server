import { getData } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { todayBalance } from '../../data/account/account';
export function getTodayBalance(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    return todayBalance(account);
}
