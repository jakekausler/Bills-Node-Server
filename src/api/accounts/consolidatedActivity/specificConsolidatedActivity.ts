import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { Account } from '../../../data/account/account';
import { ConsolidatedActivity } from '../../../data/activity/consolidatedActivity';

export function getSpecificConsolidatedActivity(request: Request) {
	const data = getData(request);
	const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
	const activity = getById<ConsolidatedActivity>(account.consolidatedActivity, request.params.activityId);
	return activity.serialize();
}
