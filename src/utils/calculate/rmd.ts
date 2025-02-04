import { RMD_TABLE, setRMDTable } from '../io/cache';
import { load } from '../io/io';
import { RMDTableType } from './types';
import { AccountsAndTransfers } from '../../data/account/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';
import dayjs from 'dayjs';

export function performRMD(
  accountsAndTransfers: AccountsAndTransfers,
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
) {
  for (const account of accountsAndTransfers.accounts) {
    if (account.usesRMD) {
      const ownerDob = account.accountOwnerDOB;
      if (!ownerDob) {
        continue;
      }
      const age = dayjs(currDate).diff(ownerDob, 'year');
      const rmdAmount = rmd(balanceMap[account.id], age);
      if (rmdAmount <= 0) {
        continue;
      }

      const toAccount = accountsAndTransfers.accounts.find((acc) => acc.name === account.RMDAccount);
      if (!toAccount) {
        throw new Error(`Account ${account.RMDAccount} not found`);
      }

      balanceMap[account.id] -= rmdAmount;
      balanceMap[toAccount.id] += rmdAmount;

      const activityFrom = new ConsolidatedActivity({
        id: 'RMD',
        name: 'RMD from ' + account.name,
        amount: -rmdAmount,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(currDate),
        dateIsVariable: false,
        dateVariable: null,
        from: account.name,
        to: account.RMDAccount,
        isTransfer: true,
        category: 'Ignore.Transfer',
        flag: false,
      });

      const activityTo = new ConsolidatedActivity({
        ...activityFrom.serialize(),
        amount: rmdAmount,
      });

      activityFrom.balance = balanceMap[account.id];
      activityTo.balance = balanceMap[toAccount.id];

      account.consolidatedActivity.splice(idxMap[account.id], 0, activityFrom);
      toAccount.consolidatedActivity.splice(idxMap[toAccount.id], 0, activityTo);

      idxMap[account.id]++;
      idxMap[toAccount.id]++;
    }
  }
}

function loadRMD() {
  if (Object.keys(RMD_TABLE).length === 0) {
    setRMDTable(Object.fromEntries(Object.entries(load<RMDTableType>('rmd.json')).map(([k, v]) => [parseInt(k), v])));
  }
}

function rmd(balance: number, age: number) {
  loadRMD();
  if (age in RMD_TABLE) {
    return balance / RMD_TABLE[age];
  }
  return 0;
}
