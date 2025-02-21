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
      idxMap[account.id] += 1;
    }
  }
  endTiming(retrieveBalances);
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
  const previousActivity = account.consolidatedActivity[idxMap[account.id] - 1];
  if (!activity.investmentValue && previousActivity && previousActivity.investmentValue) {
    activity.stockAmounts = previousActivity.stockAmounts;
    activity.stockValues = Object.fromEntries(
      Object.entries(activity.stockAmounts).map(([symbol, amount]) => [
        symbol,
        historicalPrices[symbol][formatDate(currDate)] * amount,
      ]),
    );
    activity.investmentValue = Object.values(activity.stockValues).reduce((a, b) => a + b, 0);
  }
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
