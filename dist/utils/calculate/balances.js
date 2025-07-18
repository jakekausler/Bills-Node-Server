import { todayBalance } from '../../data/account/account';
import { isSame } from '../date/date';
import { dealWithOtherTransfers } from './transfers';
import { dealWithSpecialFractions } from './transfers';
import { startTiming, endTiming } from '../log';
export function retrieveBalances(account, accounts, currDate, idxMap, balanceMap) {
    startTiming('retrieveBalances');
    while (
    // While we are still within the bounds of the consolidated activity array
    idxMap[account.id] < account.consolidatedActivity.length) {
        // And the date of the activity is the current date
        if (!isSame(account.consolidatedActivity[idxMap[account.id]]?.date, currDate)) {
            break;
        }
        const removed = dealWithSpecialFractions(account, accounts, idxMap, balanceMap);
        if (!removed) {
            dealWithOtherTransfers(account, accounts, idxMap, balanceMap);
            updateBalanceMap(account, balanceMap, idxMap);
            idxMap[account.id] += 1;
        }
    }
    endTiming('retrieveBalances');
}
function updateBalanceMap(account, balanceMap, idxMap) {
    balanceMap[account.id] += account.consolidatedActivity[idxMap[account.id]].amount;
    account.consolidatedActivity[idxMap[account.id]].balance = balanceMap[account.id];
}
export function retrieveTodayBalances(accountsAndTransfers, startDate, endDate) {
    startTiming('retrieveTodayBalances');
    for (const account of accountsAndTransfers.accounts) {
        account.todayBalance = todayBalance(account);
        account.consolidatedActivity = account.consolidatedActivity.filter((activity) => activity.date >= startDate && activity.date <= endDate);
    }
    endTiming('retrieveTodayBalances');
}
