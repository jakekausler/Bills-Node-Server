import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById, getByIdWithIdx } from '../../../utils/array/array';
import { Account } from '../../../data/account/account';
import { Activity } from '../../../data/activity/activity';
import { ActivityData } from '../../../data/activity/types';
import { parseDate } from '../../../utils/date/date';
import { saveData } from '../../../utils/io/accountsAndTransfers';

export function getSpecificActivity(request: Request) {
	const data = getData(request);
	if (data.isTransfer) {
		return getById<Activity>(data.accountsAndTransfers.transfers.activity, request.params.activityId);
	} else {
		const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
		return getById<Activity>(account.activity, request.params.activityId);
	}
}

export function updateSpecificActivity(request: Request) {
	const data = getData<ActivityData>(request);
	let activity: Activity;
	let activityIdx: number;
	if (data.isTransfer) {
		// Try to get the activity from the transfers, but the activity might have been originally a non-transfer activity
		try {
			({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
				data.accountsAndTransfers.transfers.activity,
				request.params.activityId,
			));
		} catch {
			const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
			({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
				account.activity,
				request.params.activityId,
			));
		}
	} else {
		// Try to get the activity from the account, but the activity might have been originally a transfer activity
		try {
			({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
				getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity,
				request.params.activityId,
			));
		} catch {
			({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
				data.accountsAndTransfers.transfers.activity,
				request.params.activityId,
			));
		}
	}

	const originalIsTransfer = activity.isTransfer;
	activity.name = data.data.name;
	activity.date = parseDate(data.data.date);
	activity.dateIsVariable = data.data.dateIsVariable;
	activity.dateVariable = data.data.dateVariable;
	activity.category = data.data.category;
	activity.amountIsVariable = data.data.amountIsVariable;
	activity.amount = data.data.amount;
	activity.amountVariable = data.data.amountVariable;
	activity.flag = data.data.flag;
	activity.isTransfer = data.data.isTransfer;
	if (activity.isTransfer) {
		activity.fro = data.data.from;
		activity.to = data.data.to;
	}

	if (data.isTransfer && !originalIsTransfer) {
		// If the new activity is not a transfer but the old activity was, remove the old activity from the transfers and add it to the account
		data.accountsAndTransfers.transfers.activity.splice(activityIdx, 1);
		getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity.push(activity);
	} else if (!data.isTransfer && originalIsTransfer) {
		// If the new activity is a transfer but the old activity was not, remove the old activity from the account and add it to the transfers
		data.accountsAndTransfers.transfers.activity.splice(activityIdx, 1);
		data.accountsAndTransfers.transfers.activity.push(activity);
	}

	saveData(data.accountsAndTransfers);

	return activity.id;
}

export function deleteSpecificActivity(request: Request) {
	const data = getData(request);
	let activity: Activity;
	let activityIdx: number;
	if (data.isTransfer) {
		({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(
			data.accountsAndTransfers.transfers.activity,
			request.params.activityId,
		));
	} else {
		const account = getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId);
		({ item: activity, idx: activityIdx } = getByIdWithIdx<Activity>(account.activity, request.params.activityId));
	}

	if (data.isTransfer) {
		data.accountsAndTransfers.transfers.activity.splice(activityIdx, 1);
	} else {
		getById<Account>(data.accountsAndTransfers.accounts, request.params.accountId).activity.splice(activityIdx, 1);
	}

	saveData(data.accountsAndTransfers);

	return activity.id;
}
