import { Request } from 'express';
import { getData } from '../../utils/net/request';

export async function getFlow(request: Request) {
  const data = await getData(request);
  return {};
  // return loadFlow(data.accountsAndTransfers, data.selectedAccounts, data.startDate, data.endDate);
}
