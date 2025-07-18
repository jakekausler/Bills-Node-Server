import { AccountsAndTransfers } from '../../data/account/types';

/**
 * Calculates money movement across all accounts for the specified date range
 * @param accountsAndTransfers - The complete financial data structure
 * @param startDate - Start date for the movement calculation
 * @param endDate - End date for the movement calculation
 * @returns Movement data organized by year and account
 */
export function getMoneyMovement(accountsAndTransfers: AccountsAndTransfers, startDate: Date, endDate: Date): Movement {
  const movement: Movement = {};
  for (let i = startDate.getUTCFullYear(); i <= endDate.getUTCFullYear(); i++) {
    movement[i] = {};
    accountsAndTransfers.accounts.forEach((account) => {
      movement[i][account.name] = 0;
    });
  }
  accountsAndTransfers.accounts.forEach((account) => {
    account.consolidatedActivity.forEach((activity) => {
      if (activity.date.getUTCFullYear() in movement) {
        movement[activity.date.getUTCFullYear()][account.name] += activity.amount as number;
      }
    });
  });
  return movement;
}

/**
 * Data structure representing money movement organized by year and account
 */
export type Movement = {
  [year: number]: {
    [accountId: string]: number;
  };
};

/**
 * Chart-ready data structure for visualizing money movement
 */
export type MovementChartData = {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
  }[];
};

/**
 * Converts movement data into chart-ready format for visualization
 * @param movement - Raw movement data organized by year and account
 * @returns Chart data with labels and datasets for each account
 */
export function getMoneyMovementChartData(movement: Movement): MovementChartData {
  const labels = Object.keys(movement).map((year) => year.toString());
  const datasets = Object.keys(movement[parseInt(Object.keys(movement)[0])]).map((accountName) => {
    return {
      label: accountName,
      data: Object.keys(movement).map((year) => movement[parseInt(year)][accountName]),
    };
  });
  return {
    labels,
    datasets,
  };
}
