import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { getById } from '../../../utils/array/array';
import { InvestmentAccount } from '../../../data/investment/investment';
import { InvestmentActivity } from '../../../data/investment/investment';
import { loadData, saveData } from '../../../utils/io/portfolio';
import { InvestmentActivityData } from '../../../data/investment/types';
import { parseDate } from '../../../utils/date/date';
import { DateString } from '../../../utils/date/types';

export async function getInvestmentAccountActivity(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  return account.activity.map((activity) => activity.serialize());
}

export async function addInvestmentAccountActivity(req: Request) {
  const data = await getData<InvestmentActivityData>(req);
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  const activity = new InvestmentActivity(data.data);
  account.activity.push(activity);
  saveData(accounts);
  return activity.id;
}

export async function getInvestmentAccountSpecificActivity(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  return getById<InvestmentActivity>(account.activity, req.params.activityId);
}

export async function updateInvestmentAccountSpecificActivity(req: Request) {
  const data = await getData<InvestmentActivityData>(req);
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  const activity = getById<InvestmentActivity>(account.activity, req.params.activityId);
  activity.date = parseDate(data.data.date as DateString);
  activity.type = data.data.type;
  activity.symbol = data.data.symbol;
  activity.shares = data.data.shares;
  activity.price = data.data.price;
  activity.newShares = data.data.newShares;
  activity.usesCash = data.data.usesCash;
  activity.memo = data.data.memo;
  saveData(accounts);
  return activity.id;
}

export async function deleteInvestmentAccountSpecificActivity(req: Request) {
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, req.params.accountId);
  const activity = getById<InvestmentActivity>(account.activity, req.params.activityId);
  account.activity.splice(account.activity.indexOf(activity), 1);
  saveData(accounts);
}
