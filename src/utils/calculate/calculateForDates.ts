import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { setupCalculation } from './helpers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';
import { isBeforeOrSame, isAfter } from '../date/date';
import { handleInterest, payInterestTaxes } from './interest';
import { retrieveBalances } from './balances';
import { handlePension } from './pension';
import { handleSocialSecurity } from './socialSecurity';
import { handleMonthlyPushesAndPulls, payPullTaxes } from './pullsAndPushes';
import { performRMD } from './rmd';
import { Interest } from '../../data/interest/interest';
import { startTiming, endTiming, initProgressBar, stopProgressBar, incrementProgressBar } from '../log';
import { InvestmentAccount } from '../../data/investment/investment';
import { setFuturePrices, handleInvestment } from './investment';

export async function calculateActivitiesForDates(
  accountsAndTransfers: AccountsAndTransfers,
  investmentAccounts: InvestmentAccount[],
  startDate: Date | null,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean,
  simulationNumber: number,
  nSimulations: number,
  subCalculation: boolean = false,
  balanceMap: Record<string, number> | null = null,
  idxMap: Record<string, number> | null = null,
  interestIdxMap: Record<string, number> | null = null,
  interestMap: Record<string, Interest | null> | null = null,
  nextInterestMap: Record<string, Date | null> | null = null,
  // Map of symbols to date to price
  historicalPrices: Record<string, Record<string, number>> | null = null,
  // Map of account ids to map of current share amount of each stock
  stockAmounts: Record<string, Record<string, number>> | null = null,
  // Map of symbols to expected growth
  stockExpectedGrowths: Record<string, number> | null = null,
  // Map of investment account id to index of activity in investment account
  investmentActivityIdxMap: Record<string, number> | null = null,
) {
  startTiming(calculateActivitiesForDates);
  let currDate = startDate;
  if (!subCalculation) {
    ({
      currDate,
      idxMap,
      balanceMap,
      interestIdxMap,
      interestMap,
      nextInterestMap,
      historicalPrices,
      stockAmounts,
      stockExpectedGrowths,
      investmentActivityIdxMap,
    } = await setupCalculation(accountsAndTransfers, investmentAccounts, startDate));
  }
  if (!subCalculation) {
    initProgressBar(dayjs(endDate).diff(dayjs(currDate), 'day'), currDate, simulationNumber - 1, nSimulations);
  }
  if (!currDate) {
    throw new Error('currDate is null');
  }
  if (!balanceMap) {
    throw new Error('balanceMap is null');
  }
  if (!idxMap) {
    throw new Error('idxMap is null');
  }
  if (!interestIdxMap) {
    throw new Error('interestIdxMap is null');
  }
  if (!interestMap) {
    throw new Error('interestMap is null');
  }
  if (!nextInterestMap) {
    throw new Error('nextInterestMap is null');
  }
  if (!historicalPrices) {
    throw new Error('historicalPrices is null');
  }
  if (!stockAmounts) {
    throw new Error('stockAmounts is null');
  }
  if (!stockExpectedGrowths) {
    throw new Error('stockExpectedGrowths is null');
  }
  if (!investmentActivityIdxMap) {
    throw new Error('investmentActivityIdxMap is null');
  }
  const { pensions, socialSecurities } = loadPensionsAndSocialSecurity(simulation);
  while (isBeforeOrSame(currDate, endDate)) {
    setFuturePrices(currDate, historicalPrices, stockExpectedGrowths);
    if (!subCalculation) {
      incrementProgressBar(currDate);
    }
    if (!subCalculation && currDate.getDate() === 1) {
      await handleMonthlyPushesAndPulls(
        accountsAndTransfers,
        investmentAccounts,
        currDate,
        balanceMap,
        idxMap,
        interestIdxMap,
        interestMap,
        nextInterestMap,
        historicalPrices,
        stockAmounts,
        stockExpectedGrowths,
        investmentActivityIdxMap,
        simulation,
        monteCarlo,
        simulationNumber,
        nSimulations,
      );
    }

    for (const account of accountsAndTransfers.accounts) {
      if (account.type === 'Investment') {
        handleInvestment(
          account,
          investmentAccounts,
          currDate,
          balanceMap,
          idxMap,
          historicalPrices,
          stockAmounts,
          investmentActivityIdxMap,
        );
      }
      handleInterest(
        account,
        currDate,
        simulation,
        interestIdxMap,
        interestMap,
        nextInterestMap,
        balanceMap,
        idxMap,
        monteCarlo,
      );
      retrieveBalances(
        account,
        accountsAndTransfers.accounts,
        currDate,
        idxMap,
        balanceMap,
        historicalPrices,
        stockAmounts,
      );
    }

    handlePension(accountsAndTransfers, pensions, currDate, balanceMap, idxMap);
    handleSocialSecurity(accountsAndTransfers, socialSecurities, currDate, balanceMap, idxMap);

    if (currDate.getMonth() === 3 && currDate.getDate() === 1 && isAfter(currDate, new Date())) {
      payPullTaxes(accountsAndTransfers, currDate, balanceMap, idxMap);
      payInterestTaxes(accountsAndTransfers, currDate, balanceMap, idxMap);
    }

    if (currDate.getMonth() === 11 && currDate.getDate() === 31) {
      performRMD(accountsAndTransfers, currDate, balanceMap, idxMap);
    }

    currDate = dayjs(currDate).add(1, 'day').toDate();
  }
  if (!subCalculation) {
    stopProgressBar();
  }
  endTiming(calculateActivitiesForDates);
}
