import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadDateOrVariable, loadNumberOrVariable } from '../../utils/simulation/loadVariableValue';
import { BillData } from './types';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '../account/account';
import { AccountsAndTransfers } from '../account/types';
import { ActivityData } from '../activity/types';
import { Activity } from '../activity/activity';
import { formatDate } from '../../utils/date/date';

dayjs.extend(utc);

export class Bill {
  id: string;
  name: string;
  category: string;

  isTransfer: boolean;
  fro: string | null;
  to: string | null;

  everyN: number;
  periods: 'day' | 'week' | 'month' | 'year';

  increaseBy: number;
  increaseByIsVariable: boolean;
  increaseByVariable: string | null;
  increaseByDate: { day: number; month: number };
  ceilingMultiple: number;

  annualStartDate: string | null;
  annualEndDate: string | null;

  isAutomatic: boolean;

  startDate: Date;
  startDateIsVariable: boolean;
  startDateVariable: string | null;

  endDate: Date | null;
  endDateIsVariable: boolean;
  endDateVariable: string | null;

  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  amountIsVariable: boolean;
  amountVariable: string | null;

  flagColor: string | null;
  flag: boolean;

  constructor(data: BillData, simulation: string = 'Default') {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.category = data.category;

    this.isTransfer = data.isTransfer || false;
    this.fro = this.isTransfer ? data.from : null;
    this.to = this.isTransfer ? data.to : null;

    this.everyN = data.everyN;
    this.periods = data.periods;

    this.flagColor = data.flagColor || null;
    this.flag = data.flag || false;
    if (this.flag && !this.flagColor) {
      this.flagColor = 'gray';
    }

    try {
      const {
        amount: increaseBy,
        amountIsVariable: increaseByIsVariable,
        amountVariable: increaseByVariable,
      } = loadNumberOrVariable(data.increaseBy, data.increaseByIsVariable, data.increaseByVariable, simulation);
      this.increaseBy = [true, false].includes(increaseByIsVariable) ? (increaseBy as number) : 0.03;
      this.increaseByIsVariable = [true, false].includes(increaseByIsVariable) ? increaseByIsVariable : true;
      this.increaseByVariable = increaseByVariable || 'INFLATION';
    } catch (e) {
      console.log('Error loading increaseBy for bill', this.name);
      throw e;
    }

    this.increaseByDate = this.setIncreaseByDate(data.increaseByDate);
    this.ceilingMultiple = data.ceilingMultiple || 0;

    this.annualStartDate = data.annualStartDate || null;
    this.annualEndDate = data.annualEndDate || null;

    this.isAutomatic = data.isAutomatic || false;

    const {
      date: startDate,
      dateIsVariable: startDateIsVariable,
      dateVariable: startDateVariable,
    } = loadDateOrVariable(data.startDate, data.startDateIsVariable, data.startDateVariable, simulation);
    this.startDate = startDate;
    this.startDateIsVariable = startDateIsVariable;
    this.startDateVariable = startDateVariable;

    if (data.endDate) {
      const {
        date: endDate,
        dateIsVariable: endDateIsVariable,
        dateVariable: endDateVariable,
      } = loadDateOrVariable(data.endDate, data.endDateIsVariable, data.endDateVariable, simulation);
      this.endDate = endDate;
      this.endDateIsVariable = endDateIsVariable;
      this.endDateVariable = endDateVariable;
    } else {
      this.endDate = null;
      this.endDateIsVariable = false;
      this.endDateVariable = null;
    }

    const { amount, amountIsVariable, amountVariable } = loadNumberOrVariable(
      data.amount,
      data.amountIsVariable,
      data.amountVariable,
      simulation,
    );
    this.amount = amount;
    this.amountIsVariable = amountIsVariable;
    this.amountVariable = amountVariable;
  }

  setIncreaseByDate(increaseByDate: string): { day: number; month: number } {
    return increaseByDate
      ? {
          day: parseInt(increaseByDate.split('/')[1]),
          month: parseInt(increaseByDate.split('/')[0]) - 1,
        }
      : { day: 1, month: 0 };
  }

