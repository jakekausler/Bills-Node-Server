import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { addBills, loadRatesToYears as loadBillRatesToYears } from './bills';
import { addTransfers } from './transfers';
import { loadRatesToYears as loadInterestRatesToYears } from './interest';
import { retrieveTodayBalances } from './balances';
import { endTiming, startTiming } from '../log';
import { calculateActivitiesForDates } from './calculateForDates';
import { loadData } from '../io/portfolio';

export async function calculateAllActivity(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean = false,
  simulationNumber: number = 1,
  nSimulations: number = 1,
) {
  startTiming(calculateAllActivity);
  loadBillRatesToYears(startDate.getFullYear(), endDate.getFullYear());
  loadInterestRatesToYears(startDate.getFullYear(), endDate.getFullYear());
  addActivities(accountsAndTransfers, endDate, simulation, monteCarlo);
  await calculateActivities(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    nSimulations,
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

async function calculateActivities(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  simulation: string,
  monteCarlo: boolean = false,
  simulationNumber: number = 1,
  nSimulations: number = 1,
) {
  startTiming(calculateActivities);
  const investmentAccounts = loadData();
  await calculateActivitiesForDates(
    accountsAndTransfers,
    investmentAccounts,
    null,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    nSimulations,
    false,
    null,
    null,
    null,
    null,
    null,
  );
  retrieveTodayBalances(accountsAndTransfers, startDate, endDate);
  endTiming(calculateActivities);
}
