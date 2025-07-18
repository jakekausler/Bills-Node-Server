import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
export function getConsolidatedActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    return account.consolidatedActivity.map((a) => a.serialize());
}
