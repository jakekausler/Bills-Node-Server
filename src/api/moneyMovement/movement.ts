import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getMoneyMovement, getMoneyMovementChartData } from '../../utils/moneyMovement/movement';

export function getMoneyMovementChart(req: Request) {
  const data = getData(req);
  const startDate = data.startDate;
  const endDate = data.endDate;
  const accountsAndTransfers = data.accountsAndTransfers;
  const movement = getMoneyMovement(accountsAndTransfers, startDate, endDate);
  return getMoneyMovementChartData(movement);
}
