import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadData, saveData } from '../../utils/io/portfolio';
import { InvestmentAccountData } from '../../data/investment/types';
import { InvestmentAccount } from '../../data/investment/investment';
import { getByIdWithIdx, getById } from '../../utils/array/array';

export async function getInvestmentAccounts(_req: Request) {
  const accounts = loadData();
  return accounts.map((account) => account.serialize());
}

export async function addInvestmentAccount(req: Request) {
  const data = await getData<InvestmentAccountData>(req);
  const accounts = loadData();
  const account = new InvestmentAccount(data.data);
  accounts.push(account);
  saveData(accounts);
  return account.serialize();
}

export async function getInvestmentAccount(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  return account.serialize();
}

export async function updateInvestmentAccount(req: Request) {
  const data = await getData<InvestmentAccountData>(req);
  const accounts = loadData();
  const account = getByIdWithIdx<InvestmentAccount>(accounts, req.params.accountId);
  if (!account) {
    throw new Error('Account not found');
  }
  accounts.splice(account.idx, 1);
  const newAccount = new InvestmentAccount(data.data);
  accounts.push(newAccount);
  saveData(accounts);
  return newAccount.serialize();
}

export async function deleteInvestmentAccount(req: Request) {
  const accounts = loadData();
  const account = getByIdWithIdx<InvestmentAccount>(accounts, req.params.accountId);
  if (!account) {
    throw new Error('Account not found');
  }
  accounts.splice(account.idx, 1);
  saveData(accounts);
  return account.item.id;
}
