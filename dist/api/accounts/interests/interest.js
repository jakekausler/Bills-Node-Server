import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { insertInterest } from '../../../data/interest/interest';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { parseDate } from '../../../utils/date/date';
export function getSpecificInterest(request) {
    const data = getData(request);
    if (data.asActivity) {
        return getInterestAsActivity(request);
    }
    else {
        return getInterestAsInterest(request);
    }
}
function getInterestAsActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    for (const a of account.consolidatedActivity) {
        if (a.interestId === request.params.interestId) {
            a.flag = false;
            a.flagColor = null;
            return a.serialize();
        }
    }
    return null;
}
function getInterestAsInterest(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    const interest = getById(account.interests, request.params.interestId);
    return interest.serialize();
}
export function updateSpecificInterest(request) {
    const data = getData(request);
    if (data.asActivity) {
        return updateInterestAsActivity(request);
    }
    else {
        return updateInterestAsInterest(request);
    }
}
function updateInterestAsActivity(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    const interest = getById(account.interests, request.params.interestId);
    insertInterest(account, interest, data.data, data.simulation);
    saveData(data.accountsAndTransfers);
    return interest.id;
}
function updateInterestAsInterest(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    const interest = getById(account.interests, request.params.interestId);
    interest.apr = data.data.apr;
    interest.compounded = data.data.compounded;
    interest.applicableDate = parseDate(data.data.applicableDate);
    account.interests.sort((a, b) => a.applicableDate.getTime() - b.applicableDate.getTime());
    saveData(data.accountsAndTransfers);
    return interest.id;
}
export function deleteSpecificInterest(request) {
    const data = getData(request);
    const account = getById(data.accountsAndTransfers.accounts, request.params.accountId);
    const interest = getById(account.interests, request.params.interestId);
    account.interests = account.interests.filter((i) => i.id !== interest.id);
    saveData(data.accountsAndTransfers);
    return interest.id;
}
