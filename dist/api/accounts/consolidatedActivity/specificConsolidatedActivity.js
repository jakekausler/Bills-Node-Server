import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
export function getSpecificConsolidatedActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    const activity = getById(account.consolidatedActivity, request.params.activityId);
    return activity.serialize();
}
