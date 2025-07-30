import { Request } from 'express';
import { getData, getSelectedSimulations } from '../../utils/net/request';
import { getById } from '../../utils/array/array';
import { Account } from '../../data/account/account';
import { loadGraph } from '../../utils/graph/graph';
import { GraphData } from '../../utils/graph/types';

/**
 * Generates graph data for a specific account
 * @param request - Express request object containing account ID in params and date range in query
 * @returns Graph data for the specified account over the requested date range
 */
export async function getAccountGraph(request: Request) {
  const data = await getData(request);
  const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
  return loadGraph({ accounts: [account], transfers: { activity: [], bills: [] } }, data.startDate, data.endDate);
}

/**
 * Generates graph data for multiple accounts across multiple simulations
 * @param request - Express request object containing selected accounts and simulations in query parameters
 * @returns Object mapping simulation names to their corresponding graph data
 */
export async function getGraphForAccounts(request: Request) {
  const selectedSimulations = getSelectedSimulations(request, ['Default']);
  const simulationGraphs: Record<string, GraphData> = {};

  for (const simulation of selectedSimulations) {
    request.query.simulation = simulation;
    const data = await getData(request);
    const selectedAccounts = data.selectedAccounts;

    // Use selected accounts or all non-hidden accounts if none specified
    const accounts = selectedAccounts.length > 0
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
