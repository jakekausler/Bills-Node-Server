import { AccountsAndTransfers } from '../../data/account/types';
import { Pension } from '../../data/retirement/pension/pension';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate, isAfterOrSame } from '../date/date';
import { getYearlyIncomes } from './helpers';

export function handlePension(
  accountsAndTransfers: AccountsAndTransfers,
  pensions: Pension[],
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
) {
  pensions.forEach((pension) => {
    // Add the pension pay once per month starting when the pension begins
    if (isAfterOrSame(currDate, pension.startDate) && currDate.getDate() === pension.startDate.getDate()) {
      const payToAccount = accountsAndTransfers.accounts.find((acc) => acc.name === pension.payToAcccount);
      if (!payToAccount) {
        throw new Error(`Pay to account ${pension.payToAcccount} not found`);
      }
      if (!pension.highestCompensationAverage) {
        pension.highestCompensationAverage = getHighestCompensationAverage(accountsAndTransfers, pension);
        pension.monthlyPay =
          (pension.highestCompensationAverage * pension.accrualFactor * pension.yearsWorked * pension.reductionFactor) /
          12;
      }
      if (!pension.monthlyPay) {
        throw new Error(`Monthly pay not set for pension ${pension.payToAcccount}`);
      }
      const activity = new ConsolidatedActivity({
        id: 'PENSION',
        name: pension.name,
        amount: pension.monthlyPay,
        amountIsVariable: false,
        amountVariable: null,
        date: formatDate(currDate),
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        isTransfer: false,
        category: 'Income.Retirement',
        flag: false,
      });
      balanceMap[payToAccount.id] += pension.monthlyPay;
      activity.balance = balanceMap[payToAccount.id];
      payToAccount.consolidatedActivity.splice(idxMap[payToAccount.id], 0, activity);
      idxMap[payToAccount.id]++;
    }
  });
}

function getHighestCompensationAverage(accountsAndTransfers: AccountsAndTransfers, pension: Pension) {
  // Get the income gained each year
  const yearlyAmounts = getYearlyIncomes(accountsAndTransfers, pension);

  // Calculate 4-year averages
  const averageConsecutiveYearPays: number[] = [];
  for (let i = 0; i <= yearlyAmounts.length - 4; i++) {
    const fourYearSum = yearlyAmounts.slice(i, i + 4).reduce((sum, curr) => sum + curr.amount, 0);
    averageConsecutiveYearPays.push(fourYearSum / 4);
  }

  // Return highest average, or 0 if no valid averages
  return averageConsecutiveYearPays.length > 0 ? Math.max(...averageConsecutiveYearPays) : 0;
}
