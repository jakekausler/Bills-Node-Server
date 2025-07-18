import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { addBills, loadRatesToYears as loadBillRatesToYears } from './bills';
import { addTransfers } from './transfers';
import { loadRatesToYears as loadInterestRatesToYears } from './interest';
import { retrieveTodayBalances } from './balances';
import { endTiming, startTiming } from '../log';
import { calculateActivitiesForDates } from './calculateForDates';
dayjs.extend(utc);
export function calculateAllActivity(accountsAndTransfers, startDate, endDate, simulation, monteCarlo = false, simulationNumber = 1, nSimulations = 1) {
    startTiming('calculateAllActivity');
    loadBillRatesToYears(startDate.getFullYear(), endDate.getFullYear());
    loadInterestRatesToYears(startDate.getFullYear(), endDate.getFullYear());
    addActivities(accountsAndTransfers, endDate, simulation, monteCarlo);
    calculateActivities(accountsAndTransfers, startDate, endDate, simulation, monteCarlo, simulationNumber, nSimulations);
    endTiming('calculateAllActivity');
}
function addActivities(accountsAndTransfers, endDate, simulation, monteCarlo = false) {
    startTiming('addActivities');
    for (const account of accountsAndTransfers.accounts) {
        startTiming('addActivitiesForAccount');
        for (const activity of account.activity) {
            account.consolidatedActivity.push(new ConsolidatedActivity(activity.serialize()));
        }
        addBills(account, account.bills, endDate, simulation, monteCarlo);
        addTransfers(account, endDate, simulation, accountsAndTransfers.transfers, monteCarlo);
        account.consolidatedActivity.sort((a, b) => {
            if (a.name === 'Opening Balance')
                return -1;
            if (b.name === 'Opening Balance')
                return 1;
            return dayjs.utc(a.date).diff(dayjs.utc(b.date));
        });
        endTiming('addActivitiesForAccount');
    }
    endTiming('addActivities');
}
function calculateActivities(accountsAndTransfers, startDate, endDate, simulation, monteCarlo = false, simulationNumber = 1, nSimulations = 1) {
    startTiming('calculateActivities');
    calculateActivitiesForDates(accountsAndTransfers, null, endDate, simulation, monteCarlo, simulationNumber, nSimulations, false, null, null, null, null, null);
    retrieveTodayBalances(accountsAndTransfers, startDate, endDate);
    endTiming('calculateActivities');
}
