import { AccountsAndTransfers } from '../../data/account/types';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate, isAfterOrSame } from '../date/date';
import { getYearlyIncomes } from './helpers';
import { loadAverageWageIndex } from '../io/averageWageIndex';
import { loadBendPoints } from '../io/bendPoints';

export function handleSocialSecurity(
  accountsAndTransfers: AccountsAndTransfers,
  socialSecurities: SocialSecurity[],
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
) {
  socialSecurities.forEach((socialSecurity) => {
    // Add the social security pay once per month starting when the social security begins
    if (
      isAfterOrSame(currDate, socialSecurity.startDate) &&
      currDate.getDate() === socialSecurity.startDate.getDate()
    ) {
      const payToAccount = accountsAndTransfers.accounts.find((acc) => acc.name === socialSecurity.payToAcccount);
      if (!payToAccount) {
        throw new Error(`Pay to account ${socialSecurity.payToAcccount} not found`);
      }
      if (!socialSecurity.monthlyPay) {
        socialSecurity.monthlyPay = computeMonthlyBenefit(accountsAndTransfers, socialSecurity);
      }
      if (!socialSecurity.monthlyPay) {
        throw new Error(`Monthly pay not set for social security ${socialSecurity.payToAcccount}`);
      }
      const activity = new ConsolidatedActivity({
        id: 'SOCIAL-SECURITY',
        name: socialSecurity.name,
        amount: socialSecurity.monthlyPay,
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
      balanceMap[payToAccount.id] += socialSecurity.monthlyPay;
      activity.balance = balanceMap[payToAccount.id];
      payToAccount.consolidatedActivity.splice(idxMap[payToAccount.id], 0, activity);
      idxMap[payToAccount.id]++;
    }
  });
}

function calculateAIME(accountsAndTransfers: AccountsAndTransfers, socialSecurity: SocialSecurity) {
  const yearlyAmounts = getYearlyIncomes(accountsAndTransfers, socialSecurity);
  const indexedAnnualIncomes = getIndexedAnnualIncomes(socialSecurity.yearTurn60, yearlyAmounts);
  while (indexedAnnualIncomes.length < 35) {
    indexedAnnualIncomes.push(0);
  }
  return indexedAnnualIncomes.reduce((sum, curr) => sum + curr, 0) / 35 / 12;
}

function getIndexedAnnualIncomes(yearTurn60: number, yearlyIncomes: { year: number; amount: number }[]) {
  const averageWageIndex = getAverageWageIndex(yearTurn60);
  const indexedAnnualIncomes: number[] = [];
  yearlyIncomes.forEach(({ year, amount }) => {
    if (year > yearTurn60) {
      // For years after the year the person turns 60, we use the raw income
      indexedAnnualIncomes.push(amount);
    } else {
      // For years before the year the person turns 60, we base the indexed income on the average wage index for the year the person turns 60
      const indexedEarnings = (amount * averageWageIndex[yearTurn60]) / averageWageIndex[year];
      indexedAnnualIncomes.push(indexedEarnings);
    }
  });
  return indexedAnnualIncomes;
}

function getAverageWageIndex(yearTurn60: number) {
  // Load everything we have data for
  const averageWageIndex = loadAverageWageIndex();
  // Extrapolate the average indices until the year the person turns 60 using the average rate of increase of all the years we have data for
  const highestYear = Math.max(...Object.keys(averageWageIndex).map((x) => parseInt(x)));
  const years = Object.keys(averageWageIndex)
    .map((x) => parseInt(x))
    .sort((a, b) => a - b);
  const increases: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const year = years[i];
    const prevYear = years[i - 1];
    const increase = (averageWageIndex[year] - averageWageIndex[prevYear]) / averageWageIndex[prevYear];
    increases.push(increase);
  }
  const averageIncrease = increases.reduce((sum, val) => sum + val, 0) / increases.length;
  for (let year = highestYear + 1; year <= yearTurn60; year++) {
    averageWageIndex[year] = averageWageIndex[year - 1] * (1 + averageIncrease);
  }
  return averageWageIndex;
}

function getBendPoints(yearTurns62: number) {
  // Load the bend points we have data for
  const bendPoints = loadBendPoints();
  // Extrapolate the bend points until the year the person turns 62 using the average rate of increase of all the years we have data for
  const highestYear = Math.max(...Object.keys(bendPoints).map((x) => parseInt(x)));
  const years = Object.keys(bendPoints)
    .map((x) => parseInt(x))
    .sort((a, b) => a - b);
  const firstBendPointIncreases: number[] = [];
  const secondBendPointIncreases: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const year = years[i];
    const prevYear = years[i - 1];
    const firstIncrease = (bendPoints[year].first - bendPoints[prevYear].first) / bendPoints[prevYear].first;
    const secondIncrease = (bendPoints[year].second - bendPoints[prevYear].second) / bendPoints[prevYear].second;
    firstBendPointIncreases.push(firstIncrease);
    secondBendPointIncreases.push(secondIncrease);
  }
  const firstBendPointAverageIncrease =
    firstBendPointIncreases.reduce((sum, val) => sum + val, 0) / firstBendPointIncreases.length;
  const secondBendPointAverageIncrease =
    secondBendPointIncreases.reduce((sum, val) => sum + val, 0) / secondBendPointIncreases.length;
  for (let year = highestYear + 1; year <= yearTurns62; year++) {
    bendPoints[year] = {
      first: bendPoints[year - 1].first * (1 + firstBendPointAverageIncrease),
      second: bendPoints[year - 1].second * (1 + secondBendPointAverageIncrease),
    };
  }
  return bendPoints;
}

function computePIA(yearTurns62: number, aime: number) {
  const bendPoints = getBendPoints(yearTurns62);
  const firstBendPoint = bendPoints[yearTurns62].first;
  const secondBendPoint = bendPoints[yearTurns62].second;
  const firstAmount = Math.min(aime, firstBendPoint);
  aime -= firstAmount;
  const secondAmount = Math.min(aime, secondBendPoint);
  aime -= secondAmount;
  return firstAmount * 0.9 + secondAmount * 0.32 + aime * 0.15;
}

function factorForCollectionAge(collectionAge: number) {
  if (collectionAge < 62) {
    return 0;
  }
  if (collectionAge === 62) {
    return 0.7;
  }
  if (collectionAge === 63) {
    return 0.75;
  }
  if (collectionAge === 64) {
    return 0.8;
  }
  if (collectionAge === 65) {
    return 0.8666666667;
  }
  if (collectionAge === 66) {
    return 0.9333333333;
  }
  if (collectionAge === 67) {
    return 1;
  }
  if (collectionAge === 68) {
    return 1.08;
  }
  if (collectionAge === 69) {
    return 1.16;
  }
  return 1.24;
}

function computeMonthlyBenefit(accountsAndTransfers: AccountsAndTransfers, socialSecurity: SocialSecurity) {
  const aime = calculateAIME(accountsAndTransfers, socialSecurity);
  const pia = computePIA(socialSecurity.yearTurn60 + 2, aime);
  const factor = factorForCollectionAge(socialSecurity.collectionAge);
  return pia * factor;
}
