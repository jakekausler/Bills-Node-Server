import { InvestmentAccount } from '../../data/investment/investment';
import { InvestmentAccountsData } from '../../data/investment/types';
import { load, save } from './io';

export const FILE_NAME = 'portfolio';

export function loadData() {
  return getInvestmentAccounts();
}

function getInvestmentAccounts(): InvestmentAccount[] {
  const data = load<InvestmentAccountsData>(`${FILE_NAME}.json`);
  const investmentAccounts: InvestmentAccount[] = [];
  for (const account of data.accounts) {
    investmentAccounts.push(new InvestmentAccount(account));
  }
  return investmentAccounts;
}

export function saveData(data: InvestmentAccount[]) {
  const accounts = data.map((account) => account.serialize());
  save<InvestmentAccountsData>({ accounts }, `${FILE_NAME}.json`);
}
