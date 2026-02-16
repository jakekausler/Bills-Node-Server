import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AccountsAndTransfers } from '../../data/account/types';
import { DateString } from './types';

dayjs.extend(utc);

/**
 * Formats a Date object to a YYYY-MM-DD string
 * @param date - Date to format
 * @returns Formatted date string
 */
export function formatDate(date: Date): DateString {
  return date.toISOString().split('T')[0] as DateString;
}

/**
 * Parses a date string into a Date object
 * @param date - Date string to parse
 * @returns Parsed Date object
 * @throws Error if the date string is invalid
 */
export function parseDate(date: DateString): Date {
  const d = new Date(date + 'T12:00:00Z');
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date '${date}'`);
  }
  return d;
}

/**
 * Finds the earliest date across all accounts and transfers
 * Optimized to check only the first element of each array since activities, bills, and interests are sorted by date
 * @param accountsAndTransfers - Accounts and transfers data
 * @returns Earliest date found
 */
export function getMinDate(accountsAndTransfers: AccountsAndTransfers): Date {
  let minDate = new Date();
  for (const account of accountsAndTransfers.accounts) {
    // Check first activity (arrays are sorted by date, so first is earliest)
    if (account.activity.length > 0 && account.activity[0].date < minDate) {
      minDate = account.activity[0].date;
    }
    // Check first bill (arrays are sorted by date, so first is earliest)
    if (account.bills.length > 0 && account.bills[0].startDate < minDate) {
      minDate = account.bills[0].startDate;
    }
    // Check first interest (arrays are sorted by date, so first is earliest)
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

/**
 * Checks if date1 is before date2 (day-level comparison)
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if date1 is before date2
 */
export function isBefore(date1: Date, date2: Date): boolean {
  return dayjs.utc(date1).isBefore(dayjs.utc(date2), 'day');
}

/**
 * Checks if date1 is the same as date2 (day-level comparison)
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if dates are the same day
 */
export function isSame(date1: Date, date2: Date): boolean {
  return dayjs.utc(date1).isSame(dayjs.utc(date2), 'day');
}

/**
 * Checks if date1 is before or the same as date2 (day-level comparison)
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if date1 is before or same as date2
 */
export function isBeforeOrSame(date1: Date, date2: Date): boolean {
  return isBefore(date1, date2) || isSame(date1, date2);
}

/**
 * Checks if date1 is after date2 (day-level comparison)
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if date1 is after date2
 */
export function isAfter(date1: Date, date2: Date): boolean {
  return dayjs.utc(date1).isAfter(dayjs.utc(date2), 'day');
}

/**
 * Checks if date1 is after or the same as date2 (day-level comparison)
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if date1 is after or same as date2
 */
export function isAfterOrSame(date1: Date, date2: Date): boolean {
  return isAfter(date1, date2) || isSame(date1, date2);
}
