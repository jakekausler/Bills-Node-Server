import { Request } from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Account, todayBalance } from '../../data/account/account';
import { AccountData } from '../../data/account/types';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { getData } from '../../utils/net/request';
import { parseDate, formatDate } from '../../utils/date/date';
import { DateString } from '../../utils/date/types';
import { Interest } from '../../data/interest/interest';
import type { InterestData } from '../../data/interest/types';

export function loadPortfolioConfigs(): Record<string, any> {
  try {
    const configPath = join(process.cwd(), 'data', 'accountPortfolioConfigs.json');
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function savePortfolioConfigs(configs: Record<string, any>): void {
  const configPath = join(process.cwd(), 'data', 'accountPortfolioConfigs.json');
  writeFileSync(configPath, JSON.stringify(configs, null, 2));
}

/**
 * Retrieves simplified account data for all accounts
 * @param request - Express request object containing user authentication
 * @returns Array of simplified account objects
 */
export async function getSimpleAccounts(request: Request) {
  const data = await getData(request, {
    defaultStartDate: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
  });
  const configs = loadPortfolioConfigs();
  return data.accountsAndTransfers.accounts.map((account) => {
    const simpleAccount = account.simpleAccount();
    simpleAccount.balance = todayBalance(account);
    (simpleAccount as any).portfolioConfig = configs[account.id] ?? null;
    return simpleAccount;
  });
}

/**
 * Adds a new account to the system
 * @param request - Express request object containing account data
 * @returns ID of the newly created account
 */
export async function addAccount(request: Request) {
  const data = await getData<AccountData>(request);
  data.accountsAndTransfers.accounts.push(new Account(data.data, data.simulation));
  saveData(data.accountsAndTransfers);
  return data.accountsAndTransfers.accounts[data.accountsAndTransfers.accounts.length - 1].id;
}

/**
 * Updates basic account properties (name, type, hidden)
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateBasicAccountProperties(account: Account, newAccount: AccountData): void {
  if (newAccount.name !== account.name) {
    account.name = newAccount.name;
  }
  if (newAccount.type !== account.type) {
    account.type = newAccount.type;
  }
  if (newAccount.hidden !== account.hidden) {
    account.hidden = newAccount.hidden;
  }
  if (newAccount.defaultShowInGraph !== account.defaultShowInGraph) {
    account.defaultShowInGraph = newAccount.defaultShowInGraph ?? false;
  }
}

/**
 * Updates account tax and penalty settings
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateAccountTaxSettings(account: Account, newAccount: AccountData): void {
  if (newAccount.interestTaxRate !== account.interestTaxRate) {
    account.interestTaxRate = newAccount.interestTaxRate ?? 0;
  }
  if (newAccount.withdrawalTaxRate !== account.withdrawalTaxRate) {
    account.withdrawalTaxRate = newAccount.withdrawalTaxRate ?? 0;
  }
  if (newAccount.earlyWithdrawalPenalty !== account.earlyWithdrawalPenalty) {
    account.earlyWithdrawalPenalty = newAccount.earlyWithdrawalPenalty ?? 0;
  }
  if (newAccount.earlyWithdrawalDate !== account.earlyWithdrawalDate) {
    account.earlyWithdrawalDate = newAccount.earlyWithdrawalDate ? parseDate(newAccount.earlyWithdrawalDate as DateString) : null;
  }
  if (newAccount.interestAppliesToPositiveBalance !== account.interestAppliesToPositiveBalance) {
    account.interestAppliesToPositiveBalance = newAccount.interestAppliesToPositiveBalance ?? account.interestAppliesToPositiveBalance;
  }
}

/**
 * Updates account pull/push configuration
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateAccountPullPushSettings(account: Account, newAccount: AccountData): void {
  if (newAccount.pullPriority !== account.pullPriority) {
    account.pullPriority = newAccount.pullPriority ?? -1;
  }
  if (newAccount.minimumBalance !== account.minimumBalance) {
    account.minimumBalance = newAccount.minimumBalance ?? null;
  }
  if (newAccount.maximumBalance !== account.maximumBalance) {
    account.maximumBalance = newAccount.maximumBalance ?? null;
  }
  if (newAccount.minimumPullAmount !== account.minimumPullAmount) {
    account.minimumPullAmount = newAccount.minimumPullAmount ?? null;
  }
  if (newAccount.performsPulls !== account.performsPulls) {
    account.performsPulls = newAccount.performsPulls || false;
  }
  if (newAccount.performsPushes !== account.performsPushes) {
    account.performsPushes = newAccount.performsPushes || false;
  }
  if (newAccount.pushStart !== undefined) {
    account.pushStart = newAccount.pushStart ? parseDate(newAccount.pushStart as DateString) : null;
  }
  if (newAccount.pushEnd !== undefined) {
    account.pushEnd = newAccount.pushEnd ? parseDate(newAccount.pushEnd as DateString) : null;
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
function updateRetirementSettings(account: Account, newAccount: AccountData): void {
  if (newAccount.interestPayAccount !== account.interestPayAccount) {
    account.interestPayAccount = newAccount.interestPayAccount || null;
  }
  if (newAccount.usesRMD !== account.usesRMD) {
    account.usesRMD = newAccount.usesRMD || false;
  }
  if (newAccount.accountOwnerDOB !== undefined) {
    account.accountOwnerDOB = newAccount.accountOwnerDOB ? parseDate(newAccount.accountOwnerDOB as DateString) : null;
  }
  if (newAccount.rmdAccount !== account.rmdAccount) {
    account.rmdAccount = newAccount.rmdAccount || null;
  }
}

/**
 * Updates fields that were previously missing from the update handler
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateMissingFields(account: Account, newAccount: AccountData): void {
  if (newAccount.person !== undefined && newAccount.person !== account.person) {
    account.person = newAccount.person;
  }
  if (newAccount.rothOpenDate !== undefined) {
    const existingRothDateStr = account.rothOpenDate ? formatDate(account.rothOpenDate) : null;
    if (newAccount.rothOpenDate !== existingRothDateStr) {
      account.rothOpenDate = newAccount.rothOpenDate ? parseDate(newAccount.rothOpenDate as DateString) : null;
    }
  }
  if (newAccount.contributionLimitType !== undefined && newAccount.contributionLimitType !== account.contributionLimitType) {
    account.contributionLimitType = newAccount.contributionLimitType ?? null;
  }
  if (newAccount.expenseRatio !== undefined && newAccount.expenseRatio !== account.expenseRatio) {
    account.expenseRatio = newAccount.expenseRatio ?? 0;
  }
}

/**
 * Updates a single account with new data
 * @param account - Current account instance
 * @param newAccount - New account data
 */
function updateSingleAccount(account: Account, newAccount: AccountData, simulation: string = 'Default'): void {
  updateBasicAccountProperties(account, newAccount);
  updateAccountTaxSettings(account, newAccount);
  updateAccountPullPushSettings(account, newAccount);
  updateRetirementSettings(account, newAccount);
  updateMissingFields(account, newAccount);

  // Replace interests if provided in the update payload
  if (newAccount.interests !== undefined) {
    account.interests = newAccount.interests
      .map((interest) => new Interest(interest, simulation))
      .sort((a, b) => a.applicableDate.getTime() - b.applicableDate.getTime());
  }

  // Update portfolio config if provided
  if ((newAccount as any).portfolioConfig !== undefined) {
    const configs = loadPortfolioConfigs();
    const portfolioConfig = (newAccount as any).portfolioConfig;
    if (portfolioConfig === null || !portfolioConfig.glidePath) {
      // Remove portfolio config when set to null (use interest-based rates)
      delete configs[account.id];
    } else {
      configs[account.id] = portfolioConfig;
    }
    savePortfolioConfigs(configs);
  }
}

/**
 * Updates multiple accounts with new data
 * @param request - Express request object containing account updates
 * @returns Updated accounts array
 */
export async function updateAccounts(request: Request) {
  const data = await getData<AccountData[]>(request);

  data.accountsAndTransfers.accounts.forEach((account) => {
    const newAccount = data.data.find((a) => a.id === account.id);
    if (newAccount) {
      updateSingleAccount(account, newAccount, data.simulation);
    }
  });

  saveData(data.accountsAndTransfers);
  return data.accountsAndTransfers.accounts;
}
