import { Request } from 'express';
import { Account } from '../../data/account/account';
import { AccountData } from '../../data/account/types';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { getData } from '../../utils/net/request';
import { parseDate } from '../../utils/date/date';
import { DateString } from '../../utils/date/types';

export function getSimpleAccounts(request: Request) {
  const data = getData(request);
  return data.accountsAndTransfers.accounts.map((account) => account.simpleAccount());
}

export function addAccount(request: Request) {
  const data = getData<AccountData>(request);
  data.accountsAndTransfers.accounts.push(new Account(data.data, data.simulation));
  saveData(data.accountsAndTransfers);
  return data.accountsAndTransfers.accounts[data.accountsAndTransfers.accounts.length - 1].id;
}

export function updateAccounts(request: Request) {
  const data = getData<AccountData[]>(request);
  data.accountsAndTransfers.accounts.forEach((account) => {
    const newAccount = data.data.find((a) => a.id === account.id);
    if (newAccount) {
      if (newAccount.name !== account.name) {
        account.name = newAccount.name;
      }
      if (newAccount.type !== account.type) {
        account.type = newAccount.type;
      }
      if (newAccount.hidden !== account.hidden) {
        account.hidden = newAccount.hidden;
      }
      if (newAccount.pullPriority !== account.pullPriority) {
        account.pullPriority = newAccount.pullPriority || -1;
      }
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
      if (newAccount.interestPayAccount !== account.interestPayAccount) {
        account.interestPayAccount = newAccount.interestPayAccount || null;
      }
      if (newAccount.usesRMD !== account.usesRMD) {
        account.usesRMD = newAccount.usesRMD || false;
      }
      if (newAccount.accountOwnerDOB !== account.accountOwnerDOB) {
        account.accountOwnerDOB = parseDate(newAccount.accountOwnerDOB as DateString) || null;
      }
      if (newAccount.rmdAccount !== account.rmdAccount) {
        account.rmdAccount = newAccount.rmdAccount || null;
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
        account.pushStart = parseDate(newAccount.pushStart as DateString) || null;
      }
      if (newAccount.pushEnd !== account.pushEnd) {
        account.pushEnd = parseDate(newAccount.pushEnd as DateString) || null;
      }
      if (newAccount.pushAccount !== account.pushAccount) {
        account.pushAccount = newAccount.pushAccount || null;
      }
      if (newAccount.defaultShowInGraph !== account.defaultShowInGraph) {
        account.defaultShowInGraph = newAccount.defaultShowInGraph || false;
      }
    }
  });
  saveData(data.accountsAndTransfers);
  return data.accountsAndTransfers.accounts;
}