  serialize(): BillData {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      isTransfer: this.isTransfer,
      from: this.fro,
      to: this.to,
      everyN: this.everyN,
      periods: this.periods,
      increaseBy: this.increaseBy,
      increaseByIsVariable: this.increaseByIsVariable,
      increaseByVariable: this.increaseByVariable,
      increaseByDate: `${(this.increaseByDate.month + 1).toString().padStart(2, '0')}/${this.increaseByDate.day.toString().padStart(2, '0')}`,
      annualStartDate: this.annualStartDate,
      annualEndDate: this.annualEndDate,
      ceilingMultiple: this.ceilingMultiple,
      isAutomatic: this.isAutomatic,
      startDate: formatDate(this.startDate),
      startDateIsVariable: this.startDateIsVariable,
      startDateVariable: this.startDateVariable,
      endDate: this.endDate ? formatDate(this.endDate) : null,
      endDateIsVariable: this.endDateIsVariable,
      endDateVariable: this.endDateVariable,
      amount: this.amount,
      amountIsVariable: this.amountIsVariable,
      amountVariable: this.amountVariable,
      flagColor: this.flagColor,
      flag: this.flag,
    };
  }

  toActivity(
    id: string,
    simulation: string,
    amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}',
    date: Date,
  ): Activity {
    return new Activity(
      {
        id: id,
        name: this.name,
        category: this.category,
        amount: amount,
        amountIsVariable: false,
        amountVariable: this.amountVariable,
        date: formatDate(date),
        dateIsVariable: false,
        dateVariable: null,
        flag: this.flag,
        flagColor: this.flagColor,
        from: this.fro,
        to: this.to,
        isTransfer: this.isTransfer,
      },
      simulation,
    );
  }

  getUTCMonthAndDay(annualDate: string) {
    return [parseInt(annualDate.split('/')[0]), parseInt(annualDate.split('/')[1])];
  }

  checkAnnualDates(date: Date) {
    const dateMonth = date.getUTCMonth() + 1;
    const dateDay = date.getUTCDate() + 1;
    if (this.annualStartDate && this.annualEndDate) {
      const [annualStartMonth, annualStartDay] = this.getUTCMonthAndDay(this.annualStartDate);
      const [annualEndMonth, annualEndDay] = this.getUTCMonthAndDay(this.annualEndDate);

      if (this.annualStartDate < this.annualEndDate) {
        // Handle normal annual dates (start date is before end date, meaning the range is within a single year)
        if (
          // If we are after the start date
          (dateMonth > annualStartMonth || (dateMonth === annualStartMonth && dateDay >= annualStartDay)) &&
          // And we are before the end date
          (dateMonth < annualEndMonth || (dateMonth === annualEndMonth && dateDay <= annualEndDay))
        ) {
          // We are within the range
          return date;
        }
        // Otherwise, if we are before the start date, advance to the start date of the current year
        if (dateMonth < annualStartMonth || (dateMonth === annualStartMonth && dateDay <= annualStartDay)) {
          return new Date(date.getFullYear(), annualStartMonth, annualStartDay);
        }
        // Otherwise, if we are after the end date, advance to the start date of the next year
        if (dateMonth > annualEndMonth || (dateMonth === annualEndMonth && dateDay >= annualEndDay)) {
          return new Date(date.getFullYear() + 1, annualStartMonth, annualStartDay);
        }
      } else {
        // Handle annual dates that span multiple years (start date is after end date)
        if (
          // If we are after the start date (late in the year)
          dateMonth > annualStartMonth ||
          (dateMonth === annualStartMonth && dateDay >= annualStartDay) ||
          // And we are before the end date (early in the year, i.e. the next year)
          dateMonth < annualEndMonth ||
          (dateMonth === annualEndMonth && dateDay <= annualEndDay)
        ) {
          // We are within the range
          return date;
        }
        // Otherwise, we are before the start date but after the end date, advance to the start date of the current year
        return new Date(date.getFullYear(), annualStartMonth, annualStartDay);
      }
    } else if (this.annualStartDate) {
      const [annualStartMonth, annualStartDay] = this.getUTCMonthAndDay(this.annualStartDate);
      // If we are after the start date
      if (dateMonth > annualStartMonth || (dateMonth === annualStartMonth && dateDay >= annualStartDay)) {
        // We are within the range
        return date;
      }
      // Otherwise, we are before the start date, advance to the start date of the current year
      return new Date(date.getFullYear(), annualStartMonth, annualStartDay);
    } else if (this.annualEndDate) {
      const [annualEndMonth, annualEndDay] = this.getUTCMonthAndDay(this.annualEndDate);
      // If we are before the end date
      if (dateMonth < annualEndMonth || (dateMonth === annualEndMonth && dateDay <= annualEndDay)) {
        // We are within the range
        return date;
      }
      // Otherwise, we are after the end date, advance to the first day of the next year
      return new Date(date.getFullYear() + 1, 1, 1);
    }
    // Handle annual dates lasting the entire year (start date is empty and end date is empty)
    // There is no need to check the dates, as the bill is always within the year
    return date;
  }

  advance() {
    if (this.periods === 'day') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'day').toDate();
    } else if (this.periods === 'week') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'week').toDate();
    } else if (this.periods === 'month') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'month').toDate();
    } else if (this.periods === 'year') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'year').toDate();
    }
    this.startDate = this.checkAnnualDates(this.startDate);
  }

  skip() {
    this.advance();
  }
}

export function insertBill(
  accountsAndTransfers: AccountsAndTransfers,
  account: Account,
  bill: Bill,
  data: ActivityData,
  isTransfer: boolean,
  simulation: string = 'Default',
) {
  if (data.amountVariable === '{HALF}' || data.amountVariable === '{FULL}') {
    data.amountIsVariable = false;
    data.amountVariable = null;
  }
  if (isTransfer) {
    accountsAndTransfers.transfers.activity.push(new Activity(data, simulation));
  } else {
    account.activity.push(new Activity(data, simulation));
  }
  bill.advance();
}
