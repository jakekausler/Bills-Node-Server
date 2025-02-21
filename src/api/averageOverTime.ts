import { Request } from 'express';
import { getData } from '../utils/net/request';
import { isAfter, isBefore } from '../utils/date/date';
import dayjs from 'dayjs';

export async function averageOverTime(req: Request) {
  const data = await getData(req);
  const { startDate, endDate, accountsAndTransfers, selectedAccounts } = data;
  const period = req.query.period as string;

  const averageOverTime: Record<string, number> = {};
  for (const account of accountsAndTransfers.accounts) {
    if (
      (selectedAccounts.length > 0 && !selectedAccounts.includes(account.id)) ||
      (selectedAccounts.length === 0 && account.hidden)
    ) {
      continue;
    }
    for (const activity of account.consolidatedActivity) {
      const date = activity.date;
      const amount = activity.amount;
      const name = activity.name;
      if (isBefore(date, startDate) || isAfter(date, endDate)) {
        continue;
      }
      averageOverTime[name] =
        Math.round(((averageOverTime[name] || 0) + (amount as number) / getDivisor(period, startDate, endDate)) * 100) /
        100;
    }
  }
  return averageOverTime;
}

function getDivisor(period: string, startDate: Date, endDate: Date) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const diff = end.diff(start, period as 'day' | 'week' | 'month' | 'year', true);
  return Math.max(1, diff);
}
