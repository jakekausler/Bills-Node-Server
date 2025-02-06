import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { isAfter } from '../date/date';
import { performRMD } from './rmd';
import { loadPensionsAndSocialSecurity } from '../io/retirement';
import { addBills, loadRatesToYears as loadBillRatesToYears } from './bills';
import { addTransfers } from './transfers';
import { setupCalculation } from './helpers';
import { handlePension } from './pension';
import { handleSocialSecurity } from './socialSecurity';
import { payPullTaxes } from './pulls';
import { pullIfNeeded } from './pulls';
import { handleInterest, loadRatesToYears as loadInterestRatesToYears } from './interest';
import { payInterestTaxes } from './interest';
import { retrieveBalances } from './balances';
import { retrieveTodayBalances } from './balances';
import { endTiming, incrementProgressBar, initProgressBar, startTiming, stopProgressBar } from '../log';

export function calculateAllActivity(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean = false,
  simulationNumber: number = -1,
  maxSimulations: number = -1,
) {
  startTiming(calculateAllActivity);
  loadBillRatesToYears(startDate.getFullYear(), endDate.getFullYear());
  loadInterestRatesToYears(startDate.getFullYear(), endDate.getFullYear());
  addActivities(accountsAndTransfers, endDate, simulation, monteCarlo);
  calculateActivities(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    maxSimulations,
  );
  endTiming(calculateAllActivity);
}

function addActivities(
  accountsAndTransfers: AccountsAndTransfers,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean = false,
) {
  startTiming(addActivities);
  for (const account of accountsAndTransfers.accounts) {
    startTiming('addActivitiesForAccount');
    for (const activity of account.activity) {
      account.consolidatedActivity.push(new ConsolidatedActivity(activity.serialize()));
    }
    addBills(account, account.bills, endDate, simulation, monteCarlo);
    addTransfers(account, endDate, simulation, accountsAndTransfers.transfers, monteCarlo);
    account.consolidatedActivity.sort((a, b) => {
      if (a.name === 'Opening Balance') return -1;
      if (b.name === 'Opening Balance') return 1;
      return dayjs(a.date).diff(dayjs(b.date));
    });
    endTiming('addActivitiesForAccount');
  }
  endTiming(addActivities);
}

function calculateActivities(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean = false,
  simulationNumber: number,
  maxSimulations: number,
) {
  startTiming(calculateActivities);
  initProgressBar(dayjs(endDate).diff(dayjs(startDate), 'day'), simulationNumber, maxSimulations);
  let { currDate, idxMap, balanceMap, interestIdxMap, interestMap, nextInterestMap } =
    setupCalculation(accountsAndTransfers);
  const { pensions, socialSecurities } = loadPensionsAndSocialSecurity(simulation);
  while (currDate <= endDate) {
    incrementProgressBar();
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
    pullIfNeeded(accountsAndTransfers, currDate, balanceMap, idxMap);
    currDate = dayjs(currDate).add(1, 'day').toDate();
  }
  retrieveTodayBalances(accountsAndTransfers, startDate, endDate);
  stopProgressBar();
  endTiming(calculateActivities);
}
