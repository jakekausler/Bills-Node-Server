import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AccountsAndTransfers } from '../../data/account/types';
import { getMinDate } from '../date/date';
import { Interest } from '../../data/interest/interest';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';

dayjs.extend(utc);

/**
 * Calculates the next date based on the period and number of periods
 * @param date - The date to calculate the next date from
 * @param period - The period to calculate the next date from
 * @param nPeriods - The number of periods to calculate the next date from
 * @returns The next date
 */
export function nextDate(date: Date, period: string, nPeriods: number) {
  if (period.startsWith('day')) {
    return dayjs.utc(date).add(nPeriods, 'day').toDate();
  } else if (period.startsWith('week')) {
    return dayjs
      .utc(date)
      .add(nPeriods * 7, 'day')
      .toDate();
  } else if (period.startsWith('month')) {
    return dayjs.utc(date).add(nPeriods, 'month').toDate();
  } else if (period.startsWith('year')) {
    return dayjs.utc(date).add(nPeriods, 'year').toDate();
  } else {
    throw new Error(`Invalid period: ${period}`);
  }
}

export function setupCalculation(accountsAndTransfers: AccountsAndTransfers, startDate: Date | null = null) {
  let currDate = startDate;
  if (!currDate) {
    // The earliest date that any activity, bill, or interest starts
    currDate = getMinDate(accountsAndTransfers);
  }
  // A map of account ids to their current index in their consolidated activity array
  const idxMap: Record<string, number> = {};
  // A map of account ids to their current balance
  const balanceMap: Record<string, number> = {};
  // A map of account ids to their current index in their interest array
  const interestIdxMap: Record<string, number> = {};
  // A map of account ids to their current interest
  const interestMap: Record<string, Interest | null> = {};
  // A map of account ids to their next date interest will be applied
  const nextInterestMap: Record<string, Date | null> = {};
  for (const account of accountsAndTransfers.accounts) {
    idxMap[account.id] = 0;
    balanceMap[account.id] = 0;
    interestIdxMap[account.id] = 0;
    interestMap[account.id] = null;
    nextInterestMap[account.id] = null;
    if (account.interests.length > 0) {
      interestMap[account.id] = account.interests[interestIdxMap[account.id]];
      nextInterestMap[account.id] = interestMap[account.id]?.applicableDate ?? null;
    }
  }
  return {
    currDate,
    idxMap,
    balanceMap,
    interestIdxMap,
    interestMap,
    nextInterestMap,
  };
}

export function getYearlyIncomes(accountsAndTransfers: AccountsAndTransfers, retirement: SocialSecurity | Pension) {
  // Get income from account activities
  let minDate = getMinDate(accountsAndTransfers);
  if (retirement instanceof Pension) {
    minDate = retirement.workStartDate;
  }
  const maxDate = retirement.startDate;

  // Initialize array to store annual incomes
  const annualIncomes: Record<number, number> = {};

  // Add prior annual incomes from pension data
  retirement.priorAnnualNetIncomeYears.forEach((year, index) => {
    annualIncomes[year] = retirement.priorAnnualNetIncomes[index];
  });

  // Process each relevant account
  accountsAndTransfers.accounts
    .filter((account) => retirement.paycheckAccounts.includes(account.name))
    .forEach((account) => {
      account.consolidatedActivity
        .filter(
          (activity) =>
            // Check if activity is within valid date range
            activity.date >= minDate &&
            activity.date <= maxDate &&
            // Check if activity matches paycheck criteria
            retirement.paycheckCategories.some((cat) => activity.category?.startsWith(cat)) &&
            retirement.paycheckNames.some((name) => activity.name?.includes(name)),
        )
        .forEach((activity) => {
          const year = dayjs.utc(activity.date).year();
          annualIncomes[year] = (annualIncomes[year] || 0) + (activity.amount as number);
        });
    });

  // Convert to array of years and amounts
  const yearlyAmounts = Object.entries(annualIncomes)
    .map(([year, amount]) => ({ year: parseInt(year), amount }))
    .sort((a, b) => a.year - b.year);

  return yearlyAmounts;
}
