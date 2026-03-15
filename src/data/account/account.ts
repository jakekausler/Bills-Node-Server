import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AccountData } from './types';
import { Activity } from '../activity/activity';
import { Bill } from '../bill/bill';
import { Interest } from '../interest/interest';
import { ConsolidatedActivity } from '../activity/consolidatedActivity';
import { formatDate, parseDate } from '../../utils/date/date';
import { DateString } from '../../utils/date/types';

dayjs.extend(utc);

/**
 * Represents a financial account with activities, bills, and interests
 * Supports various account types including retirement accounts with RMD requirements
 */
export class Account {
  id: string;
  name: string;
  interests: Interest[];
  activity: Activity[];
  bills: Bill[];
  consolidatedActivity: ConsolidatedActivity[];
  todayBalance: number;
  hidden: boolean;
  type: string;
  pullPriority: number;
  interestTaxRate: number;
  withdrawalTaxRate: number;
  earlyWithdrawalPenalty: number;
  earlyWithdrawalDate: Date | null;
  interestPayAccount: string | null;
  interestAppliesToPositiveBalance: boolean;
  expenseRatio: number;
  usesRMD: boolean;
  accountOwnerDOB: Date | null;
  rmdAccount: string | null;
  minimumBalance: number | null;
  maximumBalance: number | null;
  minimumPullAmount: number | null;
  performsPulls: boolean;
  performsPushes: boolean;
  pushStart: Date | null;
  pushEnd: Date | null;
  pushAccount: string | null;
  defaultShowInGraph: boolean;

  /**
   * Creates a new Account instance
   * @param data - Account data object
   * @param simulation - Simulation name for variable resolution (defaults to 'Default')
   */
  constructor(data: AccountData, simulation: string = 'Default') {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.interests = data.interests
      ? data.interests
          .map((interest) => new Interest(interest, simulation))
          .sort((a, b) => a.applicableDate.getTime() - b.applicableDate.getTime())
      : [];
    this.activity = data.activity
      ? data.activity
          .map((activity) => new Activity(activity, simulation))
          .sort((a, b) => a.date.getTime() - b.date.getTime())
      : [];
    this.bills = data.bills
      ? data.bills
          .map((bill) => new Bill(bill, simulation))
          .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      : [];
    this.consolidatedActivity = data.consolidatedActivity
      ? data.consolidatedActivity.map(
          (activity) =>
            new ConsolidatedActivity(activity, {
              billId: activity.billId,
              firstBill: activity.firstBill,
              interestId: activity.interestId,
              firstInterest: activity.firstInterest,
              spendingTrackerId: activity.spendingTrackerId,
              firstSpendingTracker: activity.firstSpendingTracker,
            }),
        )
      : [];
    this.todayBalance = data.balance || 0;
    this.hidden = data.hidden || false;
    this.type = data.type;
    this.pullPriority = data.pullPriority === undefined ? -1 : data.pullPriority;
    this.interestTaxRate = data.interestTaxRate === undefined ? 0 : data.interestTaxRate;
    this.withdrawalTaxRate = data.withdrawalTaxRate === undefined ? 0 : data.withdrawalTaxRate;
    // Support both new and old property names for backwards compatibility with JSON data
    this.earlyWithdrawalPenalty = data.earlyWithdrawalPenalty ?? (data as any).earlyWithdrawlPenalty ?? 0;
    this.earlyWithdrawalDate = (data.earlyWithdrawalDate || (data as any).earlyWithdrawlDate) ? parseDate((data.earlyWithdrawalDate || (data as any).earlyWithdrawlDate) as DateString) : null;
    this.interestPayAccount = data.interestPayAccount === undefined ? null : data.interestPayAccount;
    this.interestAppliesToPositiveBalance = data.interestAppliesToPositiveBalance ?? true;
    this.expenseRatio = data.expenseRatio ?? 0;
    this.usesRMD = data.usesRMD || false;
    this.accountOwnerDOB = data.accountOwnerDOB ? parseDate(data.accountOwnerDOB as DateString) : null;
    this.rmdAccount = data.rmdAccount || null;
    this.minimumBalance = data.minimumBalance ?? null;
    this.maximumBalance = data.maximumBalance ?? null;
    this.minimumPullAmount = data.minimumPullAmount ?? null;
    this.performsPulls = data.performsPulls || false;
    this.performsPushes = data.performsPushes || false;
    this.pushStart = data.pushStart ? parseDate(data.pushStart as DateString) : null;
    this.pushEnd = data.pushEnd ? parseDate(data.pushEnd as DateString) : null;
    this.pushAccount = data.pushAccount || null;
    this.defaultShowInGraph = data.defaultShowInGraph || false;
  }

