import { Account, todayBalance } from '../../data/account/account';
import { AccountsAndTransfers } from '../../data/account/types';
import { formatDate, isSame } from '../date/date';
import { dealWithOtherTransfers } from './transfers';
import { dealWithSpecialFractions } from './transfers';
import { startTiming, endTiming } from '../log';

export function retrieveBalances(
  account: Account,
  accounts: Account[],
  currDate: Date,
  idxMap: Record<string, number>,
  balanceMap: Record<string, number>,
  historicalPrices: Record<string, Record<string, number>>,
  stockAmounts: Record<string, Record<string, number>>,
) {
  startTiming(retrieveBalances);
  while (
    // While we are still within the bounds of the consolidated activity array
    idxMap[account.id] < account.consolidatedActivity.length
  ) {
    // And the date of the activity is the current date
    if (!isSame(account.consolidatedActivity[idxMap[account.id]]?.date, currDate)) {
      break;
    }
    const removed = dealWithSpecialFractions(account, accounts, idxMap, balanceMap);
    if (!removed) {
      dealWithOtherTransfers(account, accounts, idxMap, balanceMap);
      updateBalanceMap(account, balanceMap, idxMap, historicalPrices, stockAmounts, currDate);
      updateInvestmentActivityValues(account, idxMap, historicalPrices, stockAmounts, currDate);
      idxMap[account.id] += 1;
    }
  }
  endTiming(retrieveBalances);
}

function updateInvestmentActivityValues(
  account: Account,
  idxMap: Record<string, number>,
  historicalPrices: Record<string, Record<string, number>>,
  stockAmounts: Record<string, Record<string, number>>,
  currDate: Date,
) {
  const activity = account.consolidatedActivity[idxMap[account.id]];
  const previousActivity = account.consolidatedActivity[idxMap[account.id] - 1];
  if (!activity.investmentValue && previousActivity && previousActivity.investmentValue) {
    if (account.name === 'Fidelity Money Market') {
      // console.log('Updating investment value for ', account.name, 'on ', formatDate(currDate));
      // console.log('Previous ', previousActivity.investmentValue, previousActivity.name);
      // console.log('Old ', activity.investmentValue, activity.name);
    }
    activity.stockAmounts = previousActivity.stockAmounts;
    activity.stockValues = Object.fromEntries(
      Object.entries(activity.stockAmounts).map(([symbol, amount]) => [
        symbol,
        historicalPrices[symbol][formatDate(currDate)] * amount,
      ]),
    );
    activity.investmentValue = Object.values(activity.stockValues).reduce((a, b) => a + b, 0);
    if (account.name === 'Fidelity Money Market') {
      // console.log('New ', activity.investmentValue, activity.name);
    }
  } else if (activity.investmentValue && account.name === 'Fidelity Money Market') {
    // console.log('No update needed for ', account.name, 'on ', formatDate(currDate));
    // console.log('Current ', activity.investmentValue, activity.name);
  }
}

function updateBalanceMap(
  account: Account,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
  historicalPrices: Record<string, Record<string, number>>,
  stockAmounts: Record<string, Record<string, number>>,
  currDate: Date,
) {
  const activity = account.consolidatedActivity[idxMap[account.id]];
  balanceMap[account.id] += activity.amount as number;
  activity.balance = balanceMap[account.id];
}

export function retrieveTodayBalances(accountsAndTransfers: AccountsAndTransfers, startDate: Date, endDate: Date) {
  startTiming(retrieveTodayBalances);
  for (const account of accountsAndTransfers.accounts) {
    account.todayBalance = todayBalance(account);
    account.consolidatedActivity = account.consolidatedActivity.filter(
      (activity) => activity.date >= startDate && activity.date <= endDate,
    );
  }
  endTiming(retrieveTodayBalances);
}
