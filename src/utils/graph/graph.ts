import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { formatDate, getMinDate, isSame } from '../date/date';
import {
  GraphData,
  YearBalances,
  MinMax,
  YearlyDataset,
  ActivityDataset,
  YearlyGraphData,
  ActivityGraphData,
  ActivityNameAndAmount,
} from './types';
import { endTiming, startTiming } from '../log';

const MAX_DAYS_FOR_ACTIVITY = 365 * 10;

export function loadGraph(accountsAndTransfers: AccountsAndTransfers, startDate: Date, endDate: Date): GraphData {
  const minDate = getMinDate(accountsAndTransfers);
  if (
    (endDate.getTime() - Math.max(startDate.getTime(), minDate.getTime())) / (1000 * 60 * 60 * 24) >
    MAX_DAYS_FOR_ACTIVITY
  ) {
    return loadYearlyGraph(accountsAndTransfers, startDate, endDate, minDate);
  } else {
    return loadActivityGraph(accountsAndTransfers, startDate, endDate, minDate);
  }
}

export function loadYearlyGraph(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  minDate: Date,
): YearlyGraphData {
  startTiming(loadYearlyGraph);
  const labels: string[] = [];
  let currDate = minDate;
  const yearBalance: YearBalances = {};
  let currentYear = 0;
  const balanceMap: Record<string, number> = {};
  const idxMap: Record<string, number> = {};
  for (const acc of accountsAndTransfers.accounts) {
    balanceMap[acc.id] = 0;
    idxMap[acc.id] = 0;
    yearBalance[acc.id] = {};
  }

  while (currDate.getTime() <= endDate.getTime()) {
    if (currDate.getTime() < startDate.getTime()) {
      // Skip dates before start_date
      currDate = dayjs(currDate).add(1, 'day').toDate();
      continue;
    }

    // Add new year to labels
    if (currDate.getFullYear() !== currentYear) {
      labels.push(formatDate(currDate));
      currentYear = currDate.getFullYear();
      for (const acc of accountsAndTransfers.accounts) {
        yearBalance[acc.id][currentYear] = null;
      }
    }

    // Update balances for each account
    for (const acc of accountsAndTransfers.accounts) {
      const activity: number[] = [];
      while (
        // While there are more activities for this account
        idxMap[acc.id] < acc.consolidatedActivity.length &&
        // And the current activity is for the current date
        isSame(acc.consolidatedActivity[idxMap[acc.id]].date, currDate)
      ) {
        // Add the activity to the list
        activity.push(
          acc.consolidatedActivity[idxMap[acc.id]].balance + acc.consolidatedActivity[idxMap[acc.id]].investmentValue,
        );
        // Move to the next activity
        idxMap[acc.id]++;
      }
      if (activity.length > 0) {
        if (yearBalance[acc.id][currentYear] === null) {
          yearBalance[acc.id][currentYear] = [activity[activity.length - 1], activity[activity.length - 1]];
        } else {
          yearBalance[acc.id][currentYear] = [
            Math.min((yearBalance[acc.id][currentYear] as MinMax)[0], activity[activity.length - 1]),
            Math.max((yearBalance[acc.id][currentYear] as MinMax)[1], activity[activity.length - 1]),
          ];
        }
      }
    }
    currDate = dayjs(currDate).add(1, 'day').toDate();
  }
  const datasets: YearlyDataset[] = [];
  for (const acc of accountsAndTransfers.accounts) {
    // Only send the minimum balance
    datasets.push({
      label: acc.name,
      data: Object.values(yearBalance[acc.id]).map((year) => (year ? year[0] : 0)),
    });
  }
  endTiming(loadYearlyGraph);
  return { type: 'yearly', labels, datasets };
}

function loadActivityGraph(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  minDate: Date,
): ActivityGraphData {
  let labels: string[] = [];
  const datasets: ActivityDataset[] = accountsAndTransfers.accounts.map((acc) => ({
    label: acc.name,
    data: [],
    activity: [],
  }));
  let currDate = minDate;
  const idxMap: Record<string, number> = {};
  const balanceMap: Record<string, number> = {};

  for (const acc of accountsAndTransfers.accounts) {
    idxMap[acc.id] = 0;
    balanceMap[acc.id] = 0;
  }

  while (currDate.getTime() <= endDate.getTime()) {
    if (currDate.getTime() < startDate.getTime()) {
      currDate = dayjs(currDate).add(1, 'day').toDate();
      continue;
    }

    labels.push(formatDate(currDate));

    for (let a = 0; a < accountsAndTransfers.accounts.length; a++) {
      const acc = accountsAndTransfers.accounts[a];
      const activity: ActivityNameAndAmount[] = [];
      while (
        // While there are more activities for this account
        idxMap[acc.id] < acc.consolidatedActivity.length &&
        // And the current activity is for the current date
        isSame(acc.consolidatedActivity[idxMap[acc.id]].date, currDate)
      ) {
        // Add the activity to the list
        activity.push({
          name: acc.consolidatedActivity[idxMap[acc.id]].name,
          amount: acc.consolidatedActivity[idxMap[acc.id]].amount as number,
        });
        balanceMap[acc.id] = Math.round(acc.consolidatedActivity[idxMap[acc.id]].balance * 100) / 100;
        // Move to the next activity
        idxMap[acc.id]++;
      }
      datasets[a].data.push(balanceMap[acc.id]);
      datasets[a].activity.push(activity);
    }
    currDate = dayjs(currDate).add(1, 'day').toDate();
  }

  // Remove empty days
  const toRemove: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (i > 0 && i < labels.length - 1 && datasets[0].activity[i].length === 0) {
      toRemove.push(i);
    }
  }
  for (let i = toRemove.length - 1; i >= 0; i--) {
    labels.splice(toRemove[i], 1);
    for (let a = 0; a < datasets.length; a++) {
      datasets[a].data.splice(toRemove[i], 1);
      datasets[a].activity.splice(toRemove[i], 1);
    }
  }
  // Remove the first day if it is empty, but only if there is more than 1 day
  if (labels.length > 1 && datasets[0].activity[0].length === 0) {
    labels.shift();
    for (let a = 0; a < datasets.length; a++) {
      datasets[a].data.shift();
      datasets[a].activity.shift();
    }
  }
  return { type: 'activity', labels, datasets };
}
