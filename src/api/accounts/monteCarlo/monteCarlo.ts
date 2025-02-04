import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { monteCarlo as monteCarloCalculation } from '../../../utils/calculate/monteCarlo';

export function monteCarlo(req: Request) {
  const data = getData(req);
  const accountsAndTransfers = data.accountsAndTransfers;
  const nSimulations = parseFloat(req.query.nSimulations as string);
  // const startDate = data.startDate;
  // const endDate = data.endDate;
  const simulation = data.simulation;
  const useExistingSimulations = req.query.useExistingSimulations === 'true';
  const selectedAccounts = data.selectedAccounts;
  const results = monteCarloCalculation(
    accountsAndTransfers,
    nSimulations,
    // startDate,
    // endDate,
    simulation,
    useExistingSimulations,
    selectedAccounts,
  );
  return results;
}
