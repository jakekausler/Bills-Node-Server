import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { parse as parseSync } from 'csv-parse/sync';
import { isBefore } from '../../../utils/date/date';
import { InvestmentActivity } from '../../../data/investment/investment';
import { InvestmentAccount } from '../../../data/investment/investment';
import { getById } from '../../../utils/array/array';
import { loadData, saveData } from '../../../utils/io/portfolio';

export async function addFromCSV(req: Request) {
  const data = await getData<string>(req);
  const accountId = req.params.accountId;
  const accounts = loadData();
  const account = getById<InvestmentAccount>(accounts, accountId);

  const csv = data.data;
  const transactions = parseSync(csv, { columns: true });
  const activities = transactions
    .map((transaction: any) => {
      const date = transaction['AS OF DATE'];
      const type = transaction['TYPE'].startsWith('SALE') ? 'sell' : 'buy';
      const symbol = transaction['FUND'];
      const shares = Math.abs(transaction['SHARES']);
      const price = transaction['PRICE'];
      const usesCash = transaction['CATEGORY'] === 'CONTRIBUTION';
      const memo = transaction['DESCRIPTION'];
      return new InvestmentActivity({
        date,
        type,
        symbol,
        shares,
        price,
        newShares: 0,
        usesCash,
        memo,
      });
    })
    .sort((a: InvestmentActivity, b: InvestmentActivity) => (isBefore(a.date, b.date) ? -1 : 1));

  const shareMap: Record<string, number> = {};
  activities.forEach((activity: InvestmentActivity) => {
    const shares = shareMap[activity.symbol] || 0;
    shareMap[activity.symbol] = shares + activity.shares;
    activity.newShares = shareMap[activity.symbol];
  });

  account.activity.push(...activities);
  saveData(accounts);

  return activities.map((activity: InvestmentActivity) => activity.serialize());
}
