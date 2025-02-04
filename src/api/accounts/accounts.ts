import { Request } from 'express';
import { Account } from '../../data/account/account';
import { AccountData } from '../../data/account/types';
import { saveData } from '../../utils/io/accountsAndTransfers';
import { getData } from '../../utils/net/request';

export function getSimpleAccounts(request: Request) {
	const data = getData(request);
	return data.accountsAndTransfers.accounts.map((account) => account.simpleAccount());
}

export function addAccount(request: Request) {
	const data = getData<AccountData>(request);
	data.accountsAndTransfers.accounts.push(new Account(data.data, data.simulation));
	saveData(data.accountsAndTransfers);
	return data.accountsAndTransfers.accounts[data.accountsAndTransfers.accounts.length - 1].id;
}

export function updateAccounts(request: Request) {
	const data = getData<AccountData[]>(request);
	data.accountsAndTransfers.accounts.forEach((account) => {
		const newAccount = data.data.find((a) => a.id === account.id);
		if (newAccount) {
			if (newAccount.name !== account.name) {
				account.name = newAccount.name;
			}
			if (newAccount.type !== account.type) {
				account.type = newAccount.type;
			}
			if (newAccount.hidden !== account.hidden) {
				account.hidden = newAccount.hidden;
			}
		}
	});
	saveData(data.accountsAndTransfers);
	return data.accountsAndTransfers.accounts;
}
