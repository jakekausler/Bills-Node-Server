import { getData } from '../../../../utils/net/request';
export function getCategorySectionItemTransactions(request) {
    const data = getData(request);
    const section = request.params.section;
    const item = request.params.item;
    const accounts = data.accountsAndTransfers.accounts;
    const ret = [];
    const foundIds = new Set();
    for (const account of accounts) {
        if (data.selectedAccounts.length > 0 && !data.selectedAccounts.includes(account.id)) {
            // Don't show transactions for non-selected accounts
            continue;
        }
        if (data.selectedAccounts.length === 0 && account.hidden) {
            // Don't show hidden accounts if not explicitly selected
            continue;
        }
        for (const activity of account.consolidatedActivity) {
            if (activity.category == section + '.' + item && !foundIds.has(activity.id)) {
                ret.push(activity);
                foundIds.add(activity.id);
            }
        }
    }
    return ret.map((activity) => activity.serialize());
}
