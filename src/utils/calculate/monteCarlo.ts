import { Account } from '../../data/account/account';
import { AccountsAndTransfers } from '../../data/account/types';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { calculateAllActivity } from './calculate';
import { loadYearlyGraph } from '../graph/graph';
import { getMinDate } from '../date/date';
import { endTiming, startTiming } from '../log';

function cloneAccountsAndTransfers(accountsAndTransfers: AccountsAndTransfers): AccountsAndTransfers {
  startTiming(cloneAccountsAndTransfers);
  const clone = {
    accounts: accountsAndTransfers.accounts.map((account) => new Account(account.serialize())),
    transfers: {
      activity: accountsAndTransfers.transfers.activity.map((activity) => new Activity(activity.serialize())),
      bills: accountsAndTransfers.transfers.bills.map((bill) => new Bill(bill.serialize())),
    },
  };
  endTiming(cloneAccountsAndTransfers);
  return clone;
}

function runSimulations(
  accountsAndTransfers: AccountsAndTransfers,
  nSimulations: number,
  startDate: Date,
  endDate: Date,
  simulation: string,
) {
  const minDate = getMinDate(accountsAndTransfers);

  // results[year][account] = [min for each simulation]
  const results: Record<string, Record<string, number[]>> = {};
  startTiming(runSimulations);
  for (let i = 0; i < nSimulations; i++) {
    console.log('Simulation', i);
    const accountsAndTransfersClone = cloneAccountsAndTransfers(accountsAndTransfers);
    calculateAllActivity(accountsAndTransfersClone, startDate, endDate, simulation, true);
    const yearlyGraph = loadYearlyGraph(accountsAndTransfersClone, startDate, endDate, minDate);
    yearlyGraph.labels.forEach((year, idx) => {
      for (const dataset of yearlyGraph.datasets) {
        const account = dataset.label;
        const minBalance = dataset.data[idx];
        if (!results[year]) {
          results[year] = {};
        }
        if (!results[year][account]) {
          results[year][account] = [];
        }
        results[year][account].push(minBalance);
      }
    });
  }
  endTiming(runSimulations);
  return results;
}

function calculatePercentiles(results: Record<string, Record<string, number[]>>): {
  [year: string]: {
    [account: string]: {
      median: number;
      lowerQuartile: number;
      upperQuartile: number;
      min: number;
      max: number;
      percentiles: number[];
    };
  };
} {
  startTiming(calculatePercentiles);
  const percentiles = Object.keys(results).reduce((acc, year) => {
    acc[year] = Object.keys(results[year]).reduce((acc, account) => {
      const values = results[year][account];
      values.sort((a, b) => a - b);
      const median = Math.round(values[Math.floor(values.length / 2)] * 100) / 100;
      const lowerQuartile = Math.round(values[Math.floor(values.length / 4)] * 100) / 100;
      const upperQuartile = Math.round(values[Math.floor((values.length * 3) / 4)] * 100) / 100;
      const min = Math.round(values[0] * 100) / 100;
      const max = Math.round(values[values.length - 1] * 100) / 100;
      const percentiles: number[] = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((percentile) => {
        return Math.round(values[Math.floor(values.length * percentile)] * 100) / 100;
      });
      acc[account] = { median, lowerQuartile, upperQuartile, min, max, percentiles };
      return acc;
    }, {});
    return acc;
  }, {});
  endTiming(calculatePercentiles);
  return percentiles;
}

function createDatasets(
  percentileData: {
    [year: string]: {
      [account: string]: {
        median: number;
        lowerQuartile: number;
        upperQuartile: number;
        min: number;
        max: number;
        percentiles: number[];
      };
    };
  },
  accountsAndTransfers: AccountsAndTransfers,
  selectedAccounts: string[],
) {
  startTiming(createDatasets);
  const colors = [
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFF00',
    '#00FFFF',
    '#FF00FF',
    '#C0C0C0',
    '#808080',
    '#800000',
    '#808000',
    '#008000',
  ];

  const datasets: { label: string; data: number[]; borderColor: string; backgroundColor: string }[] = [];
  let colorsIdx = 0;
  accountsAndTransfers.accounts.forEach((account) => {
    if (!selectedAccounts.includes(account.id)) {
      return;
    }
    const color = colors[colorsIdx % colors.length];
    datasets.push({
      label: account.name + ' Max',
      data: Object.keys(percentileData).map((year) => percentileData[year][account.name].max),
      borderColor: color,
      backgroundColor: color,
    });
    datasets.push({
      label: account.name + ' Upper Quartile',
      data: Object.keys(percentileData).map((year) => percentileData[year][account.name].upperQuartile),
      borderColor: color,
      backgroundColor: color,
    });
    datasets.push({
      label: account.name + ' Median',
      data: Object.keys(percentileData).map((year) => percentileData[year][account.name].median),
      borderColor: color,
      backgroundColor: color,
    });
    datasets.push({
      label: account.name + ' Lower Quartile',
      data: Object.keys(percentileData).map((year) => percentileData[year][account.name].lowerQuartile),
      borderColor: color,
      backgroundColor: color,
    });
    datasets.push({
      label: account.name + ' Min',
      data: Object.keys(percentileData).map((year) => percentileData[year][account.name].min),
      borderColor: color,
      backgroundColor: color,
    });
    colorsIdx += 1;
  });

  endTiming(createDatasets);
  return datasets;
}

const createGraph = (
  accountsAndTransfers: AccountsAndTransfers,
  results: Record<string, Record<string, number[]>>,
  percentileData: {
    [year: string]: {
      [account: string]: {
        median: number;
        lowerQuartile: number;
        upperQuartile: number;
        min: number;
        max: number;
        percentiles: number[];
      };
    };
  },
  selectedAccounts: string[],
) => {
  startTiming(createGraph);
  const datasets = createDatasets(percentileData, accountsAndTransfers, selectedAccounts);
  const graph = {
    labels: Object.keys(results),
    datasets,
  };
  endTiming(createGraph);
  return graph;
};

export function monteCarlo(
  accountsAndTransfers: AccountsAndTransfers,
  nSimulations: number,
  startDate: Date,
  endDate: Date,
  simulation: string,
  selectedAccounts: string[],
) {
  startTiming(monteCarlo);
  // For each simulation, we need to:
  // 1. Create a new accountsAndTransfers object
  // 2. Perform the calculations for the simulation
  // 3. Store the minimum balance for each simulation, for each year, for each account
  // 4. Create percentiles for each year, for each account
  // 5. Store the results
  const results = runSimulations(accountsAndTransfers, nSimulations, startDate, endDate, simulation);
  const percentileData = calculatePercentiles(results);
  const graph = createGraph(accountsAndTransfers, results, percentileData, selectedAccounts);
  endTiming(monteCarlo);
  return graph;
}
