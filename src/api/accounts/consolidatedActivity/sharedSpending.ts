import { Request } from 'express';
import { getData } from '../../../utils/net/request';
import { Account } from '../../../data/account/account';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export function getSharedSpending(request: Request) {
  console.log('Request:', request);
  const data = getData(request, { defaultEndDate: dayjs.utc().add(12, 'month').toDate() });
  console.log('Data:', data);
  const account = data.accountsAndTransfers.accounts.find((a: Account) => a.name === 'Costco');
  if (!account) {
    throw new Error('Account not found');
  }
  const sharedSpending = account.consolidatedActivity.filter((a) => a.name.startsWith('Transfer from '));
  const months: Record<string, typeof sharedSpending> = {};
  sharedSpending.forEach((a) => {
    const month = a.date.toLocaleString('default', { month: 'long', year: 'numeric' });
    if (!months[month]) {
      months[month] = [];
    }
    months[month].push(a);
  });
  console.log('Shared spending:', months);
  const entries = Object.entries(months).map(([month, activities]) => ({
    month,
    spending: Math.round((activities.reduce((sum, a) => sum + (typeof a.amount === 'number' ? a.amount : 0), 0) / activities.length) * 100) / 100,
  }));
  console.log('Shared spending:', entries);
  const lines = entries.map(
    (entry) => `<tr><td><b>${entry.month}</b></td><td>$ ${entry.spending.toFixed(2)}</td></tr>`,
  );
  return '<h1>Estimated Shared Card Payment</h1><table>' + lines.join('') + '</table>';
}
