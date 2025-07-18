import { formatDate, isAfter } from '../date/date';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { isBefore } from '../date/date';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { getById } from '../array/array';
import { calculateActivitiesForDates } from './calculateForDates';
import { startTiming, endTiming } from '../log';
dayjs.extend(utc);
export function pushIfNeeded(accountsAndTransfers, currDate, balanceMap, idxMap) {
    for (const account of accountsAndTransfers.accounts) {
        if (account.type === 'Checking' && account.pushAccount && account.performsPushes) {
            if (account.pushStart && isBefore(currDate, account.pushStart)) {
                return;
            }
            if (account.pushEnd && isAfter(currDate, account.pushEnd)) {
                return;
            }
            const pushAccount = accountsAndTransfers.accounts.find((a) => a.name === account.pushAccount);
            if (!pushAccount) {
                throw new Error(`Push account ${account.pushAccount} not found`);
            }
            const pushAmount = balanceMap[account.id] - (account.minimumBalance ?? 0) - (account.minimumPullAmount ?? 0) * 4;
            if (pushAmount <= 0) {
                return;
            }
            balanceMap[account.id] -= pushAmount;
            balanceMap[pushAccount.id] += pushAmount;
            const pushActivity = new ConsolidatedActivity({
                id: 'AUTO-PUSH',
                name: `Auto Push to ${pushAccount.name}`,
                amount: -pushAmount,
                amountIsVariable: false,
                amountVariable: null,
                date: formatDate(currDate),
                dateIsVariable: false,
                dateVariable: null,
                from: account.name,
                to: pushAccount.name,
                isTransfer: true,
                category: 'Ignore.Transfer',
                flag: true,
                flagColor: 'indigo',
            });
            pushActivity.balance = balanceMap[account.id];
            account.consolidatedActivity.splice(idxMap[account.id], 0, pushActivity);
            idxMap[account.id]++;
            const pushActivityPushAccount = new ConsolidatedActivity({
                ...pushActivity.serialize(),
                amount: pushAmount,
            });
            pushActivityPushAccount.balance = balanceMap[pushAccount.id];
            pushAccount.consolidatedActivity.splice(idxMap[pushAccount.id], 0, pushActivityPushAccount);
            idxMap[pushAccount.id]++;
        }
    }
}
function getNextPullableAccount(accountsAndTransfers, balanceMap) {
    return (accountsAndTransfers.accounts
        .filter((acc) => acc.pullPriority !== -1 && balanceMap[acc.id] > (acc.minimumBalance ?? 0))
        .sort((a, b) => a.pullPriority - b.pullPriority)[0] ?? null);
}
export function pullIfNeeded(accountsAndTransfers, currDate, balanceMap, idxMap) {
    for (const account of accountsAndTransfers.accounts) {
        if (account.type === 'Checking' && account.pushAccount && account.performsPulls) {
            if (account.pushStart && isBefore(currDate, account.pushStart)) {
                return;
            }
            // Check if the account's balance is less than the minimum balance. If so, pull money from the lowest pull priority account that has a positive balance. We might need to pull money from multiple accounts to cover the negative balance
            // If we pull money from an account, we will need to add an additional transaction representing the tax implications of the withdrawal to take place on the next April 1st of this account
            // That transaction will be added to the account's consolidated activity array at the correct index for the account on that date.
            // The tax transaction will use the account's withdrawal tax rate and early withdrawl penalty rate if before the account's early withdrawl date
            while (balanceMap[account.id] < (account.minimumBalance ?? 0)) {
                const pullableAccount = getNextPullableAccount(accountsAndTransfers, balanceMap);
                if (!pullableAccount) {
                    return;
                }
                // Calculate amount needed to cover negative balance, plus a margin to limit future pull amounts
                const amountNeeded = Math.abs(balanceMap[account.id] - (account.minimumBalance ?? 0)) + (account.minimumPullAmount ?? 0);
                const availableAmount = Math.min(amountNeeded, balanceMap[pullableAccount.id] - (pullableAccount.minimumBalance ?? 0));
                if (availableAmount <= 0) {
                    return;
                }
                // Update balances
                balanceMap[account.id] += availableAmount;
                balanceMap[pullableAccount.id] -= availableAmount;
                // Create transfer activity for the pull
                const pullActivityAccount = new ConsolidatedActivity({
                    id: 'AUTO-PULL',
                    name: `Auto Pull from ${pullableAccount.name}`,
                    amount: availableAmount,
                    amountIsVariable: false,
                    amountVariable: null,
                    date: formatDate(currDate),
                    dateIsVariable: false,
                    dateVariable: null,
                    from: pullableAccount.name,
                    to: account.name,
                    isTransfer: true,
                    category: 'Ignore.Transfer',
                    flag: true,
                    flagColor: 'violet',
                });
                pullActivityAccount.balance = balanceMap[account.id];
                const pullActivityPullable = new ConsolidatedActivity({
                    ...pullActivityAccount.serialize(),
                    amount: -availableAmount,
                });
                pullActivityPullable.balance = balanceMap[pullableAccount.id];
                // Add transfer activities to both accounts
                account.consolidatedActivity.splice(idxMap[account.id], 0, pullActivityAccount);
                pullableAccount.consolidatedActivity.splice(idxMap[pullableAccount.id], 0, pullActivityPullable);
                // Increment indices
                idxMap[account.id]++;
                idxMap[pullableAccount.id]++;
            }
        }
    }
}
export function payPullTaxes(accountsAndTransfers, currDate, balanceMap, idxMap) {
    for (const account of accountsAndTransfers.accounts) {
        // Create a map of source account ids to their taxable amounts
        const taxableMap = {};
        const priorNewYear = dayjs.utc(currDate).subtract(1, 'year').set('month', 0).set('date', 1).toDate();
        const priorEndOfYear = dayjs.utc(currDate).subtract(1, 'year').set('month', 11).set('date', 31).toDate();
        // Loop backward through the account's consolidated activity array until we are before the prior year
        for (let i = account.consolidatedActivity.length - 1; i >= 0; i--) {
            const activity = account.consolidatedActivity[i];
            if (isBefore(activity.date, priorNewYear)) {
                break;
            }
            if (isAfter(activity.date, priorEndOfYear)) {
                continue;
            }
            if (activity.id.startsWith('AUTO-PULL') || activity.id.startsWith('RMD')) {
                const sourceAccount = accountsAndTransfers.accounts.find((acc) => acc.name === activity.fro);
                if (!sourceAccount) {
                    throw new Error(`Source account ${activity.fro} not found`);
                }
                if (!taxableMap[sourceAccount.id]) {
                    taxableMap[sourceAccount.id] = 0;
                }
                taxableMap[sourceAccount.id] += activity.amount * (sourceAccount.withdrawalTaxRate || 0);
                if (sourceAccount.earlyWithdrawlDate && isBefore(activity.date, sourceAccount.earlyWithdrawlDate)) {
                    taxableMap[sourceAccount.id] += activity.amount * (sourceAccount.earlyWithdrawlPenalty || 0);
                }
            }
        }
        Object.entries(taxableMap).forEach(([accountId, amount]) => {
            if (amount > 0) {
                const fromAccount = getById(accountsAndTransfers.accounts, accountId);
                if (!fromAccount) {
                    throw new Error(`Account ${accountId} not found`);
                }
                const taxActivity = new ConsolidatedActivity({
                    id: 'TAX',
                    name: `Tax for Pull from ${fromAccount.name}`,
                    amount: -amount,
                    amountIsVariable: false,
                    amountVariable: null,
                    date: formatDate(currDate),
                    dateIsVariable: false,
                    dateVariable: null,
                    from: null,
                    to: null,
                    isTransfer: false,
                    category: 'Banking.Taxes',
                    flag: true,
                    flagColor: 'orange',
                });
                taxActivity.balance = balanceMap[account.id] - amount;
                balanceMap[account.id] -= amount;
                account.consolidatedActivity.splice(idxMap[account.id], 0, taxActivity);
                idxMap[account.id]++;
            }
        });
    }
}
export function handleMonthlyPushesAndPulls(accountsAndTransfers, currDate, balanceMap, idxMap, interestIdxMap, interestMap, nextInterestMap, simulation, monteCarlo, simulationNumber, nSimulations) {
    startTiming('handleMonthlyPushesAndPulls');
    // Create deep copies of all maps
    const balanceMapCopy = { ...balanceMap };
    const idxMapCopy = { ...idxMap };
    const interestIdxMapCopy = { ...interestIdxMap };
    const interestMapCopy = {};
    const nextInterestMapCopy = {};
    // Deep copy interest map
    Object.entries(interestMap).forEach(([key, interest]) => {
        if (interest) {
            interestMapCopy[key] = Object.assign(Object.create(Object.getPrototypeOf(interest)), interest);
        }
        else {
            interestMapCopy[key] = null;
        }
    });
    // Deep copy next interest map
    Object.entries(nextInterestMap).forEach(([key, date]) => {
        nextInterestMapCopy[key] = date ? new Date(date) : null;
    });
    // Deep copy accounts and transfers
    const accountsAndTransfersCopy = {
        accounts: accountsAndTransfers.accounts.map((account) => ({
            ...account,
            activity: account.activity.map((act) => Object.assign(Object.create(Object.getPrototypeOf(act)), act)),
            consolidatedActivity: account.consolidatedActivity.map((act) => Object.assign(Object.create(Object.getPrototypeOf(act)), act)),
            bills: account.bills.map((bill) => Object.assign(Object.create(Object.getPrototypeOf(bill)), bill)),
            interests: account.interests.map((interest) => Object.assign(Object.create(Object.getPrototypeOf(interest)), interest)),
        })),
        transfers: {
            activity: accountsAndTransfers.transfers.activity.map((transfer) => Object.assign(Object.create(Object.getPrototypeOf(transfer)), transfer)),
            bills: accountsAndTransfers.transfers.bills.map((transfer) => Object.assign(Object.create(Object.getPrototypeOf(transfer)), transfer)),
        },
    };
    // Mock the calculations for the current month
    calculateActivitiesForDates(accountsAndTransfersCopy, currDate, dayjs.utc(currDate).endOf('month').toDate(), simulation, monteCarlo, simulationNumber, nSimulations, true, balanceMapCopy, idxMapCopy, interestIdxMapCopy, interestMapCopy, nextInterestMapCopy);
    for (const account of accountsAndTransfersCopy.accounts) {
        if (account.type === 'Checking' && account.pushAccount && (account.performsPulls || account.performsPushes)) {
            if (account.pushStart && isBefore(currDate, account.pushStart)) {
                return;
            }
            if (account.pushEnd && isAfter(currDate, account.pushEnd)) {
                return;
            }
            const minimumBalance = getMinimumBalance(account, currDate);
            const originalAccount = accountsAndTransfers.accounts.find((a) => a.name === account.name);
            if (!originalAccount) {
                throw new Error(`Original account ${account.name} not found`);
            }
            if (account.performsPulls && minimumBalance < (account.minimumBalance ?? 0)) {
                performPull(accountsAndTransfers, originalAccount, currDate, balanceMapCopy, idxMap, minimumBalance);
            }
            if (account.performsPushes &&
                minimumBalance > (account.minimumBalance ?? 0) + (account.minimumPullAmount ?? 0) * 4) {
                performPush(accountsAndTransfers, originalAccount, currDate, balanceMapCopy, idxMap, minimumBalance);
            }
        }
    }
    endTiming('handleMonthlyPushesAndPulls');
}
function getMinimumBalance(account, currDate) {
    const endOfMonthDate = dayjs.utc(currDate).endOf('month').toDate();
    // Indices are the zero-indexed day of the month
    const dailyBalances = [];
    let previousBalance = 0;
    for (let i = 0; i < account.consolidatedActivity.length; i++) {
        const activity = account.consolidatedActivity[i];
        if (isBefore(activity.date, currDate)) {
            previousBalance = activity.balance;
            continue;
        }
        if (isAfter(activity.date, endOfMonthDate)) {
            break;
        }
        const dayOfMonth = dayjs.utc(activity.date).date() - 1;
        const balance = activity.balance;
        dailyBalances[dayOfMonth] = balance;
    }
    for (let i = 0; i < dailyBalances.length; i++) {
        if (dailyBalances[i] === undefined) {
            dailyBalances[i] = previousBalance;
        }
        else {
            previousBalance = dailyBalances[i];
        }
    }
    return dailyBalances.reduce((min, balance) => Math.min(min, balance), Infinity);
}
function performPull(accountsAndTransfers, account, currDate, balanceMap, idxMap, minimumBalance) {
    startTiming('performPull');
    while (minimumBalance < (account.minimumBalance ?? 0)) {
        const pullableAccount = getNextPullableAccount(accountsAndTransfers, balanceMap);
        if (!pullableAccount) {
            return;
        }
        // Calculate amount needed to cover negative balance, plus a margin to limit future pull amounts
        const amountNeeded = Math.abs(minimumBalance - (account.minimumBalance ?? 0)) + (account.minimumPullAmount ?? 0);
        const availableAmount = Math.min(amountNeeded, balanceMap[pullableAccount.id] - (pullableAccount.minimumBalance ?? 0));
        if (availableAmount <= 0) {
            return;
        }
        // Update balances
        minimumBalance += availableAmount;
        // Create transfer activity for the pull
        const pullActivityAccount = new ConsolidatedActivity({
            id: 'AUTO-PULL',
            name: `Auto Pull from ${pullableAccount.name}`,
            amount: availableAmount,
            amountIsVariable: false,
            amountVariable: null,
            date: formatDate(currDate),
            dateIsVariable: false,
            dateVariable: null,
            from: pullableAccount.name,
            to: account.name,
            isTransfer: true,
            category: 'Ignore.Transfer',
            flag: true,
            flagColor: 'violet',
        });
        const pullActivityPullable = new ConsolidatedActivity({
            ...pullActivityAccount.serialize(),
            amount: -availableAmount,
        });
        // Add transfer activities to both accounts
        account.consolidatedActivity.splice(idxMap[account.id], 0, pullActivityAccount);
        pullableAccount.consolidatedActivity.splice(idxMap[pullableAccount.id], 0, pullActivityPullable);
        // Update balance copies, so that other accounts get the correct balances
        balanceMap[account.id] += availableAmount;
        balanceMap[pullableAccount.id] -= availableAmount;
    }
    endTiming('performPull');
}
function performPush(accountsAndTransfers, account, currDate, balanceMap, idxMap, minimumBalance) {
    startTiming('performPush');
    const pushAccount = accountsAndTransfers.accounts.find((a) => a.name === account.pushAccount);
    if (!pushAccount) {
        throw new Error(`Push account ${account.pushAccount} not found`);
    }
    const pushAmount = minimumBalance - (account.minimumBalance ?? 0) - (account.minimumPullAmount ?? 0) * 4;
    if (pushAmount <= 0) {
        return;
    }
    minimumBalance -= pushAmount;
    const pushActivity = new ConsolidatedActivity({
        id: 'AUTO-PUSH',
        name: `Auto Push to ${pushAccount.name}`,
        amount: -pushAmount,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(currDate),
        dateIsVariable: false,
        dateVariable: null,
        from: account.name,
        to: pushAccount.name,
        isTransfer: true,
        category: 'Ignore.Transfer',
        flag: true,
        flagColor: 'indigo',
    });
    account.consolidatedActivity.splice(idxMap[account.id], 0, pushActivity);
    // Update balance copies, so that other accounts get the correct balances
    balanceMap[account.id] -= pushAmount;
    balanceMap[pushAccount.id] += pushAmount;
    const pushActivityPushAccount = new ConsolidatedActivity({
        ...pushActivity.serialize(),
        amount: pushAmount,
    });
    pushAccount.consolidatedActivity.splice(idxMap[pushAccount.id], 0, pushActivityPushAccount);
    endTiming('performPush');
}
