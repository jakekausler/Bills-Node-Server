import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getMoneyMovement, getMoneyMovementChartData } from '../../utils/moneyMovement/movement';

/**
 * Retrieves money movement data formatted for chart visualization
 *
 * This endpoint analyzes consolidated activity across all accounts to calculate
 * net money movement (income minus expenses) by year and account, then formats
 * the data for use in chart libraries.
 *
 * @param req - Express request object with optional query parameters
 * @returns Chart data object with labels and datasets for money movement visualization
 */
export async function getMoneyMovementChart(req: Request) {
  const data = await getData(req);
  const startDate = data.startDate;
  const endDate = data.endDate;
  const accountsAndTransfers = data.accountsAndTransfers;
  const movement = getMoneyMovement(accountsAndTransfers, startDate, endDate);
  return getMoneyMovementChartData(movement);
}
