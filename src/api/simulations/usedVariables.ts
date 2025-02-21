import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadUsedVariables } from '../../utils/simulation/loadUsedVariables';

export async function getUsedVariables(request: Request) {
  const data = await getData(request);
  return loadUsedVariables(data.accountsAndTransfers, data.socialSecurities, data.pensions);
}
