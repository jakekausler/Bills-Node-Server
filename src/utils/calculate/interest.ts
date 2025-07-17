import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AccountsAndTransfers } from '../../data/account/types';
import { Account } from '../../data/account/account';
import { getById } from '../array/array';
import { formatDate, isAfter, isBefore, isSame } from '../date/date';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { compoundInterest, Interest } from '../../data/interest/interest';
import { nextDate } from './helpers';
import { v4 as uuidv4 } from 'uuid';
import { Portfolio, Rates } from './types';
import { load } from '../io/io';

dayjs.extend(utc);

export function payInterestTaxes(
  accountsAndTransfers: AccountsAndTransfers,
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
) {
  // Create a map of the ids of accounts which gain interest to the account id of the account that will pay the taxes and the amount that is taxable
  const taxableMap: Record<string, { payee: string; amount: number }> = {};
  for (const account of accountsAndTransfers.accounts) {
    if (account.interestPayAccount) {
      const interestPayAccount = accountsAndTransfers.accounts.find((acc) => acc.name === account.interestPayAccount);
      if (!interestPayAccount) {
        throw new Error(`Interest pay account ${account.interestPayAccount} not found`);
      }
      const priorNewYear = dayjs.utc(currDate).subtract(1, 'year').set('date', 0).set('month', 0).toDate();
      const priorEndOfYear = dayjs.utc(currDate).subtract(1, 'year').set('date', 30).set('month', 11).toDate();
      // Loop backward through the account's consolidated activity array until we are before the prior year
      for (let i = account.consolidatedActivity.length - 1; i >= 0; i--) {
        const activity = account.consolidatedActivity[i];
        if (isBefore(activity.date, priorNewYear)) {
          break;
        }
        if (isAfter(activity.date, priorEndOfYear)) {
          continue;
        }
        if (activity.category === 'Banking.Interest') {
          if (!taxableMap[account.id]) {
            taxableMap[account.id] = { payee: interestPayAccount.id, amount: 0 };
          }
          taxableMap[account.id].amount += (activity.amount as number) * (account.interestTaxRate || 0);
        }
      }
    }
  }
  Object.entries(taxableMap).forEach(([accountId, { payee, amount }]) => {
    if (amount > 0) {
      const fromAccount = getById<Account>(accountsAndTransfers.accounts, accountId);
      if (!fromAccount) {
        throw new Error(`Account ${accountId} not found`);
      }
      const taxActivity = new ConsolidatedActivity({
        id: 'TAX',
        name: `Tax for Interest from ${fromAccount.name}`,
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
        flag: true,
        flagColor: 'orange',
      });
      const payeeAccount = getById<Account>(accountsAndTransfers.accounts, payee);
      if (!payeeAccount) {
        throw new Error(`Payee account ${payee} not found`);
      }
      taxActivity.balance = balanceMap[payeeAccount.id] - amount;
      balanceMap[payeeAccount.id] -= amount;
      payeeAccount.consolidatedActivity.splice(idxMap[payeeAccount.id], 0, taxActivity);
      idxMap[payeeAccount.id]++;
    }
  });
}

