import { v4 as uuidv4 } from 'uuid';
import { AccountData } from './types';
import { Activity } from '../activity/activity';
import { Bill } from '../bill/bill';
import { Interest } from '../interest/interest';
import { ConsolidatedActivity } from '../activity/consolidatedActivity';

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
  earlyWithdrawlPenalty: number;
  earlyWithdrawlDate: Date | null;
  interestPayAccount: string | null;
  usesRMD: boolean;
  accountOwnerDOB: Date | null;
  rmdAccount: string | null;
  minimumBalance: number | null;
  minimumPullAmount: number | null;
  performPulls: boolean;

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
          .sort((a, b) => a.date.getDate() - b.date.getDate())
      : [];
    this.bills = data.bills
      ? data.bills
          .map((bill) => new Bill(bill, simulation))
          .sort((a, b) => a.startDate.getDate() - b.startDate.getDate())
      : [];
    this.consolidatedActivity = [];
    this.todayBalance = 0;
    this.hidden = data.hidden || false;
    this.type = data.type;
    this.pullPriority = data.pullPriority === undefined ? -1 : data.pullPriority;
    this.interestTaxRate = data.interestTaxRate === undefined ? 0 : data.interestTaxRate;
    this.withdrawalTaxRate = data.withdrawalTaxRate === undefined ? 0 : data.withdrawalTaxRate;
    this.earlyWithdrawlPenalty = data.earlyWithdrawlPenalty === undefined ? 0 : data.earlyWithdrawlPenalty;
    this.earlyWithdrawlDate = data.earlyWithdrawlDate === undefined ? null : data.earlyWithdrawlDate;
    this.interestPayAccount = data.interestPayAccount === undefined ? null : data.interestPayAccount;
    this.usesRMD = data.usesRMD || false;
    this.accountOwnerDOB = data.accountOwnerDOB || null;
    this.rmdAccount = data.rmdAccount || null;
    this.minimumBalance = data.minimumBalance || null;
    this.minimumPullAmount = data.minimumPullAmount || null;
    this.performPulls = data.performPulls || false;
  }

  serialize(): AccountData {
    return {
      id: this.id,
      name: this.name,
      interests: this.interests.map((interest) => interest.serialize()),
      activity: this.activity.map((activity) => activity.serialize()),
      bills: this.bills.map((bill) => bill.serialize()),
      hidden: this.hidden,
      type: this.type,
      pullPriority: this.pullPriority,
      interestTaxRate: this.interestTaxRate,
      withdrawalTaxRate: this.withdrawalTaxRate,
      earlyWithdrawlPenalty: this.earlyWithdrawlPenalty,
      earlyWithdrawlDate: this.earlyWithdrawlDate,
      interestPayAccount: this.interestPayAccount,
      usesRMD: this.usesRMD,
      accountOwnerDOB: this.accountOwnerDOB,
      rmdAccount: this.rmdAccount,
      minimumBalance: this.minimumBalance,
      minimumPullAmount: this.minimumPullAmount,
      performPulls: this.performPulls,
    };
  }

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
      earlyWithdrawlPenalty: this.earlyWithdrawlPenalty,
      earlyWithdrawlDate: this.earlyWithdrawlDate,
      interestPayAccount: this.interestPayAccount,
      usesRMD: this.usesRMD,
      accountOwnerDOB: this.accountOwnerDOB,
      rmdAccount: this.rmdAccount,
      minimumBalance: this.minimumBalance,
      minimumPullAmount: this.minimumPullAmount,
      performPulls: this.performPulls,
    };
  }

  toString() {
    return `Account(${this.name}, ${this.id})`;
  }
}

export function todayBalance(account: Account) {
  const activities = account.consolidatedActivity;
  let lastBalance = 0;
  for (const activity of activities) {
    if (activity.date > new Date()) {
      return lastBalance;
    }
    lastBalance = activity.balance;
  }
  return lastBalance;
}
