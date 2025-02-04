import { AccountsAndTransfers } from '../../data/account/types';

type NamesWithCounts = Record<string, CategoriesWithCounts>;
type CategoriesWithCounts = Record<string, number>;

type NamesWithCategories = Record<string, string[]>;

const addToNames = (names: NamesWithCounts, name: string, category: string) => {
	if (!names[name]) {
		names[name] = {};
	}
	const nameWithCount = names[name];
	if (!nameWithCount[category]) {
		nameWithCount[category] = 0;
	}
	nameWithCount[category]++;
};

export function loadNameCategories(accountsAndTransfers: AccountsAndTransfers): NamesWithCategories {
	const names: NamesWithCounts = {};
	accountsAndTransfers.accounts.forEach((account) => {
		account.activity.forEach((activity) => {
			addToNames(names, activity.name, activity.category);
		});
		account.bills.forEach((bill) => {
			addToNames(names, bill.name, bill.category);
		});
	});
	accountsAndTransfers.transfers.activity.forEach((activity) => {
		addToNames(names, activity.name, activity.category);
	});
	accountsAndTransfers.transfers.bills.forEach((bill) => {
		addToNames(names, bill.name, bill.category);
	});
	const result: NamesWithCategories = {};
	Object.entries(names).forEach(([name, categories]) => {
		result[name] = Object.entries(categories)
			.sort(([_cat1, count1], [_cat2, count2]) => count2 - count1)
			// TODO: Remove the "[0]" when category array is implemented on the frontend
			.map(([category]) => category)[0];
	});
	return result;
}
