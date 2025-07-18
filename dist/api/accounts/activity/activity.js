import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { Activity } from '../../../data/activity/activity';
import { saveData } from '../../../utils/io/accountsAndTransfers';
/**
 * Retrieves all activities for a specific account
 * @param request - Express request object containing account ID in params
 * @returns Array of serialized activity objects
 */
export function getAccountActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    return account.activity.map((activity) => activity.serialize());
}
/**
 * Adds a new activity to an account or transfers collection
 * @param request - Express request object containing activity data and account ID
 * @returns The ID of the newly created activity
 */
export function addActivity(request) {
    const data = getData(request);
    const activity = new Activity(data.data, data.simulation);
    if (data.data.isTransfer) {
        data.accountsAndTransfers.transfers.activity.push(activity);
    }
    else {
        const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
        account.activity.push(activity);
    }
    saveData(data.accountsAndTransfers);
    return activity.id;
}
