import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadNameCategories } from '../../utils/names/names';

export function getNameCategories(request: Request) {
	const data = getData(request);
	return loadNameCategories(data.accountsAndTransfers);
}
