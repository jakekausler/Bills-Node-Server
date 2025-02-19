import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { setupCalculation } from './helpers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';
import { isBeforeOrSame, isAfter, formatDate } from '../date/date';
import { handleInterest, payInterestTaxes } from './interest';
import { retrieveBalances } from './balances';
import { handlePension } from './pension';
import { handleSocialSecurity } from './socialSecurity';
import { handleMonthlyPushesAndPulls, payPullTaxes } from './pullsAndPushes';
import { performRMD } from './rmd';
import { Interest } from '../../data/interest/interest';

export function calculateActivitiesForDates(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date | null,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean,
  subCalculation: boolean = false,
  balanceMap: Record<string, number> | null = null,
  idxMap: Record<string, number> | null = null,
  interestIdxMap: Record<string, number> | null = null,
  interestMap: Record<string, Interest | null> | null = null,
  nextInterestMap: Record<string, Date | null> | null = null,
) {
  let currDate = startDate;
  if (!subCalculation) {
    ({ currDate, idxMap, balanceMap, interestIdxMap, interestMap, nextInterestMap } = setupCalculation(
      accountsAndTransfers,
      startDate,
    ));
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
  const { pensions, socialSecurities } = loadPensionsAndSocialSecurity(simulation);
  while (isBeforeOrSame(currDate, endDate)) {
    if (!subCalculation && currDate.getDate() === 1) {
      handleMonthlyPushesAndPulls(
        accountsAndTransfers,
        currDate,
        balanceMap,
        idxMap,
        interestIdxMap,
        interestMap,
        nextInterestMap,
        simulation,
        monteCarlo,
      );
    }

    for (const account of accountsAndTransfers.accounts) {
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
      retrieveBalances(account, accountsAndTransfers.accounts, currDate, idxMap, balanceMap);
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
}
