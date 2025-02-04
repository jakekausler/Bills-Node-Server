import { Request } from 'express';
import { getData } from '../../utils/net/request';

export function getFlow(request: Request) {
	const data = getData(request);
	return {};
	// return loadFlow(data.accountsAndTransfers, data.selectedAccounts, data.startDate, data.endDate);
}
