import { getData } from '../../utils/net/request';
export function getFlow(request) {
    const data = getData(request);
    return {};
    // return loadFlow(data.accountsAndTransfers, data.selectedAccounts, data.startDate, data.endDate);
}
