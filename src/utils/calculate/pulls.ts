import { formatDate, isAfter } from '../date/date';

import { AccountsAndTransfers } from '../../data/account/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { isBefore } from '../date/date';
import dayjs from 'dayjs';
import { getById } from '../array/array';
import { Account } from '../../data/account/account';

function getNextPullableAccount(accountsAndTransfers: AccountsAndTransfers, balanceMap: Record<string, number>) {
  return (
    accountsAndTransfers.accounts
      .filter((acc) => acc.pullPriority !== -1 && balanceMap[acc.id] > (acc.minimumBalance ?? 0))
      .sort((a, b) => a.pullPriority - b.pullPriority)[0] ?? null
  );
}

export function pullIfNeeded(
  accountsAndTransfers: AccountsAndTransfers,
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
) {
  // If we are before today, we don't need to pull any money
  if (isBefore(currDate, new Date())) {
    return;
  }
  for (const account of accountsAndTransfers.accounts) {
    if (account.type === 'Checking' && account.pullPriority === -1 && account.performPulls) {
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
        const amountNeeded = Math.abs(balanceMap[account.id] - (account.minimumBalance ?? 0)) + 2000;
        const availableAmount = Math.min(
          amountNeeded,
          balanceMap[pullableAccount.id] - (pullableAccount.minimumBalance ?? 0),
        );

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
          flag: false,
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

export function payPullTaxes(
  accountsAndTransfers: AccountsAndTransfers,
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
) {
  for (const account of accountsAndTransfers.accounts) {
    // Create a map of source account ids to their taxable amounts
    const taxableMap: Record<string, number> = {};
    const priorNewYear = dayjs(currDate).subtract(1, 'year').set('month', 0).set('date', 1).toDate();
    const priorEndOfYear = dayjs(currDate).subtract(1, 'year').set('month', 11).set('date', 31).toDate();
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
        taxableMap[sourceAccount.id] += (activity.amount as number) * (sourceAccount.withdrawalTaxRate || 0);
        if (sourceAccount.earlyWithdrawlDate && isBefore(activity.date, sourceAccount.earlyWithdrawlDate)) {
          taxableMap[sourceAccount.id] += (activity.amount as number) * (sourceAccount.earlyWithdrawlPenalty || 0);
        }
      }
    }
    Object.entries(taxableMap).forEach(([accountId, amount]) => {
      if (amount > 0) {
        const fromAccount = getById<Account>(accountsAndTransfers.accounts, accountId);
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
          flag: false,
        });
        taxActivity.balance = balanceMap[account.id] - amount;
        balanceMap[account.id] -= amount;
        account.consolidatedActivity.splice(idxMap[account.id], 0, taxActivity);
        idxMap[account.id]++;
      }
    });
  }
}