export function handleInterest(
  account: Account,
  currDate: Date,
  simulation: string,
  interestIdxMap: Record<string, number>,
  interestMap: Record<string, Interest | null>,
  nextInterestMap: Record<string, Date | null>,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
  monteCarlo: boolean,
) {
  // Nothing to do if there is no interest
  if (!interestMap[account.id]) return;

  if (
    // If there is a next interest
    interestIdxMap[account.id] + 1 < account.interests.length &&
    // And the next interest applicable date is the current date
    account.interests[interestIdxMap[account.id] + 1].applicableDate === currDate
  ) {
    // Update the interest and next date interest will be applied
    interestIdxMap[account.id] += 1;
    interestMap[account.id] = account.interests[interestIdxMap[account.id]];
    nextInterestMap[account.id] = interestMap[account.id]?.applicableDate ?? null;
  }
  // If the next date interest will be applied is the current date, we need to add an interest activity
  if (isSame(nextInterestMap[account.id] as Date, currDate)) {
    // if (account.name === 'Mortgage') {
    //   console.log('currDate', currDate);
    //   console.log('nextInterestMap[account.id]', nextInterestMap[account.id]);
    // }
    // Create the interest activity
    const activity = (interestMap[account.id] as Interest).toActivity(
      uuidv4(),
      simulation,
      compoundInterest(
        balanceMap[account.id],
        getRate(
          currDate.getFullYear(),
          interestMap[account.id]?.apr as number,
          interestMap[account.id]?.aprVariable as string | null,
          monteCarlo,
        ),
        interestMap[account.id]?.compounded as 'day' | 'week' | 'month' | 'year',
      ),
      currDate,
    );
    activity.flag = true;
    activity.flagColor = (activity.amount as number) < 0 ? 'pink' : 'lime';
    // if (account.name === 'Kendall 401(k)') {
    //   console.log(
    //     `${formatDate(currDate)} Interest Rate ${getRate(
    //       currDate.getFullYear(),
    //       interestMap[account.id]?.apr as number,
    //       interestMap[account.id]?.aprVariable as string | null,
    //       monteCarlo,
    //     )}, which compounds ${activity.amount as number} applied to ${account.name} with balance ${
    //       balanceMap[account.id]
    //     } = ${activity.amount}, increasing balance to ${balanceMap[account.id] + (activity.amount as number)}`,
    //   );
    // }

    // Check if the interest activity is not zero
    if (activity.amount !== 0) {
      // Insert the interest activity into the consolidated activity array at the current index
      const interest = new ConsolidatedActivity(activity.serialize(), {
        interestId: (interestMap[account.id] as Interest).id,
      });
      // if (account.name === 'Mortgage') {
      //   console.log('activity', activity.serialize());
      //   console.log('consolidatedActivity', interest.serialize());
      // }
      account.consolidatedActivity.splice(idxMap[account.id], 0, interest);

      // Check if this is the first interest for the interest's applicable date
      if (isSame(interestMap[account.id]?.applicableDate as Date, currDate)) {
        account.consolidatedActivity[idxMap[account.id]].firstInterest = true;
      }

      // Update the balance with the interest's amount
      balanceMap[account.id] += activity.amount as number;
      account.consolidatedActivity[idxMap[account.id]].balance = balanceMap[account.id];

      idxMap[account.id] += 1;
    }

    nextInterestMap[account.id] = nextDate(
      nextInterestMap[account.id] as Date,
      (interestMap[account.id] as Interest).compounded,
      1,
    );
  }
}

let RATES: Rates | null = null;
let PORTFOLIO: Portfolio | null = null;

let YEAR_RATES: {
  [year: number]: {
    [rate: string]: number;
  };
} | null = null;
let YEAR_INVESTMENT_RATES: {
  [year: number]: {
    [rate: string]: number;
  };
} | null = null;

export function loadRatesToYears(startYear: number, endYear: number) {
  if (!RATES) {
    RATES = load('historicRates.json');
  }
  if (!PORTFOLIO) {
    PORTFOLIO = load('portfolioMakeupOverTime.json');
  }
  YEAR_RATES = {};
  YEAR_INVESTMENT_RATES = {};
  if (!RATES) {
    throw new Error('Rates not loaded');
  }
  for (let year = startYear; year <= endYear; year++) {
    setYearInvestmentRates(year);
    YEAR_RATES[year] = {
      HIGH_YIELD_SAVINGS_RATE:
        RATES.savings.highYield[Math.floor(Math.random() * RATES.savings.highYield.length)] / 100,
      LOW_YIELD_SAVINGS_RATE: RATES.savings.lowYield[Math.floor(Math.random() * RATES.savings.lowYield.length)] / 100,
      INVESTMENT_RATE: calculateInvestmentRate(year),
    };
  }
  // // Calculate and log the average investment rate across all years
  // const avgInvestmentRate =
  //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates.INVESTMENT_RATE, 0) /
  //   Object.keys(YEAR_RATES).length;
  // console.log(`Average investment rate across years ${startYear}-${endYear}: ${(avgInvestmentRate * 100).toFixed(2)}%`);
  // const avgHighYieldSavingsRate =
  //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates.HIGH_YIELD_SAVINGS_RATE, 0) /
  //   Object.keys(YEAR_RATES).length;
  // console.log(
  //   `Average high yield savings rate across years ${startYear}-${endYear}: ${(avgHighYieldSavingsRate * 100).toFixed(
  //     2,
  //   )}%`,
  // );
  // const avgLowYieldSavingsRate =
  //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates.LOW_YIELD_SAVINGS_RATE, 0) /
  //   Object.keys(YEAR_RATES).length;
  // console.log(
  //   `Average low yield savings rate across years ${startYear}-${endYear}: ${(avgLowYieldSavingsRate * 100).toFixed(
  //     2,
  //   )}%`,
  // );
  // console.log(JSON.stringify(YEAR_RATES, null, 2));
  // console.log(JSON.stringify(YEAR_INVESTMENT_RATES, null, 2));
}

