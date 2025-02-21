import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { formatDate, getMinDate, isAfter, isBeforeOrSame } from '../date/date';
import { Interest } from '../../data/interest/interest';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { InvestmentAccount } from '../../data/investment/investment';
import { getHistory } from '../stocks/stocks';
import cliProgress from 'cli-progress';

export function nextDate(date: Date, period: string, nPeriods: number) {
  if (period.startsWith('day')) {
    return dayjs(date).add(nPeriods, 'day').toDate();
  } else if (period.startsWith('week')) {
    return dayjs(date)
      .add(nPeriods * 7, 'day')
      .toDate();
  } else if (period.startsWith('month')) {
    return dayjs(date).add(nPeriods, 'month').toDate();
  } else if (period.startsWith('year')) {
    return dayjs(date).add(nPeriods, 'year').toDate();
  } else {
    throw new Error(`Invalid period: ${period}`);
  }
}

export async function setupCalculation(
  accountsAndTransfers: AccountsAndTransfers,
  investmentAccounts: InvestmentAccount[],
  startDate: Date | null = null,
) {
  let currDate = startDate;
  if (!currDate) {
    // The earliest date that any activity, bill, or interest starts
    currDate = getMinDate(accountsAndTransfers, investmentAccounts);
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
  // A map of investment account id to index of activity in investment account
  const investmentActivityIdxMap: Record<string, number> = {};
  const tickers = getTickers(investmentAccounts);
  const { historicalPrices, expectedGrowths } = await getHistoricalPrices(tickers, currDate);
  const stockAmounts: Record<string, Record<string, number>> = {};
  investmentAccounts.forEach((account) => {
    stockAmounts[account.id] = {};
    for (const ticker of tickers) {
      stockAmounts[account.id][ticker] = 0;
    }
  });
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
  for (const account of investmentAccounts) {
    investmentActivityIdxMap[account.id] = 0;
  }
  return {
    currDate,
    idxMap,
    balanceMap,
    interestIdxMap,
    interestMap,
    nextInterestMap,
    historicalPrices,
    stockAmounts,
    stockExpectedGrowths: expectedGrowths,
    investmentActivityIdxMap,
  };
}

export function getTickers(investmentAccounts: InvestmentAccount[]) {
  const tickers = new Set<string>();
  for (const account of investmentAccounts) {
    for (const share of account.shares) {
      tickers.add(share.symbol);
    }
    for (const target of account.targets) {
      if (!target.isCustomFund) {
        tickers.add(target.symbol);
      } else {
        target.customMakeup.forEach((fund) => {
          tickers.add(fund.symbol);
        });
      }
    }
    for (const activity of account.activity) {
      tickers.add(activity.symbol);
    }
  }
  return Array.from(tickers);
}

const START_FOR_HISTORICAL_PRICES = dayjs('2022-01-01');

export async function getHistoricalPrices(tickers: string[], startDate: Date) {
  const historicalPrices: Record<string, Record<string, number>> = {};
  const expectedGrowths: Record<string, number> = {};
  const progress = new cliProgress.SingleBar({
    format: `Progress |{bar}| {percentage}% | {ticker}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  });
  progress.start(tickers.length, 0, { ticker: '' });
  for (const ticker of tickers) {
    progress.increment();
    progress.update({ ticker });
    historicalPrices[ticker] = {};
    const history = await getHistory(ticker, START_FOR_HISTORICAL_PRICES.toDate(), new Date());
    let sumOfDailyChanges = 0;
    let count = 0;
    let lastPrice: number | null = null;
    let lastDate: Date | null = startDate;
    for (const quote of history.quotes) {
      // Get the average gain/loss percentage over the last 20 years, but only keep a cache
      // of the actual historical prices since the start date.
      if (isAfter(quote.date, startDate)) {
        // Fill in any skipped days between lastDate and current quote date with the last known price
        if (lastDate) {
          let currDate = dayjs(lastDate).add(1, 'day').toDate();
          while (isBeforeOrSame(currDate, quote.date)) {
            historicalPrices[ticker][formatDate(currDate)] = lastPrice ?? 0;
            currDate = dayjs(currDate).add(1, 'day').toDate();
          }
        }
      }
      if (lastPrice !== null && quote.adjclose) {
        sumOfDailyChanges += Math.log(quote.adjclose / lastPrice);
        count++;
      }
      lastPrice = quote.adjclose ?? lastPrice;
      lastDate = quote.date;
    }
    // Fill in any remaining days up to today with the last known price
    if (lastDate && lastPrice !== null) {
      let currDate = dayjs(lastDate).add(1, 'day').toDate();
      const today = new Date();
      while (isBeforeOrSame(currDate, today)) {
        historicalPrices[ticker][formatDate(currDate)] = lastPrice;
        currDate = dayjs(currDate).add(1, 'day').toDate();
      }
    }
    const averageDailyChange = sumOfDailyChanges / count || 0;
    expectedGrowths[ticker] = Math.exp((averageDailyChange * 252) / 365.24) - 1;
  }
  progress.stop();
  return { historicalPrices, expectedGrowths };
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
          const year = dayjs(activity.date).year();
          annualIncomes[year] = (annualIncomes[year] || 0) + (activity.amount as number);
        });
    });

  // Convert to array of years and amounts
  const yearlyAmounts = Object.entries(annualIncomes)
    .map(([year, amount]) => ({ year: parseInt(year), amount }))
    .sort((a, b) => a.year - b.year);

  return yearlyAmounts;
}
