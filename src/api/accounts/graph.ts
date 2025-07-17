import { Request } from 'express';
import { getData, getSelectedSimulations } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { Account } from '../../data/account/account';
import { loadGraph } from '../../utils/graph/graph';
import { GraphData } from '../../utils/graph/types';

export function getAccountGraph(request: Request) {
  const data = getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return loadGraph({ accounts: [account], transfers: { activity: [], bills: [] } }, data.startDate, data.endDate);
}

export function getGraphForAccounts(request: Request) {
  const selectedSimulations = getSelectedSimulations(request, ['Default']);
  const simulationGraphs: Record<string, GraphData> = {};
  for (const simulation of selectedSimulations) {
    request.query.simulation = simulation;
    const data = getData(request);
    const selectedAccounts = data.selectedAccounts;
    const accounts =
      selectedAccounts.length > 0
        ? selectedAccounts.map((accountId: string) => getById<Account>(data.accountsAndTransfers.accounts, accountId))
        : data.accountsAndTransfers.accounts.filter((account: Account) => !account.hidden);
    simulationGraphs[simulation] = loadGraph(
      { accounts, transfers: { activity: [], bills: [] } },
      data.startDate,
      data.endDate,
    );
  }
  return simulationGraphs;
}
