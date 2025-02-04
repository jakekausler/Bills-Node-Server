import { AccountsAndTransfers } from '../../data/account/types';
import { UsedVariables } from './types';

export function loadUsedVariables(accountsAndTransfers: AccountsAndTransfers) {
	const usedVariables: UsedVariables = {};
	for (const account of accountsAndTransfers.accounts) {
		for (const activity of account.activity) {
			if (activity.amountIsVariable) {
				if (!usedVariables[activity.amountVariable]) {
					usedVariables[activity.amountVariable] = [];
				}
				usedVariables[activity.amountVariable].push({
					type: 'activity',
					account: account.name,
					name: activity.name,
					date: activity.date,
				});
			}
			if (activity.dateIsVariable) {
				if (!usedVariables[activity.dateVariable]) {
					usedVariables[activity.dateVariable] = [];
				}
				usedVariables[activity.dateVariable].push({
					type: 'activity',
					account: account.name,
					name: activity.name,
				});
			}
		}
		for (const bill of account.bills) {
			if (bill.amountIsVariable) {
				if (!usedVariables[bill.amountVariable]) {
					usedVariables[bill.amountVariable] = [];
				}
				usedVariables[bill.amountVariable].push({
					type: 'bill',
					account: account.name,
					name: bill.name,
					date: bill.startDate,
				});
			}
			if (bill.startDateIsVariable) {
				if (!usedVariables[bill.startDateVariable]) {
					usedVariables[bill.startDateVariable] = [];
				}
				usedVariables[bill.startDateVariable].push({
					type: 'bill',
					account: account.name,
					name: bill.name,
				});
			}
			if (bill.endDateIsVariable) {
				if (!usedVariables[bill.endDateVariable]) {
					usedVariables[bill.endDateVariable] = [];
				}
				usedVariables[bill.endDateVariable].push({
					type: 'bill',
					account: account.name,
					name: bill.name,
					date: bill.startDate,
				});
			}
		}
	}
	for (const transfer of accountsAndTransfers.transfers.activity) {
		if (transfer.amountIsVariable) {
			if (!usedVariables[transfer.amountVariable]) {
				usedVariables[transfer.amountVariable] = [];
			}
			usedVariables[transfer.amountVariable].push({
				type: 'transfer',
				fro: transfer.fro,
				to: transfer.to,
				name: transfer.name,
				date: transfer.date,
			});
		}
		if (transfer.dateIsVariable) {
			if (!usedVariables[transfer.dateVariable]) {
				usedVariables[transfer.dateVariable] = [];
			}
			usedVariables[transfer.dateVariable].push({
				type: 'transfer',
				fro: transfer.fro,
				to: transfer.to,
				name: transfer.name,
			});
		}
	}
	for (const bill of accountsAndTransfers.transfers.bills) {
		if (bill.amountIsVariable) {
			if (!usedVariables[bill.amountVariable]) {
				usedVariables[bill.amountVariable] = [];
			}
			usedVariables[bill.amountVariable].push({
				type: 'bill',
				name: bill.name,
				fro: bill.fro,
				to: bill.to,
				date: bill.startDate,
			});
		}
		if (bill.startDateIsVariable) {
			if (!usedVariables[bill.startDateVariable]) {
				usedVariables[bill.startDateVariable] = [];
			}
			usedVariables[bill.startDateVariable].push({
				type: 'bill',
				name: bill.name,
				fro: bill.fro,
				to: bill.to,
			});
		}
		if (bill.endDateIsVariable) {
			if (!usedVariables[bill.endDateVariable]) {
				usedVariables[bill.endDateVariable] = [];
			}
			usedVariables[bill.endDateVariable].push({
				type: 'bill',
				name: bill.name,
				fro: bill.fro,
				to: bill.to,
				date: bill.startDate,
			});
		}
	}
	return usedVariables;
}
