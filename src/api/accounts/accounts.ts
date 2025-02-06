import { Request } from 'express';
import { Account } from '../../data/account/account';
import { AccountData } from '../../data/account/types';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { getData } from '../../utils/net/request';

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
        account.accountOwnerDOB = newAccount.accountOwnerDOB || null;
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
      if (newAccount.performsPullsAndPushes !== account.performsPullsAndPushes) {
        account.performsPullsAndPushes = newAccount.performsPullsAndPushes || false;
      }
      if (newAccount.pushStart !== account.pushStart) {
        account.pushStart = newAccount.pushStart || null;
      }
      if (newAccount.pushEnd !== account.pushEnd) {
        account.pushEnd = newAccount.pushEnd || null;
      }
      if (newAccount.pushAccount !== account.pushAccount) {
        account.pushAccount = newAccount.pushAccount || null;
      }
    }
  });
  saveData(data.accountsAndTransfers);
  return data.accountsAndTransfers.accounts;
}