  /**
   * Serializes the account to a plain object for storage
   * @returns Serialized account data
   */
  serialize(includeConsolidatedActivity: boolean = false): AccountData {
    return {
      id: this.id,
      name: this.name,
      interests: this.interests.map((interest) => interest.serialize()),
      activity: this.activity.map((activity) => activity.serialize()),
      bills: this.bills.map((bill) => bill.serialize()),
      consolidatedActivity: includeConsolidatedActivity
        ? this.consolidatedActivity.map((activity) => activity.serialize())
        : undefined,
      hidden: this.hidden,
      type: this.type,
      pullPriority: this.pullPriority,
      interestTaxRate: this.interestTaxRate,
      withdrawalTaxRate: this.withdrawalTaxRate,
      earlyWithdrawalPenalty: this.earlyWithdrawalPenalty,
      earlyWithdrawalDate: this.earlyWithdrawalDate ? formatDate(this.earlyWithdrawalDate) : null,
      interestPayAccount: this.interestPayAccount,
      interestAppliesToPositiveBalance: this.interestAppliesToPositiveBalance,
      expenseRatio: this.expenseRatio,
      usesRMD: this.usesRMD,
      accountOwnerDOB: this.accountOwnerDOB ? formatDate(this.accountOwnerDOB) : null,
      rmdAccount: this.rmdAccount,
      minimumBalance: this.minimumBalance,
      maximumBalance: this.maximumBalance,
      minimumPullAmount: this.minimumPullAmount,
      performsPulls: this.performsPulls,
      performsPushes: this.performsPushes,
      pushStart: this.pushStart ? formatDate(this.pushStart) : null,
      pushEnd: this.pushEnd ? formatDate(this.pushEnd) : null,
      pushAccount: this.pushAccount,
      defaultShowInGraph: this.defaultShowInGraph,
      balance: this.todayBalance,
    };
  }

  /**
   * Returns a simplified representation of the account for API responses
   * @returns Simplified account object
   */
  simpleAccount() {
    return {
      id: this.id,
      name: this.name,
      balance: this.todayBalance,
      hidden: this.hidden,
      type: this.type,
      pullPriority: this.pullPriority,
      interestTaxRate: this.interestTaxRate,
      withdrawalTaxRate: this.withdrawalTaxRate,
      earlyWithdrawalPenalty: this.earlyWithdrawalPenalty,
      earlyWithdrawalDate: this.earlyWithdrawalDate ? formatDate(this.earlyWithdrawalDate) : null,
      interestPayAccount: this.interestPayAccount,
      interestAppliesToPositiveBalance: this.interestAppliesToPositiveBalance,
      expenseRatio: this.expenseRatio,
      usesRMD: this.usesRMD,
      accountOwnerDOB: this.accountOwnerDOB ? formatDate(this.accountOwnerDOB) : null,
      rmdAccount: this.rmdAccount,
      minimumBalance: this.minimumBalance,
      maximumBalance: this.maximumBalance,
      minimumPullAmount: this.minimumPullAmount,
      performsPulls: this.performsPulls,
      performsPushes: this.performsPushes,
      pushStart: this.pushStart ? formatDate(this.pushStart) : null,
      pushEnd: this.pushEnd ? formatDate(this.pushEnd) : null,
      pushAccount: this.pushAccount,
      defaultShowInGraph: this.defaultShowInGraph,
    };
  }

  /**
   * Returns a string representation of the account
   * @returns String representation in format "Account(name, id)"
   */
  toString() {
    return `Account(${this.name}, ${this.id})`;
  }
}

/**
 * Calculates the current balance of an account based on consolidated activity
 * @param account - The account to calculate balance for
 * @returns Current balance as of today
 */
export function todayBalance(account: Account) {
  const activities = account.consolidatedActivity;
  let lastBalance = 0;
  for (const activity of activities) {
    if (activity.date > dayjs.utc().toDate()) {
      return lastBalance;
    }
    lastBalance = activity.balance;
  }
  return lastBalance;
}
