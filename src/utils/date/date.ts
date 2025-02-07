import dayjs from 'dayjs';
import { AccountsAndTransfers } from '../../data/account/types';
import { DateString } from './types';

export function formatDate(date: Date): DateString {
  return date.toISOString().split('T')[0] as DateString;
}

export function parseDate(date: DateString): Date {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date '${date}'`);
  }
  return d;
}

export function getMinDate(accountsAndTransfers: AccountsAndTransfers): Date {
  let minDate = new Date();
  for (const account of accountsAndTransfers.accounts) {
    if (account.activity.length > 0 && account.activity[0].date < minDate) {
      minDate = account.activity[0].date;
    }
    if (account.bills.length > 0 && account.bills[0].startDate < minDate) {
      minDate = account.bills[0].startDate;
    }
    if (account.interests.length > 0 && account.interests[0].applicableDate < minDate) {
      minDate = account.interests[0].applicableDate;
    }
  }
  for (const activity of accountsAndTransfers.transfers.activity) {
    if (activity.date < minDate) {
      minDate = activity.date;
    }
  }
  for (const bill of accountsAndTransfers.transfers.bills) {
    if (bill.startDate < minDate) {
      minDate = bill.startDate;
    }
  }
  return minDate;
}

export function isBefore(date1: Date, date2: Date): boolean {
  return dayjs(date1).isBefore(dayjs(date2), 'day');
}

export function isSame(date1: Date, date2: Date): boolean {
  return dayjs(date1).isSame(dayjs(date2), 'day');
}

export function isBeforeOrSame(date1: Date, date2: Date): boolean {
  return isBefore(date1, date2) || isSame(date1, date2);
}

export function isAfter(date1: Date, date2: Date): boolean {
  return dayjs(date1).isAfter(dayjs(date2), 'day');
}

export function isAfterOrSame(date1: Date, date2: Date): boolean {
  return isAfter(date1, date2) || isSame(date1, date2);
}
