import { Account } from '../../data/account/account';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { getData } from '../../utils/net/request';
import { parseDate } from '../../utils/date/date';
/**
 * Retrieves simplified account data for all accounts
 * @param request - Express request object containing user authentication
 * @returns Array of simplified account objects
 */
export function getSimpleAccounts(request) {
    const data = getData(request);
    return data.accountsAndTransfers.accounts.map((account) => account.simpleAccount());
}
/**
 * Adds a new account to the system
 * @param request - Express request object containing account data
 * @returns ID of the newly created account
 */
export function addAccount(request) {
    const data = getData(request);
    data.accountsAndTransfers.accounts.push(new Account(data.data, data.simulation));
    saveData(data.accountsAndTransfers);
    return data.accountsAndTransfers.accounts[data.accountsAndTransfers.accounts.length - 1].id;
}
/**
 * Updates basic account properties (name, type, hidden)
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateBasicAccountProperties(account, newAccount) {
    if (newAccount.name !== account.name) {
        account.name = newAccount.name;
    }
    if (newAccount.type !== account.type) {
        account.type = newAccount.type;
    }
    if (newAccount.hidden !== account.hidden) {
        account.hidden = newAccount.hidden;
    }
}
/**
 * Updates account tax and penalty settings
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateAccountTaxSettings(account, newAccount) {
    if (newAccount.interestTaxRate !== account.interestTaxRate) {
        account.interestTaxRate = newAccount.interestTaxRate || 0;
    }
    if (newAccount.withdrawalTaxRate !== account.withdrawalTaxRate) {
        account.withdrawalTaxRate = newAccount.withdrawalTaxRate || 0;
    }
    if (newAccount.earlyWithdrawlPenalty !== account.earlyWithdrawlPenalty) {
        account.earlyWithdrawlPenalty = newAccount.earlyWithdrawlPenalty || 0;
    }
    if (newAccount.earlyWithdrawlDate !== account.earlyWithdrawlDate) {
        account.earlyWithdrawlDate = newAccount.earlyWithdrawlDate || null;
    }
}
/**
 * Updates account pull/push configuration
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateAccountPullPushSettings(account, newAccount) {
    if (newAccount.pullPriority !== account.pullPriority) {
        account.pullPriority = newAccount.pullPriority || -1;
    }
    if (newAccount.minimumBalance !== account.minimumBalance) {
        account.minimumBalance = newAccount.minimumBalance || null;
    }
    if (newAccount.minimumPullAmount !== account.minimumPullAmount) {
        account.minimumPullAmount = newAccount.minimumPullAmount || null;
    }
    if (newAccount.performsPulls !== account.performsPulls) {
        account.performsPulls = newAccount.performsPulls || false;
    }
    if (newAccount.performsPushes !== account.performsPushes) {
        account.performsPushes = newAccount.performsPushes || false;
    }
    if (newAccount.pushStart !== account.pushStart) {
        account.pushStart = parseDate(newAccount.pushStart) || null;
    }
    if (newAccount.pushEnd !== account.pushEnd) {
        account.pushEnd = parseDate(newAccount.pushEnd) || null;
    }
    if (newAccount.pushAccount !== account.pushAccount) {
        account.pushAccount = newAccount.pushAccount || null;
    }
}
/**
 * Updates retirement-related account settings
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateRetirementSettings(account, newAccount) {
    if (newAccount.interestPayAccount !== account.interestPayAccount) {
        account.interestPayAccount = newAccount.interestPayAccount || null;
    }
    if (newAccount.usesRMD !== account.usesRMD) {
        account.usesRMD = newAccount.usesRMD || false;
    }
    if (newAccount.accountOwnerDOB !== account.accountOwnerDOB) {
        account.accountOwnerDOB = parseDate(newAccount.accountOwnerDOB) || null;
    }
    if (newAccount.rmdAccount !== account.rmdAccount) {
        account.rmdAccount = newAccount.rmdAccount || null;
    }
}
/**
 * Updates a single account with new data
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateSingleAccount(account, newAccount) {
    updateBasicAccountProperties(account, newAccount);
    updateAccountTaxSettings(account, newAccount);
    updateAccountPullPushSettings(account, newAccount);
    updateRetirementSettings(account, newAccount);
}
/**
 * Updates multiple accounts with new data
 * @param request - Express request object containing account updates
 * @returns Updated accounts array
 */
export function updateAccounts(request) {
    const data = getData(request);
    data.accountsAndTransfers.accounts.forEach((account) => {
        const newAccount = data.data.find((a) => a.id === account.id);
        if (newAccount) {
            updateSingleAccount(account, newAccount);
        }
    });
    saveData(data.accountsAndTransfers);
    return data.accountsAndTransfers.accounts;
}
