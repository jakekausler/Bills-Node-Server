import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { InvestmentAccount } from '../../../data/investment/investment';
import { loadData, saveData } from '../../../utils/io/portfolio';
import { Share } from '../../../data/investment/types';

export async function getInvestmentShares(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  return account.shares;
}

export async function addInvestmentShare(req: Request) {
  const data = await getData<Share>(req);
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  account.shares.push(data.data);
  saveData(accounts);
  return data;
}

export async function getInvestmentShare(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  return account.shares.find((share) => share.symbol === req.params.symbol);
}

export async function updateInvestmentShare(req: Request) {
  const data = await getData<Share>(req);
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  const share = account.shares.find((share) => share.symbol === req.params.symbol);
  if (share) {
    share.shares = data.data.shares;
    share.nonCashPortfolioTarget = data.data.nonCashPortfolioTarget;
    share.expectedGrowth = data.data.expectedGrowth;
    share.customFund = data.data.customFund;
    share.customFundMakeup = data.data.customFundMakeup;
  }
  saveData(accounts);
  return share;
}

export async function deleteInvestmentShare(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  account.shares = account.shares.filter((share) => share.symbol !== req.params.symbol);
  saveData(accounts);
}
