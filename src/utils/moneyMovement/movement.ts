import { AccountsAndTransfers } from '../../data/account/types';

export function getMoneyMovement(accountsAndTransfers: AccountsAndTransfers, startDate: Date, endDate: Date): Movement {
  const movement: Movement = {};
  for (let i = startDate.getFullYear(); i <= endDate.getFullYear(); i++) {
    movement[i] = {};
    accountsAndTransfers.accounts.forEach((account) => {
      movement[i][account.name] = 0;
    });
  }
  accountsAndTransfers.accounts.forEach((account) => {
    account.consolidatedActivity.forEach((activity) => {
      if (activity.date.getFullYear() in movement) {
        movement[activity.date.getFullYear()][account.name] += typeof activity.amount === 'number' ? activity.amount : 0;
      }
    });
  });
  return movement;
}

export type Movement = {
  [year: number]: {
    [accountId: string]: number;
  };
};

export type MovementChartData = {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
  }[];
};

export function getMoneyMovementChartData(movement: Movement): MovementChartData {
  const labels = Object.keys(movement).map((year) => year.toString());
  const firstYear = Object.keys(movement)[0];
  const datasets = Object.keys(movement[Number(firstYear)]).map((accountName) => {
    return {
      label: accountName,
      data: Object.keys(movement).map((year) => movement[Number(year)][accountName]),
    };
  });
  return {
    labels,
    datasets,
  };
}