function setYearInvestmentRates(year: number) {
  if (!RATES) {
    throw new Error('Rates not loaded');
  }
  if (!YEAR_INVESTMENT_RATES) {
    YEAR_INVESTMENT_RATES = {};
  }
  YEAR_INVESTMENT_RATES[year] = {
    STOCK: RATES.investment.stock[Math.floor(Math.random() * RATES.investment.stock.length)] / 100,
    BOND: RATES.investment.bond[Math.floor(Math.random() * RATES.investment.bond.length)] / 100,
  };
  if (!Array.isArray(RATES.investment.preferred)) {
    YEAR_INVESTMENT_RATES[year].PREFERRED =
      RATES.investment.preferred.proxy.stock * YEAR_INVESTMENT_RATES[year].STOCK +
      RATES.investment.preferred.proxy.bond * YEAR_INVESTMENT_RATES[year].BOND;
  } else {
    YEAR_INVESTMENT_RATES[year].PREFERRED =
      RATES.investment.preferred[Math.floor(Math.random() * RATES.investment.preferred.length)] / 100;
  }
  if (!Array.isArray(RATES.investment.convertible)) {
    YEAR_INVESTMENT_RATES[year].CONVERTIBLE =
      RATES.investment.convertible.proxy.stock * YEAR_INVESTMENT_RATES[year].STOCK +
      RATES.investment.convertible.proxy.bond * YEAR_INVESTMENT_RATES[year].BOND;
  } else {
    YEAR_INVESTMENT_RATES[year].CONVERTIBLE =
      RATES.investment.convertible[Math.floor(Math.random() * RATES.investment.convertible.length)] / 100;
  }
  if (!Array.isArray(RATES.investment.other)) {
    YEAR_INVESTMENT_RATES[year].OTHER =
      RATES.investment.other.proxy.stock * YEAR_INVESTMENT_RATES[year].STOCK +
      RATES.investment.other.proxy.bond * YEAR_INVESTMENT_RATES[year].BOND;
  } else {
    YEAR_INVESTMENT_RATES[year].OTHER =
      RATES.investment.other[Math.floor(Math.random() * RATES.investment.other.length)] / 100;
  }
  if (!Array.isArray(RATES.investment.cash)) {
    YEAR_INVESTMENT_RATES[year].CASH =
      RATES.investment.cash.proxy.stock * YEAR_INVESTMENT_RATES[year].STOCK +
      RATES.investment.cash.proxy.bond * YEAR_INVESTMENT_RATES[year].BOND;
  } else {
    YEAR_INVESTMENT_RATES[year].CASH =
      RATES.investment.cash[Math.floor(Math.random() * RATES.investment.cash.length)] / 100;
  }
}

function calculateInvestmentRate(year: number) {
  if (!RATES) {
    throw new Error('Rates not loaded');
  }
  if (!PORTFOLIO) {
    throw new Error('Portfolio not loaded');
  }
  if (!YEAR_INVESTMENT_RATES) {
    throw new Error('Year investment rates not set');
  }
  const startYears = Object.keys(PORTFOLIO);
  if (startYears.length === 0) {
    throw new Error('No portfolio data found');
  }
  let startYear = parseInt(startYears[0]);
  for (let i = 1; i < startYears.length; i++) {
    if (year >= parseInt(startYears[i])) {
      startYear = parseInt(startYears[i]);
    }
  }
  const portfolio = PORTFOLIO[startYear];
  let rate = 0;
  // console.log(year);
  for (const [asset, weight] of Object.entries(portfolio)) {
    rate += weight * YEAR_INVESTMENT_RATES[year][asset.toUpperCase()];
    // console.log(
    //   `${asset}: ${weight} * ${YEAR_INVESTMENT_RATES[year][asset.toUpperCase()]} = ${
    //     weight * YEAR_INVESTMENT_RATES[year][asset.toUpperCase()]
    //   }`,
    // );
  }
  // console.log('rate', rate);
  // console.log('--------------------------------');
  // console.log(`Rate for year ${year}: ${rate}`);
  return rate;
  // // Generate a random number with a normal-like distribution centered around 5
  // const rand = Math.random();
  // let rate;

  // if (rand < 0.1) {
  //   // 10% chance for low values
  //   rate = -10 + Math.random() * 5; // Between -10 and -5
  // } else if (rand > 0.9) {
  //   // 10% chance for high values
  //   rate = 8 + Math.random() * 2; // Between 8 and 10
  // } else {
  //   // 80% chance for values around 5
  //   rate = 2 + Math.random() * 6; // Between 2 and 8, clustering around 5
  // }

  // return rate / 100;
}

function getRate(year: number, apr: number, aprVariable: string | null, monteCarlo: boolean) {
  if (!monteCarlo || !aprVariable) {
    return apr;
  }
  if (!YEAR_RATES) {
    throw new Error('Year rates not loaded');
  }
  if (!(year in YEAR_RATES) || !(aprVariable in YEAR_RATES[year])) {
    console.warn(`Unknown rate variable: ${aprVariable}`);
    return apr;
  }
  return YEAR_RATES[year][aprVariable];
}
