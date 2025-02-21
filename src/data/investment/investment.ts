import { formatDate, parseDate } from '../../utils/date/date';
import { DateString } from '../../utils/date/types';
import { InvestmentAccountData, InvestmentActivityData, Share, Target } from './types';
import { v4 as uuidv4 } from 'uuid';

export class InvestmentAccount implements InvestmentAccount {
  id: string;
  name: string;
  cashTarget: number;
  cashBalance: number;
  cashExpectedGrowth: number;
  shares: Share[];
  targets: Target[];
  activity: InvestmentActivity[];

  constructor(data: InvestmentAccountData) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.cashTarget = data.cashTarget;
    this.cashBalance = data.cashBalance;
    this.cashExpectedGrowth = data.cashExpectedGrowth;
    this.shares = data.shares;
    this.targets = data.targets;
    this.activity = data.activity
      .map((activity) => new InvestmentActivity(activity))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  serialize(): InvestmentAccountData {
    return {
      id: this.id,
      name: this.name,
      cashTarget: this.cashTarget,
      cashBalance: this.cashBalance,
      cashExpectedGrowth: this.cashExpectedGrowth,
      shares: this.shares,
      targets: this.targets,
      activity: this.activity.map((activity) => activity.serialize()),
    };
  }
}

export class InvestmentActivity {
  id: string;
  date: Date;
  type: string;
  symbol: string;
  shares: number;
  price: number;
  newShares: number;
  usesCash: boolean;
  memo: string;

  constructor(data: InvestmentActivityData) {
    this.id = data.id || uuidv4();
    this.date = parseDate(data.date as DateString);
    this.type = data.type;
    this.symbol = data.symbol;
    this.shares = data.shares;
    this.price = data.price;
    this.newShares = data.newShares;
    this.usesCash = data.usesCash;
    this.memo = data.memo;
  }

  serialize(): InvestmentActivityData {
    return {
      id: this.id,
      date: formatDate(this.date),
      type: this.type,
      symbol: this.symbol,
      shares: this.shares,
      price: this.price,
      newShares: this.newShares,
      usesCash: this.usesCash,
      memo: this.memo,
    };
  }
}
