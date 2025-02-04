import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadUsedVariables } from '../../utils/simulation/loadUsedVariables';

export function getUsedVariables(request: Request) {
	const data = getData(request);
	return loadUsedVariables(data.accountsAndTransfers);
}
