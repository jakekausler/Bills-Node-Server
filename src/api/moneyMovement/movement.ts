import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getMoneyMovement, getMoneyMovementChartData } from '../../utils/moneyMovement/movement';

export async function getMoneyMovementChart(req: Request) {
  const data = await getData(req);
  const startDate = data.startDate;
  const endDate = data.endDate;
  const accountsAndTransfers = data.accountsAndTransfers;
  const movement = getMoneyMovement(accountsAndTransfers, startDate, endDate);
  return getMoneyMovementChartData(movement);
}
